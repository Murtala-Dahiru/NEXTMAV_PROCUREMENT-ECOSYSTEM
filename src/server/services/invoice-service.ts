// NextMav Procure — invoice service.
//
// The controls §14 asks for, implemented as business logic rather than status
// fields: duplicate detection, 2-way and 3-way matching, and balance arithmetic
// that keeps `paidAmount` and `balance` honest.
//
// Matching outcomes:
//   NO_PO             invoice not linked to a purchase order (2-way impossible)
//   NO_RECEIPT        linked to a PO but nothing has been received (3-way impossible)
//   PRICE_VARIANCE    invoiced unit price differs from the ordered price
//   QUANTITY_VARIANCE invoiced quantity exceeds what was received
//   MATCHED           PO ↔ receipt ↔ invoice agree within tolerance

import type { InvoiceStatus, MatchExceptionType, MatchStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { conflict, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import * as budgetEngine from "../engines/budget";
import * as requestService from "./request-service";
import { transition } from "../state-machine";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type { createInvoiceSchema, listQuerySchema } from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createInvoiceSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["issueDate", "dueDate", "createdAt", "totalAmount", "invoiceNumber", "status"] as const;

/** Money tolerance for matching. Below this, rounding is not a variance. */
const PRICE_TOLERANCE = 0.01;
/** Proportional tolerance on unit price — 2% covers freight and FX rounding. */
const PRICE_TOLERANCE_PCT = 2;

const invoiceInclude = {
  lineItems: { orderBy: { sortOrder: "asc" } },
  vendor: { select: { id: true, companyName: true, email: true, bankName: true, bankAccount: true, paymentTerms: true } },
  purchaseOrder: {
    select: { id: true, poNumber: true, status: true, totalAmount: true, requestId: true },
  },
  goodsReceipt: { select: { id: true, receiptNumber: true, receivedDate: true } },
  payments: {
    select: { id: true, paymentNumber: true, amount: true, status: true, paymentDate: true, method: true },
  },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceInclude;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "invoices.view");
  const tdb = scoped(ctx);

  const where: Prisma.InvoiceWhereInput = {};
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as InvoiceStatus[] };
  }
  if (q.vendorId && q.vendorId !== "ALL") where.vendorId = q.vendorId;
  if (q.from || q.to) {
    where.issueDate = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }
  if (q.search) {
    where.OR = [
      { invoiceNumber: { contains: q.search, mode: "insensitive" } },
      { vendorInvoiceRef: { contains: q.search, mode: "insensitive" } },
      { vendor: { companyName: { contains: q.search, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q.search, mode: "insensitive" } } },
    ];
  }

  const [total, items] = await Promise.all([
    tdb.invoice.count({ where }),
    tdb.invoice.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "issueDate"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: invoiceInclude,
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "invoices.view");
  const invoice = await scoped(ctx).invoice.findUnique({ where: { id }, include: invoiceInclude });
  if (!invoice) throw notFound("Invoice not found");
  const match = await evaluateMatch(ctx.principal.organizationId, id);
  return { ...invoice, match };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchResult {
  status: MatchStatus;
  type: "NONE" | "TWO_WAY" | "THREE_WAY";
  variance: number;
  issues: { line: string; kind: string; detail: string }[];
  /**
   * The same findings in a form that can be stored, assigned and resolved.
   * `issues` is what a person reads; these are what the platform keeps.
   */
  exceptions: MatchException[];
  canApprove: boolean;
}

export interface MatchException {
  type: MatchExceptionType;
  invoiceLineId: string | null;
  poLineItemId: string | null;
  orderedQty: number | null;
  receivedQty: number | null;
  invoicedQty: number | null;
  orderedPrice: number | null;
  invoicedPrice: number | null;
  variance: number | null;
  variancePct: number | null;
  tolerancePct: number | null;
  detail: string;
}

/**
 * Runs the match. 3-way when a receipt exists, 2-way when only a PO does.
 *
 * A variance does not block approval outright — procurement staff legitimately
 * accept small differences — but it is surfaced and recorded so approving a
 * mismatched invoice is a visible, audited decision rather than an accident.
 */
export async function evaluateMatch(
  organizationId: string,
  invoiceId: string
): Promise<MatchResult> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      lineItems: true,
      purchaseOrder: { include: { lineItems: true, goodsReceipts: { include: { items: true } } } },
    },
  });
  if (!invoice) throw notFound("Invoice not found");

  const issues: MatchResult["issues"] = [];
  const exceptions: MatchException[] = [];

  if (!invoice.purchaseOrder) {
    return {
      status: "NO_PO",
      type: "NONE",
      variance: 0,
      issues: [
        {
          line: "—",
          kind: "NO_PO",
          detail: "This invoice is not linked to a purchase order, so it cannot be matched.",
        },
      ],
      exceptions: [
        {
          type: "NO_PO_LINE",
          invoiceLineId: null,
          poLineItemId: null,
          orderedQty: null,
          receivedQty: null,
          invoicedQty: null,
          orderedPrice: null,
          invoicedPrice: null,
          variance: null,
          variancePct: null,
          tolerancePct: null,
          detail: "Invoice is not linked to a purchase order.",
        },
      ],
      canApprove: true,
    };
  }

  const po = invoice.purchaseOrder;
  const poLineById = new Map(po.lineItems.map((l) => [l.id, l]));

  // Cumulative received quantity per PO line across every posted receipt.
  const receivedByLine = new Map<string, number>();
  for (const receipt of po.goodsReceipts) {
    if (!receipt.postedAt) continue;
    for (const item of receipt.items) {
      receivedByLine.set(
        item.poLineItemId,
        (receivedByLine.get(item.poLineItemId) ?? 0) + item.receivedQty
      );
    }
  }

  const hasReceipts = receivedByLine.size > 0;
  const type: MatchResult["type"] = hasReceipts ? "THREE_WAY" : "TWO_WAY";

  let variance = 0;
  let priceVariance = false;
  let quantityVariance = false;

  for (const invLine of invoice.lineItems) {
    const poLine = invLine.poLineItemId
      ? poLineById.get(invLine.poLineItemId)
      : po.lineItems.find((l) => l.itemName === invLine.itemName);

    if (!poLine) {
      issues.push({
        line: invLine.itemName,
        kind: "UNMATCHED_LINE",
        detail: `"${invLine.itemName}" does not appear on ${po.poNumber}.`,
      });
      const lineValue = invLine.quantity * invLine.unitPrice;
      variance += lineValue;
      quantityVariance = true;
      exceptions.push({
        type: "NO_PO_LINE",
        invoiceLineId: invLine.id,
        poLineItemId: null,
        orderedQty: null,
        receivedQty: null,
        invoicedQty: invLine.quantity,
        orderedPrice: null,
        invoicedPrice: invLine.unitPrice,
        variance: lineValue,
        variancePct: null,
        tolerancePct: null,
        detail: `"${invLine.itemName}" does not appear on ${po.poNumber}.`,
      });
      continue;
    }

    // Price check against the ordered unit price.
    const priceDelta = Math.abs(invLine.unitPrice - poLine.unitPrice);
    const pctDelta = poLine.unitPrice > 0 ? (priceDelta / poLine.unitPrice) * 100 : 0;
    if (priceDelta > PRICE_TOLERANCE && pctDelta > PRICE_TOLERANCE_PCT) {
      priceVariance = true;
      variance += priceDelta * invLine.quantity;
      issues.push({
        line: invLine.itemName,
        kind: "PRICE_VARIANCE",
        detail: `Invoiced at ${invLine.unitPrice.toFixed(2)} per ${invLine.unit} against an ordered price of ${poLine.unitPrice.toFixed(2)} (${pctDelta.toFixed(1)}% difference).`,
      });
      exceptions.push({
        type: "PRICE_VARIANCE",
        invoiceLineId: invLine.id,
        poLineItemId: poLine.id,
        orderedQty: poLine.orderedQty,
        receivedQty: receivedByLine.get(poLine.id) ?? 0,
        invoicedQty: invLine.quantity,
        orderedPrice: poLine.unitPrice,
        invoicedPrice: invLine.unitPrice,
        variance: priceDelta * invLine.quantity,
        variancePct: pctDelta,
        tolerancePct: PRICE_TOLERANCE_PCT,
        detail: `Invoiced at ${invLine.unitPrice.toFixed(2)} against an ordered ${poLine.unitPrice.toFixed(2)}.`,
      });
    }

    // Quantity check: 3-way against goods received, 2-way against goods ordered.
    const ceiling = hasReceipts
      ? (receivedByLine.get(poLine.id) ?? 0)
      : poLine.orderedQty;
    const alreadyInvoiced = poLine.invoicedQty;
    const available = ceiling - alreadyInvoiced;

    if (invLine.quantity > available + 0.0001) {
      quantityVariance = true;
      variance += (invLine.quantity - Math.max(0, available)) * invLine.unitPrice;
      issues.push({
        line: invLine.itemName,
        kind: "QUANTITY_VARIANCE",
        detail: hasReceipts
          ? `Invoiced ${invLine.quantity} ${invLine.unit} but only ${Math.max(0, available)} have been received and not yet invoiced.`
          : `Invoiced ${invLine.quantity} ${invLine.unit} but only ${Math.max(0, available)} remain uninvoiced on the order. No goods receipt exists, so this is a 2-way match only.`,
      });
      exceptions.push({
        // Billed for more than was received is a different problem from billed for
        // goods that never arrived at all, and the two are chased differently.
        type: hasReceipts && (receivedByLine.get(poLine.id) ?? 0) === 0 ? "NOT_RECEIVED" : "OVER_INVOICED",
        invoiceLineId: invLine.id,
        poLineItemId: poLine.id,
        orderedQty: poLine.orderedQty,
        receivedQty: receivedByLine.get(poLine.id) ?? 0,
        invoicedQty: invLine.quantity,
        orderedPrice: poLine.unitPrice,
        invoicedPrice: invLine.unitPrice,
        variance: (invLine.quantity - Math.max(0, available)) * invLine.unitPrice,
        variancePct:
          available > 0 ? ((invLine.quantity - available) / available) * 100 : null,
        tolerancePct: 0,
        detail: hasReceipts
          ? `Invoiced ${invLine.quantity}, receivable ${Math.max(0, available)}.`
          : `Invoiced ${invLine.quantity} with no goods receipt posted.`,
      });
    }
  }

  if (!hasReceipts) {
    issues.push({
      line: "—",
      kind: "NO_RECEIPT",
      detail: `No goods receipt has been posted against ${po.poNumber}. Only a 2-way (PO ↔ invoice) match is possible.`,
    });
    exceptions.push({
      type: "NOT_RECEIVED",
      invoiceLineId: null,
      poLineItemId: null,
      orderedQty: null,
      receivedQty: 0,
      invoicedQty: null,
      orderedPrice: null,
      invoicedPrice: null,
      variance: null,
      variancePct: null,
      tolerancePct: null,
      detail: `No goods receipt posted against ${po.poNumber}; 2-way match only.`,
    });
  }

  if (invoice.currency !== po.currency) {
    exceptions.push({
      type: "CURRENCY_MISMATCH",
      invoiceLineId: null,
      poLineItemId: null,
      orderedQty: null,
      receivedQty: null,
      invoicedQty: null,
      orderedPrice: null,
      invoicedPrice: null,
      variance: null,
      variancePct: null,
      tolerancePct: null,
      detail: `Invoice is in ${invoice.currency} but ${po.poNumber} was raised in ${po.currency}.`,
    });
    issues.push({
      line: "—",
      kind: "CURRENCY_MISMATCH",
      detail: `Invoice currency ${invoice.currency} does not match the order currency ${po.currency}.`,
    });
  }

  const status = quantityVariance
    ? "QUANTITY_VARIANCE"
    : priceVariance
      ? "PRICE_VARIANCE"
      : hasReceipts
        ? "MATCHED"
        : "NO_RECEIPT";

  return { status, type, variance, issues, exceptions, canApprove: true };
}

/**
 * Writes the match findings down.
 *
 * Exceptions are replaced rather than appended on each run, except for any an
 * operator has already accepted or resolved — those are decisions about this
 * invoice and re-running the match must not quietly erase them.
 */
export async function persistMatch(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
  match: MatchResult
): Promise<void> {
  await tx.invoiceMatchException.deleteMany({
    where: { invoiceId, status: "OPEN" },
  });

  if (match.exceptions.length > 0) {
    await tx.invoiceMatchException.createMany({
      data: match.exceptions.map((e) => ({
        organizationId,
        invoiceId,
        invoiceLineId: e.invoiceLineId,
        poLineItemId: e.poLineItemId,
        type: e.type,
        status: "OPEN" as const,
        orderedQty: e.orderedQty,
        receivedQty: e.receivedQty,
        invoicedQty: e.invoicedQty,
        orderedPrice: e.orderedPrice,
        invoicedPrice: e.invoicedPrice,
        variance: e.variance,
        variancePct: e.variancePct,
        tolerancePct: e.tolerancePct,
        detail: e.detail,
      })),
    });
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      matchStatus: match.status,
      matchVariance: match.variance,
      matchNotes: match.issues.length ? JSON.stringify(match.issues) : null,
      matchedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Create / submit
// ---------------------------------------------------------------------------

function computeTotals(lines: { quantity: number; unitPrice: number; taxRate: number }[]) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const taxAmount = lines.reduce((s, l) => s + l.quantity * l.unitPrice * (l.taxRate / 100), 0);
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "invoices.create");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const vendor = await tdb.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) throw validation("The selected vendor does not exist");

  // Duplicate detection — the same vendor reference twice is the classic
  // duplicate-payment vector, and the schema also enforces this with a unique index.
  if (input.vendorInvoiceRef) {
    const duplicate = await tdb.invoice.findFirst({
      where: { vendorId: input.vendorId, vendorInvoiceRef: input.vendorInvoiceRef },
    });
    if (duplicate) {
      throw conflict(
        `${vendor.companyName} has already submitted invoice reference "${input.vendorInvoiceRef}" (recorded as ${duplicate.invoiceNumber}).`,
        { duplicateOf: duplicate.id, invoiceNumber: duplicate.invoiceNumber }
      );
    }
  }

  let lineItems = input.lineItems ?? [];

  if (input.purchaseOrderId) {
    const po = await tdb.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (!po) throw validation("The linked purchase order does not exist");
    if (po.vendorId !== input.vendorId) {
      throw validation(
        `${po.poNumber} was issued to a different vendor. An invoice must come from the vendor named on the order.`
      );
    }
    if (po.status === "CANCELLED") {
      throw conflict(`${po.poNumber} has been cancelled and cannot be invoiced`);
    }

    // Default to what has been received but not yet billed — the quantity a
    // supplier is actually entitled to invoice for right now.
    if (lineItems.length === 0) {
      lineItems = po.lineItems
        .map((li) => ({
          poLineItemId: li.id,
          itemName: li.itemName,
          description: li.description ?? "",
          quantity: Math.max(0, li.receivedQty - li.invoicedQty),
          unit: li.unit,
          unitPrice: li.unitPrice,
          taxRate: li.taxRate,
        }))
        .filter((li) => li.quantity > 0);

      if (lineItems.length === 0) {
        throw conflict(
          `Nothing on ${po.poNumber} is awaiting invoicing — every received quantity has already been billed.`
        );
      }
    }
  }

  if (lineItems.length === 0) {
    throw validation("Add at least one line item, or link this invoice to a purchase order");
  }

  const totals = computeTotals(lineItems);
  const org = await db.organization.findUnique({ where: { id: organizationId } });

  const invoice = await db.$transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(organizationId, PREFIX.invoice, { client: tx });
    return tx.invoice.create({
      data: {
        organizationId,
        invoiceNumber,
        vendorInvoiceRef: input.vendorInvoiceRef || null,
        vendorId: input.vendorId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        goodsReceiptId: input.goodsReceiptId ?? null,
        status: input.submit ? "SUBMITTED" : "DRAFT",
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        paidAmount: 0,
        balance: totals.totalAmount,
        currency: org?.currency ?? "USD",
        notes: input.notes || null,
        submittedById: ctx.principal.userId,
        lineItems: {
          create: lineItems.map((li, i) => ({
            poLineItemId: li.poLineItemId ?? null,
            itemName: li.itemName,
            description: li.description || null,
            quantity: li.quantity,
            unit: li.unit,
            unitPrice: li.unitPrice,
            taxRate: li.taxRate,
            sortOrder: i,
          })),
        },
      },
      include: invoiceInclude,
    });
  });

  const match = await evaluateMatch(organizationId, invoice.id);
  await db.$transaction((tx) => persistMatch(tx, organizationId, invoice.id, match));

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: input.submit ? "invoice.submitted" : "invoice.created",
    resource: "Invoice",
    resourceId: invoice.id,
    after: {
      invoiceNumber: invoice.invoiceNumber,
      vendor: vendor.companyName,
      totalAmount: invoice.totalAmount,
      matchStatus: match.status,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "STATUS_CHANGE",
    description: `${ctx.principal.name} recorded invoice ${invoice.invoiceNumber} from ${vendor.companyName} (${invoice.totalAmount.toLocaleString()})`,
    vendorId: vendor.id,
    context: ctx.context,
  });

  if (input.submit) {
    const finance = await db.user.findMany({
      where: { organizationId, role: { in: ["FINANCE_OFFICER", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
    });
    await emit({
      type: match.status === "MATCHED" || match.status === "NO_PO" ? "invoice.submitted" : "invoice.match_failed",
      organizationId,
      actorId: ctx.principal.userId,
      recipientIds: finance.map((f) => f.id),
      title: `Invoice ${invoice.invoiceNumber} awaiting approval`,
      message:
        match.status === "MATCHED"
          ? `${vendor.companyName} — ${invoice.totalAmount.toLocaleString()}. 3-way match clean.`
          : `${vendor.companyName} — ${invoice.totalAmount.toLocaleString()}. Match status: ${match.status.replace(/_/g, " ").toLowerCase()}${match.variance ? `, variance ${match.variance.toFixed(2)}` : ""}.`,
      severity: match.status === "MATCHED" ? "info" : "warning",
      link: "invoices",
      entityType: "INVOICE",
      entityId: invoice.id,
    });
  }

  return getById(ctx, invoice.id);
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export async function approve(ctx: ServiceContext, id: string, note?: string) {
  // Invoice approval is a finance control, gated on budget management rather than
  // request approval — a department manager who can approve a requisition should
  // not thereby be able to authorise paying a supplier.
  await assertPermission(ctx.principal, "invoices.approve");

  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const invoice = await tdb.invoice.findUnique({
    where: { id },
    include: { lineItems: true, vendor: true, purchaseOrder: { include: { request: true } } },
  });
  if (!invoice) throw notFound("Invoice not found");

  if (!["SUBMITTED", "UNDER_REVIEW", "MATCHED", "DISPUTED"].includes(invoice.status)) {
    throw conflict(`An invoice in ${invoice.status.toLowerCase()} state cannot be approved`);
  }

  const match = await evaluateMatch(organizationId, id);

  // Approving an invoice recognises a liability. §23: the status change, the
  // invoiced quantities, the match record and the budget movement are one
  // operation — a liability recognised without the budget seeing it is exactly
  // the kind of half-completed state the mandate rules out.
  const nextStatus = transition("invoice", invoice.status, "APPROVED");
  const departmentId =
    invoice.purchaseOrder?.request?.departmentId ?? invoice.purchaseOrder?.departmentId ?? null;

  await db.$transaction(async (tx) => {
    // Advance invoiced quantities on the PO lines, so the fourth quantity in
    // ordered/received/invoiced/paid becomes true of the data.
    for (const line of invoice.lineItems) {
      if (!line.poLineItemId) continue;
      await tx.pOLineItem.update({
        where: { id: line.poLineItemId },
        data: { invoicedQty: { increment: line.quantity } },
      });
    }

    await persistMatch(tx, organizationId, id, match);

    await tx.invoice.update({
      where: { id },
      data: {
        status: nextStatus,
        approvedById: ctx.principal.userId,
        approvedAt: new Date(),
      },
    });

    if (departmentId) {
      await budgetEngine.actualiseForInvoice(
        { organizationId, departmentId },
        invoice.totalAmount,
        invoice.id,
        invoice.purchaseOrderId,
        ctx.principal.userId,
        tx
      );
    }
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "invoice.approved",
    resource: "Invoice",
    resourceId: id,
    before: { status: invoice.status },
    after: {
      status: "APPROVED",
      matchStatus: match.status,
      variance: match.variance,
      note,
      // An approval over a variance is recorded as an explicit override.
      overrodeVariance: match.status !== "MATCHED" && match.status !== "NO_PO",
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "STATUS_CHANGE",
    description: `${ctx.principal.name} approved invoice ${invoice.invoiceNumber} from ${invoice.vendor.companyName}${match.status !== "MATCHED" ? ` (over a ${match.status.replace(/_/g, " ").toLowerCase()})` : ""}`,
    severity: match.status === "MATCHED" ? "SUCCESS" : "WARNING",
    vendorId: invoice.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "invoice.approved",
    organizationId,
    vendorId: invoice.vendorId,
    actorId: ctx.principal.userId,
    title: `Invoice ${invoice.invoiceNumber} approved`,
    message: `${invoice.totalAmount.toLocaleString()} approved for payment. Due ${invoice.dueDate.toDateString()}.`,
    severity: "success",
    link: "invoices",
    entityType: "INVOICE",
    entityId: id,
  });

  await db.supplierActivity.create({
    data: {
      vendorId: invoice.vendorId,
      type: "INVOICE_SUBMITTED",
      description: `Invoice ${invoice.invoiceNumber} approved for payment`,
      referenceId: id,
    },
  });

  return getById(ctx, id);
}

export async function reject(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "invoices.reject");
  const tdb = scoped(ctx);

  const invoice = await tdb.invoice.findUnique({ where: { id }, include: { vendor: true } });
  if (!invoice) throw notFound("Invoice not found");
  if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") {
    throw conflict("An invoice that has been paid cannot be rejected");
  }

  await tdb.invoice.update({
    where: { id },
    data: { status: "REJECTED", rejectedReason: reason },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "invoice.rejected",
    resource: "Invoice",
    resourceId: id,
    before: { status: invoice.status },
    after: { status: "REJECTED", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "STATUS_CHANGE",
    description: `${ctx.principal.name} rejected invoice ${invoice.invoiceNumber} — ${reason}`,
    severity: "WARNING",
    vendorId: invoice.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "invoice.rejected",
    organizationId: ctx.principal.organizationId,
    vendorId: invoice.vendorId,
    actorId: ctx.principal.userId,
    title: `Invoice ${invoice.invoiceNumber} rejected`,
    message: reason,
    severity: "error",
    entityType: "INVOICE",
    entityId: id,
  });

  return getById(ctx, id);
}

/**
 * Recomputes payment position after a payment settles.
 *
 * Called by the payment service. `balance` and `status` are derived from completed
 * payments only — a scheduled or failed payment must never reduce what is owed.
 */
export async function refreshPaymentPosition(organizationId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { payments: true, purchaseOrder: true },
  });
  if (!invoice) return;

  // Read from allocations, not from payment totals: a payment may settle several
  // invoices, and only the part allocated to this one reduces its balance. The
  // fallback covers payments recorded before allocations existed.
  const allocations = await db.paymentAllocation.findMany({
    where: { invoiceId, payment: { status: "COMPLETED" } },
  });
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const unallocated = invoice.payments
    .filter((p) => p.status === "COMPLETED" && !allocations.some((a) => a.paymentId === p.id))
    .reduce((s, p) => s + p.amount, 0);
  const paid = allocated + unallocated;

  const balance = Math.max(0, invoice.totalAmount - paid);

  let status: InvoiceStatus = invoice.status;
  if (paid >= invoice.totalAmount - 0.01) status = "PAID";
  else if (paid > 0) status = "PARTIALLY_PAID";
  else if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") status = "APPROVED";

  await db.invoice.update({
    where: { id: invoiceId },
    data: { paidAmount: paid, balance, status },
  });

  if (status === "PAID" && invoice.purchaseOrder?.requestId) {
    await requestService.reconcileCompletion(organizationId, invoice.purchaseOrder.requestId);
  }
}

/** Flags approved invoices past their due date. Safe to run repeatedly. */
export async function flagOverdue(organizationId: string) {
  const overdue = await db.invoice.findMany({
    where: {
      organizationId,
      status: { in: ["APPROVED", "PARTIALLY_PAID", "SUBMITTED"] },
      dueDate: { lt: new Date() },
    },
    include: { vendor: { select: { companyName: true } } },
  });
  if (overdue.length === 0) return 0;

  await db.invoice.updateMany({
    where: { id: { in: overdue.map((i) => i.id) } },
    data: { status: "OVERDUE" },
  });

  const finance = await db.user.findMany({
    where: { organizationId, role: { in: ["FINANCE_OFFICER", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
  });

  for (const inv of overdue) {
    await emit({
      type: "invoice.overdue",
      organizationId,
      recipientIds: finance.map((f) => f.id),
      title: `Invoice ${inv.invoiceNumber} is overdue`,
      message: `${inv.vendor.companyName} — ${inv.balance.toLocaleString()} outstanding, due ${inv.dueDate.toDateString()}.`,
      severity: "error",
      link: "invoices",
      entityType: "INVOICE",
      entityId: inv.id,
    });
  }

  return overdue.length;
}
