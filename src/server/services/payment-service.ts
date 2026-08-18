// NextMav Procure — payment service.
//
//   DRAFT → PENDING_APPROVAL → SCHEDULED → PROCESSING → COMPLETED
//                                                     ↘ FAILED → (retry)
//
// On the deliberate absence of a bank integration
// ------------------------------------------------
// §15 is explicit: do not fake a banking connection. No payment provider is
// implemented here, and nothing in this service or the UI claims otherwise.
// `settle()` records the outcome of a payment made through the organization's
// existing banking channel — it is a *record* of a transfer, not the transfer.
//
// The seam for a real provider exists and is unused: `providerName`,
// `providerRef`, `providerStatus` on the Payment model, and the `PaymentProvider`
// interface below. Wiring a provider means implementing that interface and
// calling it from `process()`; no other part of the platform changes.

import type { PaymentStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import * as invoiceService from "./invoice-service";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createPaymentSchema,
  settlePaymentSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createPaymentSchema>;
type SettleInput = z.infer<typeof settlePaymentSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["paymentDate", "scheduledFor", "createdAt", "amount", "paymentNumber", "status"] as const;

/**
 * The contract a real payment provider would implement.
 *
 * No implementation ships with the platform. This exists so that adding one is a
 * contained change rather than a rewrite — and so the absence is explicit in the
 * code rather than disguised by a mock that pretends to succeed.
 */
export interface PaymentProvider {
  readonly name: string;
  initiate(input: {
    amount: number;
    currency: string;
    reference: string;
    beneficiary: { name: string; bankName: string | null; accountNumber: string | null };
  }): Promise<{ providerRef: string; status: "PENDING" | "SETTLED" | "REJECTED" }>;
  getStatus(providerRef: string): Promise<{ status: "PENDING" | "SETTLED" | "REJECTED"; detail?: string }>;
}

/** No provider is registered. Payments are recorded manually until one is. */
export function getPaymentProvider(): PaymentProvider | null {
  return null;
}

const paymentInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      paidAmount: true,
      balance: true,
      dueDate: true,
      status: true,
      purchaseOrderId: true,
    },
  },
  vendor: {
    select: { id: true, companyName: true, bankName: true, bankAccount: true, email: true },
  },
  processedBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const tdb = scoped(ctx);

  const where: Prisma.PaymentWhereInput = {};
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as PaymentStatus[] };
  }
  if (q.vendorId && q.vendorId !== "ALL") where.vendorId = q.vendorId;
  if (q.search) {
    where.OR = [
      { paymentNumber: { contains: q.search, mode: "insensitive" } },
      { reference: { contains: q.search, mode: "insensitive" } },
      { vendor: { companyName: { contains: q.search, mode: "insensitive" } } },
      { invoice: { invoiceNumber: { contains: q.search, mode: "insensitive" } } },
    ];
  }

  const [total, items] = await Promise.all([
    tdb.payment.count({ where }),
    tdb.payment.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: paymentInclude,
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const payment = await scoped(ctx).payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw notFound("Payment not found");
  return payment;
}

// ---------------------------------------------------------------------------
// Creation and the approval gate
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "budgets.manage");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const invoice = await tdb.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { vendor: true, payments: true },
  });
  if (!invoice) throw notFound("Invoice not found");

  // Paying an unapproved invoice defeats the entire control chain.
  if (!["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(invoice.status)) {
    throw conflict(
      `Invoice ${invoice.invoiceNumber} is ${invoice.status.replace(/_/g, " ").toLowerCase()} and has not been approved for payment`
    );
  }
  if (invoice.vendor.status === "BLACKLISTED") {
    throw conflict(`${invoice.vendor.companyName} is blacklisted — payment is blocked`);
  }

  // Overpayment guard, counting money already committed to in-flight payments.
  const inFlight = invoice.payments
    .filter((p) => ["PENDING_APPROVAL", "SCHEDULED", "PROCESSING", "COMPLETED"].includes(p.status))
    .reduce((s, p) => s + p.amount, 0);
  const available = invoice.totalAmount - inFlight;

  if (input.amount > available + 0.01) {
    throw validation(
      `This would overpay ${invoice.invoiceNumber}. Invoice total ${invoice.totalAmount.toLocaleString()}, already committed ${inFlight.toLocaleString()}, available ${Math.max(0, available).toLocaleString()}.`,
      { invoiceTotal: invoice.totalAmount, committed: inFlight, available: Math.max(0, available) }
    );
  }

  const payment = await db.$transaction(async (tx) => {
    const paymentNumber = await nextDocumentNumber(organizationId, PREFIX.payment, { client: tx });
    return tx.payment.create({
      data: {
        organizationId,
        paymentNumber,
        invoiceId: invoice.id,
        vendorId: invoice.vendorId,
        amount: input.amount,
        currency: invoice.currency,
        method: input.method,
        // Every payment enters the approval gate. Creating one is a request to pay,
        // not an instruction to pay.
        status: "PENDING_APPROVAL",
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        reference: input.reference || null,
        notes: input.notes || null,
        processedById: ctx.principal.userId,
      },
      include: paymentInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "payment.created",
    resource: "Payment",
    resourceId: payment.id,
    after: {
      paymentNumber: payment.paymentNumber,
      invoice: invoice.invoiceNumber,
      amount: input.amount,
      method: input.method,
      status: "PENDING_APPROVAL",
    },
    context: ctx.context,
  });

  const approvers = await db.user.findMany({
    where: { organizationId, role: { in: ["FINANCE_OFFICER", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
  });
  await emit({
    type: "payment.scheduled",
    organizationId,
    actorId: ctx.principal.userId,
    recipientIds: approvers.map((a) => a.id),
    title: `Payment ${payment.paymentNumber} awaiting approval`,
    message: `${input.amount.toLocaleString()} to ${invoice.vendor.companyName} against ${invoice.invoiceNumber}.`,
    severity: "approval",
    link: "payments",
    entityType: "PAYMENT",
    entityId: payment.id,
  });

  return getById(ctx, payment.id);
}

/**
 * The finance approval gate.
 *
 * Separation of duties: whoever raised the payment cannot approve it. This is the
 * single most important control in accounts payable, and it is enforced here
 * rather than by convention.
 */
export async function approve(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "budgets.manage");
  const tdb = scoped(ctx);

  const payment = await tdb.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw notFound("Payment not found");
  if (payment.status !== "PENDING_APPROVAL") {
    throw conflict(`This payment is ${payment.status.replace(/_/g, " ").toLowerCase()} and is not awaiting approval`);
  }
  if (payment.processedById === ctx.principal.userId) {
    throw forbidden(
      "Separation of duties: a payment must be approved by someone other than the person who raised it."
    );
  }

  await tdb.payment.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      approvedById: ctx.principal.userId,
      approvedAt: new Date(),
      scheduledFor: payment.scheduledFor ?? new Date(),
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "payment.approved",
    resource: "Payment",
    resourceId: id,
    before: { status: "PENDING_APPROVAL" },
    after: { status: "SCHEDULED", approvedBy: ctx.principal.userId },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "STATUS_CHANGE",
    description: `${ctx.principal.name} approved payment ${payment.paymentNumber} (${payment.amount.toLocaleString()} to ${payment.vendor.companyName})`,
    severity: "SUCCESS",
    vendorId: payment.vendorId,
    context: ctx.context,
  });

  return getById(ctx, id);
}

/**
 * Moves an approved payment into processing.
 *
 * With no provider registered this simply marks the payment as out for settlement
 * through the organization's own banking channel; the operator then records the
 * outcome via `settle()`. If a provider is ever registered, this is where it is
 * called — and only then does the platform actually move money.
 */
export async function process(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "budgets.manage");
  const tdb = scoped(ctx);

  const payment = await tdb.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw notFound("Payment not found");
  if (payment.status !== "SCHEDULED") {
    throw conflict("Only an approved, scheduled payment can be sent for processing");
  }

  const provider = getPaymentProvider();
  let providerRef: string | null = null;
  let providerStatus: string | null = null;

  if (provider) {
    const result = await provider.initiate({
      amount: payment.amount,
      currency: payment.currency,
      reference: payment.paymentNumber,
      beneficiary: {
        name: payment.vendor.companyName,
        bankName: payment.vendor.bankName,
        accountNumber: payment.vendor.bankAccount,
      },
    });
    providerRef = result.providerRef;
    providerStatus = result.status;
  }

  await tdb.payment.update({
    where: { id },
    data: {
      status: "PROCESSING",
      providerName: provider?.name ?? null,
      providerRef,
      providerStatus,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "payment.processing",
    resource: "Payment",
    resourceId: id,
    before: { status: "SCHEDULED" },
    after: { status: "PROCESSING", provider: provider?.name ?? "manual", providerRef },
    context: ctx.context,
  });

  return getById(ctx, id);
}

/** Records the real-world outcome and settles the invoice position. */
export async function settle(ctx: ServiceContext, id: string, input: SettleInput) {
  await assertPermission(ctx.principal, "budgets.manage");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const payment = await tdb.payment.findUnique({ where: { id }, include: paymentInclude });
  if (!payment) throw notFound("Payment not found");
  if (!["PROCESSING", "SCHEDULED"].includes(payment.status)) {
    throw conflict(
      `A payment in ${payment.status.replace(/_/g, " ").toLowerCase()} state cannot be settled`
    );
  }

  const completed = input.outcome === "COMPLETED";
  if (!completed && !input.failureReason) {
    throw validation("A failure reason is required when recording a failed payment");
  }

  await tdb.payment.update({
    where: { id },
    data: {
      status: completed ? "COMPLETED" : "FAILED",
      paymentDate: completed ? (input.paymentDate ? new Date(input.paymentDate) : new Date()) : null,
      reference: input.reference ?? payment.reference,
      failureReason: completed ? null : input.failureReason,
      reconciledAt: completed ? new Date() : null,
      reconciledById: completed ? ctx.principal.userId : null,
    },
  });

  // Only a completed payment changes what the invoice still owes.
  await invoiceService.refreshPaymentPosition(organizationId, payment.invoiceId);

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: completed ? "payment.completed" : "payment.failed",
    resource: "Payment",
    resourceId: id,
    before: { status: payment.status },
    after: {
      status: completed ? "COMPLETED" : "FAILED",
      reference: input.reference,
      failureReason: input.failureReason,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "STATUS_CHANGE",
    description: completed
      ? `${ctx.principal.name} recorded payment ${payment.paymentNumber} as completed — ${payment.amount.toLocaleString()} to ${payment.vendor.companyName}`
      : `Payment ${payment.paymentNumber} failed — ${input.failureReason}`,
    severity: completed ? "SUCCESS" : "CRITICAL",
    vendorId: payment.vendorId,
    context: ctx.context,
  });

  await emit({
    type: completed ? "payment.completed" : "payment.failed",
    organizationId,
    vendorId: payment.vendorId,
    actorId: ctx.principal.userId,
    title: completed
      ? `Payment ${payment.paymentNumber} completed`
      : `Payment ${payment.paymentNumber} failed`,
    message: completed
      ? `${payment.amount.toLocaleString()} paid against ${payment.invoice.invoiceNumber}.`
      : `${input.failureReason}. The invoice remains outstanding.`,
    severity: completed ? "success" : "error",
    link: "payments",
    entityType: "PAYMENT",
    entityId: id,
  });

  if (completed) {
    await db.supplierActivity.create({
      data: {
        vendorId: payment.vendorId,
        type: "PAYMENT_RECEIVED",
        description: `Payment ${payment.paymentNumber} of ${payment.amount.toLocaleString()} against ${payment.invoice.invoiceNumber}`,
        referenceId: id,
      },
    });
  }

  return getById(ctx, id);
}

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "budgets.manage");
  const tdb = scoped(ctx);

  const payment = await tdb.payment.findUnique({ where: { id } });
  if (!payment) throw notFound("Payment not found");
  if (payment.status === "COMPLETED") {
    throw conflict("A completed payment cannot be cancelled. Record a refund instead.");
  }

  await tdb.payment.update({
    where: { id },
    data: { status: "CANCELLED", failureReason: reason },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "payment.cancelled",
    resource: "Payment",
    resourceId: id,
    before: { status: payment.status },
    after: { status: "CANCELLED", reason },
    context: ctx.context,
  });

  await invoiceService.refreshPaymentPosition(ctx.principal.organizationId, payment.invoiceId);
  return getById(ctx, id);
}

/** Accounts-payable position for the payments dashboard, from real data. */
export async function payablesPosition(ctx: ServiceContext) {
  await assertPermission(ctx.principal, "reports.view");
  const tdb = scoped(ctx);
  const now = new Date();

  const [awaitingApproval, scheduled, processing, completed, overdueInvoices, approvedUnpaid] =
    await Promise.all([
      tdb.payment.aggregate({ where: { status: "PENDING_APPROVAL" }, _sum: { amount: true }, _count: true }),
      tdb.payment.aggregate({ where: { status: "SCHEDULED" }, _sum: { amount: true }, _count: true }),
      tdb.payment.aggregate({ where: { status: "PROCESSING" }, _sum: { amount: true }, _count: true }),
      tdb.payment.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true }, _count: true }),
      tdb.invoice.aggregate({
        where: { status: { in: ["OVERDUE", "APPROVED", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
        _sum: { balance: true },
        _count: true,
      }),
      tdb.invoice.aggregate({
        where: { status: { in: ["APPROVED", "PARTIALLY_PAID", "OVERDUE"] } },
        _sum: { balance: true },
        _count: true,
      }),
    ]);

  return {
    awaitingApproval: { amount: awaitingApproval._sum.amount ?? 0, count: awaitingApproval._count },
    scheduled: { amount: scheduled._sum.amount ?? 0, count: scheduled._count },
    processing: { amount: processing._sum.amount ?? 0, count: processing._count },
    completed: { amount: completed._sum.amount ?? 0, count: completed._count },
    overdue: { amount: overdueInvoices._sum.balance ?? 0, count: overdueInvoices._count },
    totalPayable: { amount: approvedUnpaid._sum.balance ?? 0, count: approvedUnpaid._count },
    providerConnected: getPaymentProvider() !== null,
  };
}
