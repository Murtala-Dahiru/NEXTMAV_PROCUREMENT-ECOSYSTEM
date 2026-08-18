// NextMav Procure — RFQ and sourcing service.
//
// Implements the sourcing lifecycle end to end:
//
//   Create → Invite suppliers → Receive quotations → Compare → Evaluate
//         → Award → Purchase Order
//
// Quotations previously existed only as seed data, because there was no supplier
// application to submit them. They now arrive through the supplier portal
// (see supplier-service.ts) or are captured internally on a supplier's behalf.

import type { Prisma, RFQStatus } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createRfqSchema,
  awardRfqSchema,
  evaluateQuotationSchema,
  submitQuotationSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createRfqSchema>;
type AwardInput = z.infer<typeof awardRfqSchema>;
type EvaluateInput = z.infer<typeof evaluateQuotationSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["createdAt", "deadline", "rfqNumber", "status"] as const;

const rfqInclude = {
  lineItems: { orderBy: { sortOrder: "asc" } },
  invitedVendors: {
    include: {
      vendor: {
        select: { id: true, companyName: true, email: true, status: true, rating: true, onTimeDeliveryRate: true },
      },
    },
  },
  quotations: {
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      vendor: {
        select: { id: true, companyName: true, rating: true, onTimeDeliveryRate: true, qualityRating: true, status: true },
      },
    },
    orderBy: { totalAmount: "asc" },
  },
  request: { select: { id: true, requestNumber: true, title: true, status: true } },
  purchaseOrders: { select: { id: true, poNumber: true, status: true } },
} satisfies Prisma.RFQInclude;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "rfqs.view");
  const tdb = scoped(ctx);

  const where: Prisma.RFQWhereInput = {};
  if (q.status && q.status !== "ALL") where.status = { in: q.status.split(",") as RFQStatus[] };
  if (q.search) {
    where.OR = [
      { rfqNumber: { contains: q.search, mode: "insensitive" } },
      { title: { contains: q.search, mode: "insensitive" } },
      { description: { contains: q.search, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    tdb.rFQ.count({ where }),
    tdb.rFQ.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        invitedVendors: { include: { vendor: { select: { id: true, companyName: true } } } },
        quotations: { select: { id: true, vendorId: true, totalAmount: true, status: true } },
        _count: { select: { quotations: true, invitedVendors: true } },
      },
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  const rfq = await scoped(ctx).rFQ.findUnique({ where: { id }, include: rfqInclude });
  if (!rfq) throw notFound("RFQ not found");
  return { ...rfq, comparison: buildComparison(rfq) };
}

/**
 * The comparison matrix procurement actually needs: not just who is cheapest, but
 * how each bid ranks on price, delivery and supplier performance, and where each
 * line item is best sourced.
 */
function buildComparison(rfq: Prisma.RFQGetPayload<{ include: typeof rfqInclude }>) {
  const live = rfq.quotations.filter((q) => q.status !== "WITHDRAWN" && q.status !== "REJECTED");
  if (live.length === 0) return null;

  const amounts = live.map((q) => q.totalAmount);
  const deliveries = live.map((q) => q.deliveryDays);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const fastest = Math.min(...deliveries);

  const rows = live.map((q) => {
    // Normalised 0-100 sub-scores so price, speed and past performance can be
    // weighed against each other rather than compared in incomparable units.
    const priceScore = highest === lowest ? 100 : ((highest - q.totalAmount) / (highest - lowest)) * 100;
    const deliverySpread = Math.max(...deliveries) - fastest;
    const deliveryScore =
      deliverySpread === 0 ? 100 : ((Math.max(...deliveries) - q.deliveryDays) / deliverySpread) * 100;
    const performanceScore = q.vendor.onTimeDeliveryRate || 0;

    return {
      quotationId: q.id,
      vendorId: q.vendorId,
      vendorName: q.vendor.companyName,
      totalAmount: q.totalAmount,
      currency: q.currency,
      deliveryDays: q.deliveryDays,
      paymentTerms: q.paymentTerms,
      warranty: q.warranty,
      validUntil: q.validUntil,
      status: q.status,
      isLowest: q.totalAmount === lowest,
      isFastest: q.deliveryDays === fastest,
      varianceFromLowest: q.totalAmount - lowest,
      variancePercent: lowest > 0 ? ((q.totalAmount - lowest) / lowest) * 100 : 0,
      vendorRating: q.vendor.rating,
      onTimeDeliveryRate: q.vendor.onTimeDeliveryRate,
      qualityRating: q.vendor.qualityRating,
      evaluationScore: q.evaluationScore,
      priceScore: Math.round(priceScore),
      deliveryScore: Math.round(deliveryScore),
      performanceScore: Math.round(performanceScore),
      // Weighting favours price but does not ignore the supplier's track record.
      compositeScore: Math.round(priceScore * 0.5 + deliveryScore * 0.2 + performanceScore * 0.3),
      lineItems: q.lineItems,
    };
  });

  rows.sort((a, b) => b.compositeScore - a.compositeScore);

  // Per-line best price, so a buyer can see when splitting the award would be cheaper.
  const lineComparison = rfq.lineItems.map((rl) => {
    const bids = live
      .map((q) => {
        const match =
          q.lineItems.find((ql) => ql.rfqLineItemId === rl.id) ??
          q.lineItems.find((ql) => ql.itemName === rl.itemName);
        return match
          ? { vendorId: q.vendorId, vendorName: q.vendor.companyName, unitPrice: match.unitPrice, lineTotal: match.unitPrice * match.quantity }
          : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);

    const best = bids.length ? bids.reduce((m, b) => (b.unitPrice < m.unitPrice ? b : m)) : null;
    return { rfqLineItemId: rl.id, itemName: rl.itemName, quantity: rl.quantity, unit: rl.unit, bids, best };
  });

  return {
    rows,
    lineComparison,
    recommendedQuotationId: rows[0]?.quotationId ?? null,
    lowestAmount: lowest,
    highestAmount: highest,
    potentialSaving: highest - lowest,
    responseRate:
      rfq.invitedVendors.length > 0 ? (live.length / rfq.invitedVendors.length) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Create / invite
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "rfqs.create");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const vendors = await tdb.vendor.findMany({ where: { id: { in: input.invitedVendorIds } } });
  if (vendors.length !== input.invitedVendorIds.length) {
    throw validation("One or more selected suppliers do not exist in this organization");
  }

  // Sourcing from a blacklisted supplier is a compliance failure, not a warning.
  const barred = vendors.filter((v) => v.status === "BLACKLISTED" || v.status === "ARCHIVED");
  if (barred.length > 0) {
    throw validation(
      `Cannot invite ${barred.map((v) => v.companyName).join(", ")} — the supplier is ${barred[0].status.toLowerCase()}`,
      { vendorIds: barred.map((v) => v.id) }
    );
  }

  const deadline = new Date(input.deadline);
  if (deadline.getTime() <= Date.now()) {
    throw validation("The submission deadline must be in the future");
  }

  // Line items either come in explicitly or are derived from the source request.
  let lineItems = input.lineItems ?? [];

  if (input.requestId) {
    const request = await tdb.purchaseRequest.findUnique({
      where: { id: input.requestId },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (!request) throw validation("The linked purchase request does not exist");
    if (request.status !== "APPROVED") {
      throw conflict(
        `Sourcing can only start from an approved request — ${request.requestNumber} is ${request.status.toLowerCase()}`
      );
    }
    if (lineItems.length === 0) {
      lineItems = request.lineItems.map((li) => ({
        itemName: li.itemName,
        description: li.description ?? "",
        quantity: li.quantity,
        unit: li.unit,
      }));
    }
  }

  if (lineItems.length === 0) {
    throw validation(
      "Add at least one line item, or link this RFQ to an approved request to inherit its lines"
    );
  }

  const rfq = await db.$transaction(async (tx) => {
    const rfqNumber = await nextDocumentNumber(organizationId, PREFIX.rfq, { client: tx });
    return tx.rFQ.create({
      data: {
        organizationId,
        rfqNumber,
        requestId: input.requestId ?? null,
        title: input.title,
        description: input.description || null,
        deadline,
        status: "WAITING",
        createdById: ctx.principal.userId,
        lineItems: {
          create: lineItems.map((li, i) => ({
            itemName: li.itemName,
            description: li.description || null,
            quantity: li.quantity,
            unit: li.unit ?? "unit",
            sortOrder: i,
          })),
        },
        invitedVendors: {
          create: input.invitedVendorIds.map((vendorId) => ({ vendorId, status: "INVITED" as const })),
        },
      },
      include: rfqInclude,
    });
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "rfq.created",
    resource: "RFQ",
    resourceId: rfq.id,
    after: { rfqNumber: rfq.rfqNumber, title: rfq.title, invited: input.invitedVendorIds.length },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_CREATED",
    description: `${ctx.principal.name} issued ${rfq.rfqNumber}: '${rfq.title}' to ${vendors.length} supplier(s)`,
    rfqId: rfq.id,
    context: ctx.context,
  });

  // One notification per invited supplier's portal contacts.
  for (const vendor of vendors) {
    await db.supplierActivity.create({
      data: {
        vendorId: vendor.id,
        type: "RFQ_RECEIVED",
        description: `Invited to quote on ${rfq.rfqNumber}: ${rfq.title}`,
        referenceId: rfq.id,
      },
    });
    await emit({
      type: "rfq.invited",
      organizationId,
      vendorId: vendor.id,
      actorId: ctx.principal.userId,
      title: `RFQ invitation — ${rfq.rfqNumber}`,
      message: `You have been invited to quote on "${rfq.title}". Responses close ${deadline.toDateString()}.`,
      severity: "info",
      entityType: "RFQ",
      entityId: rfq.id,
    });
  }

  return rfq;
}

export async function sendReminder(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.issue");
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({ where: { id }, include: rfqInclude });
  if (!rfq) throw notFound("RFQ not found");
  if (rfq.status !== "WAITING" && rfq.status !== "RECEIVED") {
    throw conflict("Reminders can only be sent while an RFQ is still open");
  }

  const pending = rfq.invitedVendors.filter((iv) => iv.status === "INVITED" || iv.status === "VIEWED");
  if (pending.length === 0) throw conflict("Every invited supplier has already responded");

  await tdb.rFQ.update({ where: { id }, data: { remindersSent: { increment: 1 } } });

  for (const iv of pending) {
    await emit({
      type: "rfq.deadline_approaching",
      organizationId: ctx.principal.organizationId,
      vendorId: iv.vendorId,
      actorId: ctx.principal.userId,
      title: `Reminder — ${rfq.rfqNumber} closes soon`,
      message: `Your quotation for "${rfq.title}" is still outstanding. Deadline: ${rfq.deadline.toDateString()}.`,
      severity: "warning",
      entityType: "RFQ",
      entityId: id,
    });
  }

  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_CREATED",
    description: `${ctx.principal.name} sent a reminder for ${rfq.rfqNumber} to ${pending.length} supplier(s)`,
    rfqId: id,
    context: ctx.context,
  });

  return getById(ctx, id);
}

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "rfqs.cancel");
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({ where: { id }, include: { purchaseOrders: true } });
  if (!rfq) throw notFound("RFQ not found");
  if (rfq.status === "CLOSED") throw conflict("This RFQ has already been awarded and closed");
  if (rfq.purchaseOrders.length > 0) {
    throw conflict("This RFQ cannot be cancelled — a purchase order has already been raised from it");
  }

  await tdb.rFQ.update({ where: { id }, data: { status: "CANCELLED" } });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.cancelled",
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: { status: "CANCELLED", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_CANCELLED",
    description: `${ctx.principal.name} cancelled ${rfq.rfqNumber} — ${reason}`,
    severity: "WARNING",
    rfqId: id,
    context: ctx.context,
  });

  return getById(ctx, id);
}

// ---------------------------------------------------------------------------
// Quotation capture
// ---------------------------------------------------------------------------

/**
 * Records a quotation against an RFQ.
 *
 * Shared by two callers: the supplier portal (a supplier quoting for themselves)
 * and internal procurement staff entering a quote that arrived by email or phone,
 * which remains the common case in real organizations. `submittedByVendor`
 * distinguishes them so the audit trail shows who actually keyed it in.
 *
 * Re-quoting is allowed while the RFQ is open and creates a new revision rather
 * than overwriting — the bid history is evidence and must not be mutable.
 */
export async function captureQuotation(
  args: {
    organizationId: string;
    rfqId: string;
    vendorId: string;
    actorId: string | null;
    actorName: string;
    submittedByVendor: boolean;
  },
  input: z.infer<typeof submitQuotationSchema>
) {
  const rfq = await db.rFQ.findFirst({
    where: { id: args.rfqId, organizationId: args.organizationId },
    include: { invitedVendors: true, quotations: true, lineItems: true },
  });
  if (!rfq) throw notFound("RFQ not found");

  if (!rfq.invitedVendors.some((iv) => iv.vendorId === args.vendorId)) {
    throw forbidden("This supplier was not invited to quote on this RFQ");
  }
  if (rfq.status === "CLOSED" || rfq.selectedQuotationId) {
    throw conflict("This RFQ has already been awarded and is no longer accepting quotations");
  }
  if (rfq.status === "CANCELLED") throw conflict("This RFQ has been cancelled");
  if (rfq.deadline.getTime() < Date.now()) {
    throw conflict(`The submission deadline passed on ${rfq.deadline.toDateString()}`);
  }

  const subtotal = input.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const tax = input.lineItems.reduce(
    (s, li) => s + li.quantity * li.unitPrice * (li.taxRate / 100),
    0
  );

  const priorRevisions = rfq.quotations.filter((q) => q.vendorId === args.vendorId);
  const revision = priorRevisions.length + 1;

  const quotation = await db.$transaction(async (tx) => {
    // Supersede any earlier revision so only the latest is in contention.
    if (priorRevisions.length > 0) {
      await tx.quotation.updateMany({
        where: { rfqId: rfq.id, vendorId: args.vendorId, status: { notIn: ["WITHDRAWN"] } },
        data: { status: "WITHDRAWN" },
      });
    }

    const created = await tx.quotation.create({
      data: {
        rfqId: rfq.id,
        vendorId: args.vendorId,
        revision,
        totalAmount: subtotal + tax,
        currency: rfq.quotations[0]?.currency ?? "USD",
        deliveryDays: input.deliveryDays,
        warranty: input.warranty || null,
        paymentTerms: input.paymentTerms || null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        notes: input.notes || null,
        status: "SUBMITTED",
        lineItems: {
          create: input.lineItems.map((li, i) => ({
            rfqLineItemId: li.rfqLineItemId ?? null,
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
      include: { vendor: true },
    });

    await tx.rFQVendor.updateMany({
      where: { rfqId: rfq.id, vendorId: args.vendorId },
      data: { status: "QUOTED" },
    });

    if (rfq.status === "WAITING") {
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "RECEIVED" } });
    }

    return created;
  });

  await recordAudit({
    organizationId: args.organizationId,
    userId: args.submittedByVendor ? null : args.actorId,
    action: "quotation.submitted",
    resource: "Quotation",
    resourceId: quotation.id,
    after: {
      rfqNumber: rfq.rfqNumber,
      vendor: quotation.vendor.companyName,
      totalAmount: quotation.totalAmount,
      revision,
      channel: args.submittedByVendor ? "supplier_portal" : "internal_capture",
    },
  });

  await recordActivity({
    organizationId: args.organizationId,
    userId: args.submittedByVendor ? null : args.actorId,
    eventType: "QUOTATION_RECEIVED",
    description: args.submittedByVendor
      ? `${quotation.vendor.companyName} submitted a quotation for ${rfq.rfqNumber} (${quotation.totalAmount.toLocaleString()})`
      : `${args.actorName} recorded a quotation from ${quotation.vendor.companyName} for ${rfq.rfqNumber} (${quotation.totalAmount.toLocaleString()})`,
    rfqId: rfq.id,
    vendorId: args.vendorId,
  });

  await db.supplierActivity.create({
    data: {
      vendorId: args.vendorId,
      type: "QUOTE_SUBMITTED",
      description: `Quotation ${revision > 1 ? `(revision ${revision}) ` : ""}submitted for ${rfq.rfqNumber}`,
      referenceId: rfq.id,
    },
  });

  const buyers = await db.user.findMany({
    where: {
      organizationId: args.organizationId,
      role: { in: ["PROCUREMENT_MANAGER", "SUPER_ADMIN"] },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await emit({
    type: "rfq.quotation_received",
    organizationId: args.organizationId,
    actorId: args.actorId,
    recipientIds: buyers.map((b) => b.id),
    title: `Quotation received — ${rfq.rfqNumber}`,
    message: `${quotation.vendor.companyName} quoted ${quotation.totalAmount.toLocaleString()} with ${input.deliveryDays}-day delivery.`,
    severity: "info",
    link: "rfqs",
    entityType: "RFQ",
    entityId: rfq.id,
  });

  return quotation;
}

/** Internal capture of a quotation received outside the portal. */
export async function recordQuotation(
  ctx: ServiceContext,
  rfqId: string,
  vendorId: string,
  input: z.infer<typeof submitQuotationSchema>
) {
  await assertPermission(ctx.principal, "rfqs.create");
  await captureQuotation(
    {
      organizationId: ctx.principal.organizationId,
      rfqId,
      vendorId,
      actorId: ctx.principal.userId,
      actorName: ctx.principal.name,
      submittedByVendor: false,
    },
    input
  );
  return getById(ctx, rfqId);
}

// ---------------------------------------------------------------------------
// Evaluation and award
// ---------------------------------------------------------------------------

export async function evaluateQuotation(
  ctx: ServiceContext,
  rfqId: string,
  quotationId: string,
  input: EvaluateInput
) {
  await assertPermission(ctx.principal, "rfqs.selectQuotation");
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({ where: { id: rfqId }, include: { quotations: true } });
  if (!rfq) throw notFound("RFQ not found");

  const quotation = rfq.quotations.find((q) => q.id === quotationId);
  if (!quotation) throw notFound("Quotation not found on this RFQ");

  await db.quotation.update({
    where: { id: quotationId },
    data: {
      evaluationScore: input.evaluationScore,
      evaluationNotes: input.evaluationNotes || null,
      status: quotation.status === "SUBMITTED" || quotation.status === "RECEIVED"
        ? "UNDER_EVALUATION"
        : quotation.status,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "quotation.evaluated",
    resource: "Quotation",
    resourceId: quotationId,
    before: { evaluationScore: quotation.evaluationScore },
    after: { evaluationScore: input.evaluationScore, notes: input.evaluationNotes },
    context: ctx.context,
  });

  return getById(ctx, rfqId);
}

export async function award(ctx: ServiceContext, rfqId: string, input: AwardInput) {
  await assertPermission(ctx.principal, "rfqs.selectQuotation");
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({
    where: { id: rfqId },
    include: { quotations: { include: { vendor: true } }, invitedVendors: true },
  });
  if (!rfq) throw notFound("RFQ not found");
  if (rfq.selectedQuotationId) {
    throw conflict("This RFQ has already been awarded");
  }
  if (rfq.status === "CANCELLED") throw conflict("A cancelled RFQ cannot be awarded");

  const winner = rfq.quotations.find((q) => q.id === input.quotationId);
  if (!winner) throw notFound("Quotation not found on this RFQ");
  if (winner.status === "WITHDRAWN" || winner.status === "EXPIRED") {
    throw conflict(`This quotation has been ${winner.status.toLowerCase()} and cannot be awarded`);
  }
  if (winner.validUntil && winner.validUntil.getTime() < Date.now()) {
    throw conflict(
      `This quotation expired on ${winner.validUntil.toDateString()}. Ask the supplier to re-quote before awarding.`
    );
  }
  if (winner.vendor.status === "BLACKLISTED") {
    throw conflict(`${winner.vendor.companyName} is blacklisted and cannot be awarded work`);
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id: winner.id }, data: { status: "SELECTED" } });
    await tx.quotation.updateMany({
      where: { rfqId, id: { not: winner.id } },
      data: { status: "REJECTED" },
    });
    await tx.rFQ.update({
      where: { id: rfqId },
      data: {
        selectedQuotationId: winner.id,
        status: "CLOSED",
        awardedAt: now,
        awardedById: ctx.principal.userId,
      },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.awarded",
    resource: "RFQ",
    resourceId: rfqId,
    before: { status: rfq.status, selectedQuotationId: null },
    after: {
      status: "CLOSED",
      selectedQuotationId: winner.id,
      vendor: winner.vendor.companyName,
      amount: winner.totalAmount,
      justification: input.justification,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "QUOTATION_SELECTED",
    description: `${ctx.principal.name} awarded ${rfq.rfqNumber} to ${winner.vendor.companyName} (${winner.totalAmount.toLocaleString()})`,
    severity: "SUCCESS",
    rfqId,
    vendorId: winner.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "rfq.awarded",
    organizationId: ctx.principal.organizationId,
    vendorId: winner.vendorId,
    actorId: ctx.principal.userId,
    title: `You have been awarded ${rfq.rfqNumber}`,
    message: `Your quotation for "${rfq.title}" has been selected. A purchase order will follow.`,
    severity: "success",
    entityType: "RFQ",
    entityId: rfqId,
  });

  await db.supplierActivity.create({
    data: {
      vendorId: winner.vendorId,
      type: "QUOTE_SUBMITTED",
      description: `Awarded ${rfq.rfqNumber}: ${rfq.title}`,
      referenceId: rfqId,
    },
  });

  return getById(ctx, rfqId);
}

/** Marks RFQs past their deadline as EXPIRED. Safe to run repeatedly. */
export async function expireOverdue(organizationId: string) {
  const overdue = await db.rFQ.findMany({
    where: { organizationId, status: { in: ["WAITING", "RECEIVED"] }, deadline: { lt: new Date() } },
  });
  if (overdue.length === 0) return 0;

  await db.rFQ.updateMany({
    where: { id: { in: overdue.map((r) => r.id) } },
    data: { status: "EXPIRED" },
  });
  return overdue.length;
}
