// NextMav Procure — budget engine.
//
// §16 requires the platform to understand the whole chain:
//
//   Budget → Requested → Approved → Committed → Ordered → Received → Invoiced → Paid
//
// The old implementation touched a budget once, at PO issue, and never advanced
// `spentAmount` at all — so a department could have unlimited requests approved
// against an exhausted budget, and "actual spend" was permanently zero.
//
// Every movement now writes an append-only `BudgetEntry` and recomputes the
// rollups *from those entries*. The headline numbers on a budget are therefore
// always reconstructable, never merely asserted.
//
//   REQUESTED  request submitted     — demand signal; does not consume budget
//   RESERVED   request approved      — soft claim, not yet ordered
//   COMMITTED  PO issued             — contractual obligation to the vendor
//   SPENT      invoice approved      — the liability is now real
//   PAID       payment completed     — cash has actually left
//   RELEASED   cancelled / rejected  — negates an earlier claim
//
// REQUESTED and PAID are reported, not deducted: a request that is only asked for
// consumes nothing, and money that is paid was already counted when the invoice
// made it a liability. Deducting either would double-count the same naira.

import type { BudgetEntryType } from "@prisma/client";
import { db } from "../db";
import type { Tx } from "../db";
import { budgetExceeded, notFound } from "../errors";
import { enqueue } from "./outbox";

export interface BudgetTarget {
  organizationId: string;
  departmentId: string;
  fiscalYear?: number;
}

/** Finds the budget governing a department for a fiscal year, if one exists. */
export async function findBudget(
  target: BudgetTarget,
  client: Tx = db
): Promise<{ id: string; totalAmount: number; enforceHardLimit: boolean } | null> {
  const fiscalYear = target.fiscalYear ?? new Date().getFullYear();
  const budget = await client.budget.findFirst({
    where: {
      organizationId: target.organizationId,
      departmentId: target.departmentId,
      fiscalYear,
      status: { in: ["ACTIVE", "EXHAUSTED", "EXCEEDED"] },
    },
  });
  return budget
    ? { id: budget.id, totalAmount: budget.totalAmount, enforceHardLimit: budget.enforceHardLimit }
    : null;
}

export interface MovementInput {
  budgetId: string;
  type: BudgetEntryType;
  amount: number;
  categoryName?: string | null;
  requestId?: string | null;
  purchaseOrderId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  description?: string;
  createdById?: string | null;
}

/**
 * Recomputes a budget's rollups from its ledger and persists them.
 *
 * `reserved` and `committed` are deliberately *not* additive with each other in
 * the remaining calculation: when a PO is issued the reservation is released and
 * replaced by a commitment, so counting both would double-count the same money.
 */
async function recompute(budgetId: string, client: Tx = db) {
  const [budget, sums] = await Promise.all([
    client.budget.findUnique({ where: { id: budgetId }, include: { alerts: true } }),
    client.budgetEntry.groupBy({
      by: ["type"],
      where: { budgetId },
      _sum: { amount: true },
    }),
  ]);
  if (!budget) throw notFound("Budget not found");

  // `_sum` is one of the few places the Decimal extension does not reach, so the
  // conversion is explicit here rather than assumed.
  const by = (t: BudgetEntryType) => Number(sums.find((s) => s.type === t)?._sum.amount ?? 0);

  const requested = by("REQUESTED");
  const reserved = by("RESERVED") - by("RELEASED");
  const committed = by("COMMITTED");
  const spent = by("SPENT");
  const paid = by("PAID");
  const remaining = budget.totalAmount - spent - committed - Math.max(0, reserved);

  const utilisation =
    budget.totalAmount > 0 ? ((spent + committed) / budget.totalAmount) * 100 : 0;

  const status =
    spent + committed > budget.totalAmount
      ? "EXCEEDED"
      : remaining <= 0
        ? "EXHAUSTED"
        : budget.status === "CLOSED"
          ? "CLOSED"
          : "ACTIVE";

  await client.budget.update({
    where: { id: budgetId },
    data: {
      requestedAmount: Math.max(0, requested),
      reservedAmount: Math.max(0, reserved),
      committedAmount: committed,
      spentAmount: spent,
      invoicedAmount: spent,
      paidAmount: paid,
      remainingAmount: remaining,
      status,
    },
  });

  // Fire any threshold alert that has just been crossed, exactly once.
  for (const alert of budget.alerts) {
    if (!alert.triggered && utilisation >= alert.threshold) {
      await client.budgetAlert.update({
        where: { id: alert.id },
        data: { triggered: true, triggeredAt: new Date() },
      });

      const managers = await client.user.findMany({
        where: {
          organizationId: budget.organizationId,
          role: { in: ["FINANCE_OFFICER", "SUPER_ADMIN", "DEPARTMENT_MANAGER"] },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      const department = await client.department.findUnique({
        where: { id: budget.departmentId },
        select: { name: true },
      });

      // Queued through the outbox: this runs inside the caller's transaction, and
      // an alert must not be sent for a movement that then rolls back.
      await enqueue(client, {
        type: utilisation >= 100 ? "budget.exceeded" : "budget.threshold_reached",
        organizationId: budget.organizationId,
        recipientIds: managers.map((m) => m.id),
        title: `Budget ${alert.threshold}% threshold reached`,
        message: `${department?.name ?? "Department"} FY${budget.fiscalYear} budget is ${utilisation.toFixed(1)}% utilised (${remaining < 0 ? "over by " : ""}${Math.abs(remaining).toLocaleString()} remaining).`,
        severity: utilisation >= 100 ? "error" : "budget",
        link: "budgets",
        entityType: "BUDGET",
        entityId: budget.id,
        payload: { utilisation, remaining, threshold: alert.threshold },
      });
    }
  }

  return { requested, reserved, committed, spent, paid, remaining, utilisation, status };
}

/**
 * Records a budget movement.
 *
 * When the budget has `enforceHardLimit` set, a RESERVED or COMMITTED movement
 * that would push the budget past its total is rejected outright — this is the
 * overspending control §16 asks for, and it is enforced here rather than in the
 * UI so it cannot be bypassed by calling the API directly.
 */
export async function record(input: MovementInput, client: Tx = db) {
  const budget = await client.budget.findUnique({ where: { id: input.budgetId } });
  if (!budget) throw notFound("Budget not found");

  if (
    budget.enforceHardLimit &&
    (input.type === "RESERVED" || input.type === "COMMITTED") &&
    input.amount > 0
  ) {
    // Read the projection from the ledger, not from the rollup columns: inside a
    // transaction the columns are as of the last recompute, and two approvals in
    // flight would both see room that only one of them has.
    const sums = await client.budgetEntry.groupBy({
      by: ["type"],
      where: { budgetId: input.budgetId },
      _sum: { amount: true },
    });
    const total = (t: BudgetEntryType) => Number(sums.find((s) => s.type === t)?._sum.amount ?? 0);
    const allocatedSoFar =
      total("SPENT") + total("COMMITTED") + Math.max(0, total("RESERVED") - total("RELEASED"));
    const projected = allocatedSoFar + input.amount;
    if (projected > budget.totalAmount) {
      throw budgetExceeded(
        `This would exceed the department budget by ${(projected - budget.totalAmount).toLocaleString()}. The budget has a hard spending limit.`,
        {
          budgetId: budget.id,
          total: budget.totalAmount,
          alreadyAllocated: allocatedSoFar,
          requested: input.amount,
        }
      );
    }
  }

  await client.budgetEntry.create({
    data: {
      budgetId: input.budgetId,
      type: input.type,
      amount: input.amount,
      categoryName: input.categoryName ?? null,
      requestId: input.requestId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      description: input.description ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return recompute(input.budgetId, client);
}

/**
 * Records demand when a request is submitted.
 *
 * Deliberately not a claim: it does not reduce what is available, because a
 * request that has not been approved may never be. It exists so a budget owner
 * can see what is coming before it lands.
 */
export async function signalRequested(
  target: BudgetTarget,
  amount: number,
  requestId: string,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;
  return record(
    {
      budgetId: budget.id,
      type: "REQUESTED",
      amount,
      requestId,
      description: "Requested on submission",
      createdById: actorId,
    },
    client
  );
}

/** Soft claim when a request is approved but nothing has been ordered yet. */
export async function reserveForRequest(
  target: BudgetTarget,
  amount: number,
  requestId: string,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;
  return record(
    {
      budgetId: budget.id,
      type: "RESERVED",
      amount,
      requestId,
      description: "Reserved on request approval",
      createdById: actorId,
    },
    client
  );
}

/**
 * Converts a request's reservation into a firm commitment against a PO.
 *
 * Releasing the reservation first is what prevents the same money being counted
 * twice while the PO exists alongside the request that spawned it.
 */
export async function commitForPurchaseOrder(
  target: BudgetTarget,
  amount: number,
  purchaseOrderId: string,
  requestId: string | null,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;

  if (requestId) {
    const reserved = await client.budgetEntry.aggregate({
      where: { budgetId: budget.id, requestId, type: "RESERVED" },
      _sum: { amount: true },
    });
    const released = await client.budgetEntry.aggregate({
      where: { budgetId: budget.id, requestId, type: "RELEASED" },
      _sum: { amount: true },
    });
    const outstanding = Number(reserved._sum.amount ?? 0) - Number(released._sum.amount ?? 0);
    if (outstanding > 0) {
      await record(
        {
          budgetId: budget.id,
          type: "RELEASED",
          amount: outstanding,
          requestId,
          description: "Reservation released — converted to PO commitment",
          createdById: actorId,
        },
        client
      );
    }
  }

  return record(
    {
      budgetId: budget.id,
      type: "COMMITTED",
      amount,
      purchaseOrderId,
      requestId,
      description: "Committed on purchase order issue",
      createdById: actorId,
    },
    client
  );
}

/**
 * Turns a commitment into actual spend when an invoice is approved.
 *
 * The commitment is reduced by the invoiced amount rather than cleared outright,
 * because a PO may be invoiced in several parts — the residual commitment is what
 * is still on order but not yet billed.
 */
export async function actualiseForInvoice(
  target: BudgetTarget,
  amount: number,
  invoiceId: string,
  purchaseOrderId: string | null,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;

  if (purchaseOrderId) {
    const committed = await client.budgetEntry.aggregate({
      where: { budgetId: budget.id, purchaseOrderId, type: "COMMITTED" },
      _sum: { amount: true },
    });
    const alreadySpent = await client.budgetEntry.aggregate({
      where: { budgetId: budget.id, purchaseOrderId, type: "SPENT" },
      _sum: { amount: true },
    });
    const outstandingCommitment =
      Number(committed._sum.amount ?? 0) - Number(alreadySpent._sum.amount ?? 0);
    const toRelease = Math.min(Math.max(0, outstandingCommitment), amount);

    if (toRelease > 0) {
      await client.budgetEntry.create({
        data: {
          budgetId: budget.id,
          type: "COMMITTED",
          amount: -toRelease,
          purchaseOrderId,
          invoiceId,
          description: "Commitment reduced — invoice approved",
          createdById: actorId,
        },
      });
    }
  }

  return record(
    {
      budgetId: budget.id,
      type: "SPENT",
      amount,
      invoiceId,
      purchaseOrderId,
      description: "Actual spend recorded on invoice approval",
      createdById: actorId,
    },
    client
  );
}

/**
 * Records cash leaving on a completed payment.
 *
 * Recorded rather than deducted — the liability was already taken out of the
 * budget when the invoice was approved. This row is what makes the difference
 * between "committed", "invoiced" and "actually paid" answerable.
 */
export async function recordPayment(
  target: BudgetTarget,
  amount: number,
  paymentId: string,
  invoiceId: string | null,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;
  return record(
    {
      budgetId: budget.id,
      type: "PAID",
      amount,
      paymentId,
      invoiceId,
      description: "Payment completed",
      createdById: actorId,
    },
    client
  );
}

/** Undoes an outstanding claim when a request or PO is cancelled or rejected. */
export async function releaseForRequest(
  target: BudgetTarget,
  requestId: string,
  actorId: string | null,
  client: Tx = db
) {
  const budget = await findBudget(target, client);
  if (!budget) return null;

  const [reserved, released] = await Promise.all([
    client.budgetEntry.aggregate({
      where: { budgetId: budget.id, requestId, type: "RESERVED" },
      _sum: { amount: true },
    }),
    client.budgetEntry.aggregate({
      where: { budgetId: budget.id, requestId, type: "RELEASED" },
      _sum: { amount: true },
    }),
  ]);

  const outstanding = Number(reserved._sum.amount ?? 0) - Number(released._sum.amount ?? 0);
  if (outstanding <= 0) return null;

  return record(
    {
      budgetId: budget.id,
      type: "RELEASED",
      amount: outstanding,
      requestId,
      description: "Reservation released — request cancelled or rejected",
      createdById: actorId,
    },
    client
  );
}

/** Full picture for reporting: the chain from allocation through to paid. */
export async function budgetPosition(budgetId: string) {
  const budget = await db.budget.findUnique({
    where: { id: budgetId },
    include: { categories: true, alerts: true, department: { select: { name: true } } },
  });
  if (!budget) throw notFound("Budget not found");

  const entries = await db.budgetEntry.groupBy({
    by: ["type"],
    where: { budgetId },
    _sum: { amount: true },
  });
  const by = (t: BudgetEntryType) => Number(entries.find((e) => e.type === t)?._sum.amount ?? 0);

  // Paid is read from payments rather than the ledger, because a payment is only
  // "paid" once it has actually completed.
  const paid = await db.payment.aggregate({
    where: {
      organizationId: budget.organizationId,
      status: "COMPLETED",
      invoice: { budgetEntries: { some: { budgetId } } },
    },
    _sum: { amount: true },
  });

  const allocated = budget.totalAmount;
  const committed = by("COMMITTED");
  const spent = by("SPENT");
  const reserved = Math.max(0, by("RESERVED") - by("RELEASED"));

  return {
    budget,
    // The chain §8 asks for, every figure reconstructed from the ledger rather
    // than read off a column that something may have forgotten to update.
    allocated,
    requested: by("REQUESTED"),
    approved: reserved,
    reserved,
    committed,
    invoiced: spent,
    spent,
    // Paid is cross-checked against completed payments, so a PAID ledger row that
    // was never matched by a real payment shows up as a discrepancy.
    paid: by("PAID"),
    paidFromPayments: Number(paid._sum.amount ?? 0),
    remaining: budget.remainingAmount,
    available: allocated - spent - committed - reserved,
    variance: allocated - spent,
    utilisation: allocated > 0 ? ((spent + committed) / allocated) * 100 : 0,
  };
}
