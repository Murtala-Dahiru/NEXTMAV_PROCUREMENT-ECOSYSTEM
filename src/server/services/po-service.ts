// NextMav Procure — purchase order service.
//
// A PO is the hinge of the whole platform: it connects request, RFQ, vendor,
// budget, receiving, invoice and payment. Two behaviours differ deliberately from
// the previous implementation:
//
//  1. Issuing a PO no longer marks the originating request COMPLETED. It commits
//     budget and moves the request into fulfilment. Completion happens when goods
//     are received and invoices are settled.
//  2. PO status is *derived* from cumulative receipts rather than set by hand, so
//     a PO cannot claim to be RECEIVED while lines are still outstanding.

import type { Prisma, PurchaseOrderStatus, RequestStatus } from "@prisma/client";
import { db, type Numeric } from "../db";
import { conflict, notFound, validation, forbidden } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import * as budgetEngine from "../engines/budget";
import { canTransition, transition } from "../state-machine";
import { enqueue } from "../engines/outbox";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createPoSchema,
  revisePoSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createPoSchema>;
type ReviseInput = z.infer<typeof revisePoSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["createdAt", "issuedAt", "expectedDelivery", "totalAmount", "poNumber", "status"] as const;

const poInclude = {
  lineItems: { orderBy: { sortOrder: "asc" } },
  revisions: { orderBy: { version: "desc" } },
  vendor: {
    select: { id: true, companyName: true, email: true, phone: true, address: true, status: true, paymentTerms: true },
  },
  request: { select: { id: true, requestNumber: true, title: true, departmentId: true } },
  rfq: { select: { id: true, rfqNumber: true, title: true } },
  goodsReceipts: {
    include: { items: true },
    orderBy: { receivedDate: "desc" },
  },
  invoices: {
    select: { id: true, invoiceNumber: true, status: true, totalAmount: true, paidAmount: true, balance: true, dueDate: true },
  },
  contract: { select: { id: true, contractNumber: true, title: true } },
} satisfies Prisma.PurchaseOrderInclude;

/** Money is recomputed server-side; a client-supplied total is never trusted. */
function totals(
  lineItems: { quantity: number; unitPrice: number; taxRate: number }[],
  headerTaxRate: number,
  discountAmount: number
) {
  const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);

  // A line-level tax rate overrides the header rate for that line, which is how
  // mixed-rate orders (zero-rated goods alongside standard-rated services) work.
  const taxAmount = lineItems.reduce((s, li) => {
    const rate = li.taxRate > 0 ? li.taxRate : headerTaxRate;
    return s + li.quantity * li.unitPrice * (rate / 100);
  }, 0);

  const discounted = Math.max(0, subtotal - discountAmount);
  return {
    subtotal,
    taxAmount,
    discountAmount,
    totalAmount: discounted + taxAmount,
  };
}

/**
 * Derives PO status from its lines.
 *
 * `rejectedQty` counts toward settlement: a line where 8 arrived and 2 were
 * rejected is closed on that PO — the shortfall is a supplier performance issue,
 * not an open receipt.
 */
export function deriveStatus(
  current: PurchaseOrderStatus,
  lines: { orderedQty: number; receivedQty: number; rejectedQty: number }[]
): PurchaseOrderStatus {
  if (["DRAFT", "PENDING_APPROVAL", "CANCELLED", "CLOSED"].includes(current)) return current;
  if (lines.length === 0) return current;

  const settled = lines.every((l) => l.receivedQty + l.rejectedQty >= l.orderedQty);
  const started = lines.some((l) => l.receivedQty > 0 || l.rejectedQty > 0);

  if (settled) return "RECEIVED";
  if (started) return "PARTIALLY_RECEIVED";
  // Acknowledgement is a supplier action and must not be undone by this function.
  return current === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : current;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const tdb = scoped(ctx);

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as PurchaseOrderStatus[] };
  }
  if (q.vendorId && q.vendorId !== "ALL") where.vendorId = q.vendorId;
  if (q.from || q.to) {
    where.issuedAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }
  if (q.search) {
    where.OR = [
      { poNumber: { contains: q.search, mode: "insensitive" } },
      { vendor: { companyName: { contains: q.search, mode: "insensitive" } } },
      { lineItems: { some: { itemName: { contains: q.search, mode: "insensitive" } } } },
    ];
  }

  const [total, items] = await Promise.all([
    tdb.purchaseOrder.count({ where }),
    tdb.purchaseOrder.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        vendor: { select: { id: true, companyName: true, status: true } },
        request: { select: { id: true, requestNumber: true } },
        _count: { select: { goodsReceipts: true, invoices: true } },
      },
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const po = await scoped(ctx).purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw notFound("Purchase order not found");
  return { ...po, fulfilment: fulfilmentSummary(po) };
}

/**
 * The four-quantity picture §13 requires, per line and in aggregate:
 * ordered ≠ received ≠ invoiced ≠ paid.
 */
export function fulfilmentSummary(
  po: Numeric<Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>>
) {
  const lines = po.lineItems.map((li) => ({
    id: li.id,
    itemName: li.itemName,
    unit: li.unit,
    unitPrice: li.unitPrice,
    orderedQty: li.orderedQty,
    receivedQty: li.receivedQty,
    rejectedQty: li.rejectedQty,
    invoicedQty: li.invoicedQty,
    outstandingQty: Math.max(0, li.orderedQty - li.receivedQty - li.rejectedQty),
    uninvoicedQty: Math.max(0, li.receivedQty - li.invoicedQty),
    lineTotal: li.orderedQty * li.unitPrice,
  }));

  const invoicedAmount = po.invoices
    .filter((i) => i.status !== "CANCELLED" && i.status !== "REJECTED")
    .reduce((s, i) => s + i.totalAmount, 0);
  const paidAmount = po.invoices.reduce((s, i) => s + i.paidAmount, 0);

  return {
    lines,
    orderedAmount: po.totalAmount,
    receivedValue: lines.reduce((s, l) => s + l.receivedQty * l.unitPrice, 0),
    invoicedAmount,
    paidAmount,
    outstandingToReceive: lines.reduce((s, l) => s + l.outstandingQty * l.unitPrice, 0),
    outstandingToInvoice: Math.max(0, po.totalAmount - invoicedAmount),
    outstandingToPay: Math.max(0, invoicedAmount - paidAmount),
    isFullyReceived: lines.every((l) => l.outstandingQty === 0),
    isFullyInvoiced: invoicedAmount >= po.totalAmount - 0.01,
    isFullyPaid: paidAmount >= invoicedAmount - 0.01 && invoicedAmount > 0,
  };
}

// ---------------------------------------------------------------------------
// Create / issue
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "purchaseOrders.create");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const vendor = await tdb.vendor.findUnique({ where: { id: input.vendorId } });
  if (!vendor) throw validation("The selected vendor does not exist");
  if (vendor.status === "BLACKLISTED") {
    throw conflict(`${vendor.companyName} is blacklisted — no purchase order may be raised`);
  }
  if (vendor.status === "ARCHIVED") {
    throw conflict(`${vendor.companyName} is archived. Reactivate the vendor before ordering.`);
  }

  let request: Awaited<ReturnType<typeof tdb.purchaseRequest.findUnique>> = null;
  if (input.requestId) {
    request = await tdb.purchaseRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw validation("The linked purchase request does not exist");
    const orderable: RequestStatus[] = [
      "APPROVED",
      "IN_PROCUREMENT",
      "ORDERED",
      "PARTIALLY_FULFILLED",
    ];
    if (!orderable.includes(request.status)) {
      throw conflict(
        `A purchase order can only be raised against an approved request — ${request.requestNumber} is ${request.status.replace(/_/g, " ").toLowerCase()}`
      );
    }
  }

  const amounts = totals(input.lineItems, input.taxRate, input.discountAmount);
  const org = await db.organization.findUnique({ where: { id: organizationId } });

  const po = await db.$transaction(async (tx) => {
    const poNumber = await nextDocumentNumber(organizationId, PREFIX.purchaseOrder, { client: tx });
    return tx.purchaseOrder.create({
      data: {
        organizationId,
        poNumber,
        requestId: input.requestId ?? null,
        rfqId: input.rfqId ?? null,
        quotationId: input.quotationId ?? null,
        contractId: input.contractId ?? null,
        vendorId: input.vendorId,
        // Finance coding is inherited from the request so spend is reportable
        // against the same department, cost centre and budget that approved it.
        departmentId: request?.departmentId ?? null,
        costCenterId: request?.costCenterId ?? null,
        budgetId: request?.budgetId ?? null,
        categoryId: request?.categoryId ?? null,
        status: input.issue ? "ISSUED" : "DRAFT",
        subtotal: amounts.subtotal,
        taxRate: input.taxRate,
        taxAmount: amounts.taxAmount,
        discountAmount: amounts.discountAmount,
        totalAmount: amounts.totalAmount,
        currency: org?.currency ?? "USD",
        termsAndConditions:
          input.termsAndConditions ??
          "1. Payment terms per vendor agreement.\n2. Goods must meet specifications.\n3. Discrepancies reported within 48 hours.\n4. Subject to the organization's standard procurement policies.",
        notes: input.notes || null,
        deliveryAddress: input.deliveryAddress || null,
        paymentTerms: input.paymentTerms ?? vendor.paymentTerms,
        expectedDelivery: new Date(input.expectedDelivery),
        issuedAt: input.issue ? new Date() : null,
        createdById: ctx.principal.userId,
        lineItems: {
          create: input.lineItems.map((li, i) => ({
            itemName: li.itemName,
            description: li.description || null,
            unit: li.unit,
            unitPrice: li.unitPrice,
            taxRate: li.taxRate,
            orderedQty: li.quantity,
            createsAsset: li.createsAsset,
            assetCategory: li.assetCategory ?? null,
            inventoryItemId: li.inventoryItemId ?? null,
            sortOrder: i,
          })),
        },
        revisions: {
          create: [
            {
              version: 1,
              reason: input.issue ? "Initial issue" : "Draft created",
              modifiedById: ctx.principal.userId,
            },
          ],
        },
      },
      include: poInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: input.issue ? "po.issued" : "po.created",
    resource: "PurchaseOrder",
    resourceId: po.id,
    after: {
      poNumber: po.poNumber,
      vendor: vendor.companyName,
      totalAmount: po.totalAmount,
      status: po.status,
    },
    context: ctx.context,
  });

  if (input.issue) await afterIssue(ctx, po.id);

  return getById(ctx, po.id);
}

/** Issues a draft PO: commits budget, updates the vendor, notifies the supplier. */
/**
 * Submits a purchase order for approval.
 *
 * Separates "the buyer has finished writing it" from "the organization has
 * agreed to spend the money", which is the control an approval gate exists to
 * provide.
 */
export async function submitForApproval(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.create");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw notFound("Purchase order not found");

  const next = transition("purchaseOrder", po.status, "PENDING_APPROVAL");
  await tdb.purchaseOrder.update({ where: { id }, data: { status: next } });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.submitted_for_approval",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: next },
    context: ctx.context,
  });

  return getById(ctx, id);
}

/**
 * Approves a purchase order.
 *
 * Separation of duties: whoever raised the order cannot be the one who approves
 * it. The same rule already governs payments, and it matters more here — this is
 * the point at which the organization commits money to a vendor.
 */
export async function approve(ctx: ServiceContext, id: string, comment?: string) {
  await assertPermission(ctx.principal, "purchaseOrders.approve");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw notFound("Purchase order not found");

  if (po.createdById && po.createdById === ctx.principal.userId) {
    throw forbidden(
      "You raised this purchase order, so you cannot also approve it. Separation of duties requires a second person."
    );
  }
  if (po.vendor.status === "BLACKLISTED") {
    throw conflict(`${po.vendor.companyName} is blacklisted — this order cannot be approved`);
  }

  const next = transition("purchaseOrder", po.status, "APPROVED");
  await tdb.purchaseOrder.update({
    where: { id },
    data: { status: next, approvedById: ctx.principal.userId, approvedAt: new Date() },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.approved",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: next, comment: comment ?? null },
    context: ctx.context,
  });

  return getById(ctx, id);
}

/** Rejects a purchase order that was sent for approval, with a reason. */
export async function reject(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "purchaseOrders.approve");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw notFound("Purchase order not found");

  const next = transition("purchaseOrder", po.status, "REJECTED");
  await tdb.purchaseOrder.update({
    where: { id },
    data: { status: next, rejectedAt: new Date(), rejectionReason: reason },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.rejected",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: next, reason },
    context: ctx.context,
  });

  return getById(ctx, id);
}

export async function issue(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.issue");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw notFound("Purchase order not found");
  if (po.vendor.status === "BLACKLISTED") {
    throw conflict(`${po.vendor.companyName} is blacklisted — this order cannot be issued`);
  }

  // DRAFT → ISSUED is legal for organizations that do not gate POs separately;
  // PENDING_APPROVAL → ISSUED is not, because that order is waiting on a decision
  // that has not been made. The state machine is what draws that line.
  const next = transition("purchaseOrder", po.status, "ISSUED");

  await tdb.purchaseOrder.update({
    where: { id },
    data: { status: next, issuedAt: new Date() },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.issued",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: "ISSUED" },
    context: ctx.context,
  });

  await afterIssue(ctx, id);
  return getById(ctx, id);
}

/** Cross-module effects of issuing: budget, vendor stats, supplier notification. */
async function afterIssue(ctx: ServiceContext, poId: string) {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: { vendor: true, request: true },
  });
  if (!po) return;

  // Committing the budget, moving the request on and updating the supplier's
  // order book are one operation: an order that exists without a commitment
  // against it is a hole in the budget position.
  const departmentId = po.request?.departmentId ?? po.departmentId ?? null;

  await db.$transaction(async (tx) => {
    if (departmentId) {
      await budgetEngine.commitForPurchaseOrder(
        { organizationId: po.organizationId, departmentId },
        po.totalAmount,
        po.id,
        po.requestId,
        ctx.principal.userId,
        tx
      );
    }

    await tx.vendor.update({
      where: { id: po.vendorId },
      data: {
        totalOrders: { increment: 1 },
        totalValue: { increment: po.totalAmount },
        // Ordering from a prospective vendor makes them an active supplier.
        ...(po.vendor.status === "PROSPECTIVE" ? { status: "ACTIVE" as const } : {}),
      },
    });

    // The request is now on order. Its own fulfilment states are driven from the
    // receipts that follow.
    if (po.request && canTransition("request", po.request.status, "ORDERED")) {
      await tx.purchaseRequest.update({
        where: { id: po.request.id },
        data: { status: "ORDERED", orderedAt: po.request.orderedAt ?? new Date() },
      });
    }
  });

  await recordActivity({
    organizationId: po.organizationId,
    userId: ctx.principal.userId,
    eventType: "PO_ISSUED",
    description: `${ctx.principal.name} issued ${po.poNumber} to ${po.vendor.companyName} (${po.totalAmount.toLocaleString()})`,
    severity: "SUCCESS",
    purchaseOrderId: po.id,
    vendorId: po.vendorId,
    context: ctx.context,
  });

  await db.supplierActivity.create({
    data: {
      vendorId: po.vendorId,
      type: "PO_ACKNOWLEDGED",
      description: `Purchase order ${po.poNumber} issued — awaiting acknowledgement`,
      referenceId: po.id,
    },
  });

  await emit({
    type: "po.issued",
    organizationId: po.organizationId,
    vendorId: po.vendorId,
    actorId: ctx.principal.userId,
    recipientIds: po.request ? [po.request.requestedById] : [],
    title: `Purchase order ${po.poNumber} issued`,
    message: `${po.poNumber} for ${po.totalAmount.toLocaleString()} has been issued to ${po.vendor.companyName}.`,
    severity: "success",
    link: "purchase-orders",
    entityType: "PO",
    entityId: po.id,
    payload: { poNumber: po.poNumber, amount: po.totalAmount, vendorId: po.vendorId },
  });
}

/** Builds a PO directly from an awarded RFQ quotation — the sourcing handoff. */
export async function createFromQuotation(
  ctx: ServiceContext,
  rfqId: string,
  options: { expectedDelivery?: string; issue?: boolean } = {}
) {
  await assertPermission(ctx.principal, "purchaseOrders.create");
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({
    where: { id: rfqId },
    include: {
      selectedQuotation: { include: { lineItems: true, vendor: true } },
      purchaseOrders: true,
    },
  });
  if (!rfq) throw notFound("RFQ not found");
  if (!rfq.selectedQuotation) {
    throw conflict("This RFQ has not been awarded yet — select a winning quotation first");
  }
  if (rfq.purchaseOrders.length > 0) {
    throw conflict("A purchase order has already been raised from this RFQ", {
      existing: rfq.purchaseOrders.map((p) => p.poNumber),
    });
  }

  const q = rfq.selectedQuotation;
  const expected =
    options.expectedDelivery ??
    new Date(Date.now() + (q.deliveryDays || 14) * 86400_000).toISOString();

  return create(ctx, {
    vendorId: q.vendorId,
    requestId: rfq.requestId ?? undefined,
    rfqId: rfq.id,
    quotationId: q.id,
    expectedDelivery: expected,
    paymentTerms: q.paymentTerms ?? undefined,
    taxRate: 0,
    discountAmount: 0,
    notes: `Raised from ${rfq.rfqNumber} — awarded to ${q.vendor.companyName}.`,
    lineItems: q.lineItems.map((li) => ({
      itemName: li.itemName,
      description: li.description ?? "",
      quantity: li.quantity,
      unit: li.unit,
      unitPrice: li.unitPrice,
      taxRate: li.taxRate,
      createsAsset: false,
    })),
    issue: options.issue ?? true,
  });
}

// ---------------------------------------------------------------------------
// Revision, acknowledgement, cancellation
// ---------------------------------------------------------------------------

export async function revise(ctx: ServiceContext, id: string, input: ReviseInput) {
  await assertPermission(ctx.principal, "purchaseOrders.updateStatus");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw notFound("Purchase order not found");
  if (po.status === "CANCELLED" || po.status === "CLOSED") {
    throw conflict(`A ${po.status.toLowerCase()} purchase order cannot be revised`);
  }

  // Revising quantities after goods have arrived would invalidate the receipts.
  const hasReceipts = po.lineItems.some((l) => l.receivedQty > 0 || l.rejectedQty > 0);
  if (input.lineItems && hasReceipts) {
    throw conflict(
      "Line items cannot be revised after goods have been received against this order. Cancel the remaining balance instead."
    );
  }

  const nextTaxRate = input.taxRate ?? po.taxRate;
  const nextDiscount = input.discountAmount ?? po.discountAmount;
  const amounts = input.lineItems
    ? totals(input.lineItems, nextTaxRate, nextDiscount)
    : totals(
        po.lineItems.map((l) => ({ quantity: l.orderedQty, unitPrice: l.unitPrice, taxRate: l.taxRate })),
        nextTaxRate,
        nextDiscount
      );

  const previousTotal = po.totalAmount;

  const updated = await db.$transaction(async (tx) => {
    await tx.pORevision.create({
      data: {
        purchaseOrderId: id,
        version: po.version + 1,
        reason: input.reason,
        snapshot: JSON.stringify({
          totalAmount: po.totalAmount,
          expectedDelivery: po.expectedDelivery,
          lineItems: po.lineItems.map((l) => ({
            itemName: l.itemName,
            orderedQty: l.orderedQty,
            unitPrice: l.unitPrice,
          })),
        }),
        modifiedById: ctx.principal.userId,
      },
    });

    if (input.lineItems) {
      await tx.pOLineItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.pOLineItem.createMany({
        data: input.lineItems.map((li, i) => ({
          purchaseOrderId: id,
          itemName: li.itemName,
          description: li.description || null,
          unit: li.unit,
          unitPrice: li.unitPrice,
          taxRate: li.taxRate,
          orderedQty: li.quantity,
          createsAsset: li.createsAsset,
          assetCategory: li.assetCategory ?? null,
          inventoryItemId: li.inventoryItemId ?? null,
          sortOrder: i,
        })),
      });
    }

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        version: { increment: 1 },
        subtotal: amounts.subtotal,
        taxRate: nextTaxRate,
        taxAmount: amounts.taxAmount,
        discountAmount: amounts.discountAmount,
        totalAmount: amounts.totalAmount,
        expectedDelivery: input.expectedDelivery ? new Date(input.expectedDelivery) : undefined,
        notes: input.notes ?? undefined,
        // A revised order must be re-acknowledged by the supplier.
        status: po.status === "ACKNOWLEDGED" ? "ISSUED" : po.status,
      } as Prisma.PurchaseOrderUncheckedUpdateInput,
    });
  });

  // Keep the budget commitment aligned with the revised value.
  const delta = amounts.totalAmount - previousTotal;
  if (delta !== 0 && po.request?.departmentId) {
    const budget = await budgetEngine.findBudget({
      organizationId: ctx.principal.organizationId,
      departmentId: po.request.departmentId,
    });
    if (budget) {
      await budgetEngine
        .record({
          budgetId: budget.id,
          type: "COMMITTED",
          amount: delta,
          purchaseOrderId: id,
          requestId: po.requestId,
          description: `Commitment adjusted by PO revision v${po.version + 1}`,
          createdById: ctx.principal.userId,
        })
        .catch((err) => console.error("[po] revision budget adjustment failed", err));
    }
  }

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.revised",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { version: po.version, totalAmount: previousTotal },
    after: { version: updated.version, totalAmount: amounts.totalAmount, reason: input.reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "PO_REVISED",
    description: `${ctx.principal.name} revised ${po.poNumber} to v${updated.version} — ${input.reason}`,
    severity: "WARNING",
    purchaseOrderId: id,
    vendorId: po.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "po.revised",
    organizationId: ctx.principal.organizationId,
    vendorId: po.vendorId,
    actorId: ctx.principal.userId,
    title: `${po.poNumber} revised to v${updated.version}`,
    message: `${input.reason}. Please review and re-acknowledge.`,
    severity: "warning",
    entityType: "PO",
    entityId: id,
  });

  return getById(ctx, id);
}

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "purchaseOrders.cancel");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw notFound("Purchase order not found");
  if (po.status === "CANCELLED") throw conflict("This purchase order is already cancelled");

  const received = po.lineItems.some((l) => l.receivedQty > 0);
  const invoiced = po.invoices.some((i) => !["CANCELLED", "REJECTED"].includes(i.status));
  if (received || invoiced) {
    throw conflict(
      "This purchase order cannot be cancelled — goods have been received or invoices raised against it.",
      { received, invoiced }
    );
  }

  await tdb.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: reason },
  });

  // Release the budget commitment the order was holding.
  if (po.request?.departmentId) {
    const budget = await budgetEngine.findBudget({
      organizationId: ctx.principal.organizationId,
      departmentId: po.request.departmentId,
    });
    if (budget) {
      await budgetEngine
        .record({
          budgetId: budget.id,
          type: "COMMITTED",
          amount: -po.totalAmount,
          purchaseOrderId: id,
          description: "Commitment released — purchase order cancelled",
          createdById: ctx.principal.userId,
        })
        .catch(() => {});
    }
  }

  await db.vendor.update({
    where: { id: po.vendorId },
    data: { totalOrders: { decrement: 1 }, totalValue: { decrement: po.totalAmount } },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.cancelled",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: "CANCELLED", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "PO_STATUS_UPDATED",
    description: `${ctx.principal.name} cancelled ${po.poNumber} — ${reason}`,
    severity: "WARNING",
    purchaseOrderId: id,
    vendorId: po.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "po.cancelled",
    organizationId: ctx.principal.organizationId,
    vendorId: po.vendorId,
    actorId: ctx.principal.userId,
    title: `${po.poNumber} cancelled`,
    message: reason,
    severity: "error",
    entityType: "PO",
    entityId: id,
  });

  return getById(ctx, id);
}

/** Closes a fully received and fully settled order. */
export async function close(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.updateStatus");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({ where: { id }, include: poInclude });
  if (!po) throw notFound("Purchase order not found");

  const f = fulfilmentSummary(po);
  if (!f.isFullyReceived) {
    throw conflict("This order still has outstanding quantities and cannot be closed");
  }

  await tdb.purchaseOrder.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "po.closed",
    resource: "PurchaseOrder",
    resourceId: id,
    before: { status: po.status },
    after: { status: "CLOSED" },
    context: ctx.context,
  });

  return getById(ctx, id);
}

/** Recomputes and persists a PO's derived status. Called after every receipt. */
export async function refreshStatus(organizationId: string, poId: string) {
  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, organizationId },
    include: { lineItems: true },
  });
  if (!po) return null;

  const next = deriveStatus(po.status, po.lineItems);
  if (next === po.status) return po.status;

  await db.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: next,
      receivedAt: next === "RECEIVED" ? new Date() : po.receivedAt,
    },
  });
  return next;
}
