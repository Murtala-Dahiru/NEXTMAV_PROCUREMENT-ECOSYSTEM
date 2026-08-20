// NextMav Procure — quotations, comparison and evaluation.
//
// Three jobs, kept together because they are three views of the same numbers:
//
//   capture     turning a supplier's prices into a Quotation, whether they typed
//               them into the portal or emailed them to a buyer who keyed them in
//   comparison  putting those numbers side by side in a way that is honest about
//               what is actually being compared (§25, §26)
//   evaluation  scoring them against the criteria the RFQ fixed in advance, with
//               a panel, with history, and with a total anyone can re-derive (§27–§31)
//
// The one rule that shapes all three: no total that the system can compute is
// ever accepted from a caller. A supplier sends quantities and unit prices; the
// line totals, the tax, the quotation total, the normalised unit rates, the
// weighted scores and the ranking are all derived here. There is no field a bidder
// or a buyer can set that shortcuts the arithmetic.

import type { Prisma, QuotationStatus } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import { transition } from "../state-machine";
import { costQuotation, unitRateFor } from "../quotation-math";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import {
  assertCanEvaluate,
  evaluationScope,
  getById as getRfq,
  loadRfq,
  pretty,
} from "./rfq-service";
import type {
  submitQuotationSchema,
  evaluateQuotationSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type QuotationInput = z.infer<typeof submitQuotationSchema>;
type EvaluateInput = z.infer<typeof evaluateQuotationSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["submittedAt", "totalAmount", "createdAt", "status", "deliveryDays"] as const;

/** Statuses in which a quotation is a live bid the buyer can act on. */
const LIVE_STATUSES: QuotationStatus[] = ["SUBMITTED", "RECEIVED", "UNDER_EVALUATION", "SELECTED"];

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface CaptureArgs {
  organizationId: string;
  rfqId: string;
  vendorId: string;
  /** The employee keying it in, when the bid did not arrive through the portal. */
  actorId: string | null;
  actorName: string;
  /** The supplier contact, when it did. */
  supplierUserId: string | null;
  /** An existing DRAFT being submitted, rather than a fresh capture. */
  draftId?: string;
}

/**
 * Records a quotation against an RFQ.
 *
 * Shared by two callers: the supplier portal (a supplier quoting for themselves)
 * and internal procurement staff entering a quote that arrived by email or phone,
 * which remains the common case in real organizations. Which one it was is on the
 * record — `submittedByUserId` or `submittedBySupplierUserId`, never both.
 *
 * Every rule that guards a bid is enforced here, once, so neither caller can be
 * written in a way that skips one:
 *
 *   Rule 1  the supplier must hold an invitation to this RFQ
 *   Rule 2  the deadline is checked against the server clock, not the browser's
 *   Rule 4  an already-submitted bid can only be replaced where the RFQ allows
 *           supplier revisions or the buyer has invited one
 *   §14     totals are computed, never accepted
 */
export async function captureQuotation(args: CaptureArgs, input: QuotationInput) {
  const rfq = await db.rFQ.findFirst({
    where: { id: args.rfqId, organizationId: args.organizationId },
    include: { invitedVendors: true, lineItems: true },
  });
  if (!rfq) throw notFound("RFQ not found");

  const invitation = rfq.invitedVendors.find((iv) => iv.vendorId === args.vendorId);
  if (!invitation) {
    throw forbidden("This supplier was not invited to quote on this RFQ");
  }

  if (rfq.status === "AWARDED" || rfq.status === "NO_AWARD" || rfq.selectedQuotationId) {
    throw conflict("This RFQ has been decided and is no longer accepting quotations");
  }
  if (rfq.status === "CANCELLED") throw conflict("This RFQ has been cancelled");
  if (rfq.status === "DRAFT" || rfq.status === "UNDER_REVIEW" || rfq.status === "APPROVED") {
    throw conflict("This RFQ has not been published yet");
  }
  if (rfq.status === "CLOSED" || rfq.status === "EXPIRED" || rfq.status === "UNDER_EVALUATION") {
    throw conflict("The response period for this RFQ has closed");
  }

  // §17. The one check that must never be a disabled button.
  if (rfq.deadline.getTime() < Date.now()) {
    throw conflict(`The submission deadline passed on ${rfq.deadline.toUTCString()}`);
  }

  const priorRevisions = await db.quotation.findMany({
    where: { rfqId: rfq.id, vendorId: args.vendorId },
    orderBy: { revision: "desc" },
  });
  const submittedBefore = priorRevisions.filter((q) => q.status !== "DRAFT" && q.status !== "WITHDRAWN");

  if (submittedBefore.length > 0) {
    const invited = invitation.revisionAllowedAt !== null;
    if (!rfq.allowSupplierRevision && !invited) {
      throw conflict(
        "A quotation has already been submitted for this RFQ. Ask the buyer to invite a revision before submitting again.",
        { existingQuotationId: submittedBefore[0].id }
      );
    }
  }

  // Lines the supplier priced against an RFQ line must actually belong to this
  // RFQ. Without this a caller could post another tender's line id and have it
  // stored, corrupting the normalised comparison.
  const rfqLineIds = new Set(rfq.lineItems.map((l) => l.id));
  for (const li of input.lineItems) {
    if (li.rfqLineItemId && !rfqLineIds.has(li.rfqLineItemId)) {
      throw validation("A quoted line refers to an item that is not on this RFQ");
    }
  }

  const priced = input.lineItems.filter((li) => !li.isNoBid);
  if (priced.length === 0) {
    throw validation("A quotation must price at least one line", {
      issues: [{ path: "lineItems", message: "Every line is marked as no-bid" }],
    });
  }

  const totals = costQuotation(input.lineItems, {
    discountAmount: input.discountAmount,
    shippingAmount: input.shippingAmount,
  });
  if (totals.totalAmount <= 0) {
    throw validation("The quotation total works out at zero — check the prices and discount");
  }

  const validUntil = resolveValidity(input, rfq.deadline);
  if (validUntil && validUntil.getTime() < rfq.deadline.getTime()) {
    throw validation(
      "The quotation must stay valid at least until the RFQ deadline",
      { issues: [{ path: "validUntil", message: `Valid until ${validUntil.toDateString()}, deadline ${rfq.deadline.toDateString()}` }] }
    );
  }

  const revision = (priorRevisions[0]?.revision ?? 0) + 1;
  const supersedes = submittedBefore[0] ?? null;

  const quotation = await db.$transaction(async (tx) => {
    // Earlier revisions step aside so only the latest is in contention. Marked
    // SUPERSEDED, not WITHDRAWN: a re-quote is not a retreat, and the comparison
    // has to be able to tell them apart.
    if (supersedes) {
      await tx.quotation.update({
        where: { id: supersedes.id },
        data: { status: "SUPERSEDED" },
      });
    }
    // Any half-finished draft is folded into this submission rather than left
    // behind to be submitted twice.
    await tx.quotation.updateMany({
      where: { rfqId: rfq.id, vendorId: args.vendorId, status: "DRAFT" },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnReason: "Replaced by submission" },
    });

    const quotationNumber = await nextDocumentNumber(args.organizationId, PREFIX.quotation, {
      client: tx,
    });

    const created = await tx.quotation.create({
      data: {
        organizationId: args.organizationId,
        rfqId: rfq.id,
        vendorId: args.vendorId,
        quotationNumber,
        revision,
        supersedesId: supersedes?.id ?? null,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        shippingAmount: totals.shippingAmount,
        totalAmount: totals.totalAmount,
        currency: rfq.currency,
        deliveryDays: input.deliveryDays,
        warranty: input.warranty || null,
        paymentTerms: input.paymentTerms || null,
        validUntil,
        validityDays: input.validityDays ?? null,
        supplierReference: input.supplierReference || null,
        notes: input.notes || null,
        status: "SUBMITTED",
        submittedByUserId: args.supplierUserId ? null : args.actorId,
        submittedBySupplierUserId: args.supplierUserId,
        submittedAt: new Date(),
        lineItems: {
          create: input.lineItems.map((li, i) => {
            const c = totals.lines[i];
            return {
              rfqLineItemId: li.rfqLineItemId ?? null,
              itemName: li.itemName,
              description: li.description || null,
              quantity: li.quantity,
              unit: li.unit,
              unitPrice: li.unitPrice,
              discountPercent: li.discountPercent,
              discountAmount: c.discountAmount,
              taxRate: li.taxRate,
              taxAmount: c.taxAmount,
              deliveryCost: c.deliveryCost,
              lineTotal: c.lineTotal,
              deliveryDays: li.deliveryDays ?? null,
              isAlternative: li.isAlternative,
              isNoBid: li.isNoBid,
              notes: li.notes || null,
              sortOrder: i,
            };
          }),
        },
      },
      include: { vendor: true },
    });

    await tx.rFQVendor.update({
      where: { id: invitation.id },
      data: {
        status: "QUOTED",
        respondedAt: new Date(),
        // The buyer's invitation to revise is spent once it has been used.
        revisionAllowedAt: null,
        revisionAllowedById: null,
      },
    });

    if (rfq.status === "PUBLISHED") {
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "RESPONSE_PERIOD" } });
    }

    return created;
  });

  await recordAudit({
    organizationId: args.organizationId,
    userId: args.supplierUserId ? null : args.actorId,
    supplierUserId: args.supplierUserId,
    action: revision > 1 ? "quotation.revised" : "quotation.submitted",
    resource: "Quotation",
    resourceId: quotation.id,
    after: {
      rfqNumber: rfq.rfqNumber,
      quotationNumber: quotation.quotationNumber,
      vendor: quotation.vendor.companyName,
      totalAmount: quotation.totalAmount,
      currency: quotation.currency,
      revision,
      channel: args.supplierUserId ? "supplier_portal" : "internal_capture",
    },
  });

  await recordActivity({
    organizationId: args.organizationId,
    userId: args.supplierUserId ? null : args.actorId,
    eventType: revision > 1 ? "QUOTATION_REVISED" : "QUOTATION_RECEIVED",
    description: args.supplierUserId
      ? `${quotation.vendor.companyName} submitted ${quotation.quotationNumber} for ${rfq.rfqNumber} (${quotation.currency} ${quotation.totalAmount.toLocaleString()})`
      : `${args.actorName} recorded ${quotation.quotationNumber} from ${quotation.vendor.companyName} for ${rfq.rfqNumber} (${quotation.currency} ${quotation.totalAmount.toLocaleString()})`,
    rfqId: rfq.id,
    vendorId: args.vendorId,
  });

  await db.supplierActivity.create({
    data: {
      vendorId: args.vendorId,
      type: revision > 1 ? "QUOTE_REVISED" : "QUOTE_SUBMITTED",
      description: `Quotation ${quotation.quotationNumber}${revision > 1 ? ` (revision ${revision})` : ""} submitted for ${rfq.rfqNumber}`,
      referenceId: rfq.id,
    },
  });

  // The buyers told are the ones who own this RFQ, not every manager in the
  // organization: the creator and the evaluation panel.
  const [evaluators, owner] = await Promise.all([
    db.rFQEvaluator.findMany({ where: { rfqId: rfq.id }, select: { userId: true } }),
    Promise.resolve(rfq.createdById),
  ]);
  const recipients = [...new Set([...(owner ? [owner] : []), ...evaluators.map((e) => e.userId)])];

  await emit({
    type: "rfq.quotation_received",
    organizationId: args.organizationId,
    actorId: args.supplierUserId ? null : args.actorId,
    recipientIds: recipients,
    title: `Quotation received — ${rfq.rfqNumber}`,
    message: `${quotation.vendor.companyName} quoted ${quotation.currency} ${quotation.totalAmount.toLocaleString()} with ${input.deliveryDays}-day delivery.`,
    severity: "info",
    link: "rfqs",
    entityType: "RFQ",
    entityId: rfq.id,
  });

  return quotation;
}

/** A quotation is valid for a stated period or to a stated date; either implies the other. */
function resolveValidity(
  input: { validUntil?: string; validityDays?: number },
  fallbackFrom: Date
): Date | null {
  if (input.validUntil) return new Date(input.validUntil);
  if (input.validityDays) {
    return new Date(fallbackFrom.getTime() + input.validityDays * 86_400_000);
  }
  return null;
}

/** Internal capture of a quotation received outside the portal. */
export async function recordQuotation(
  ctx: ServiceContext,
  rfqId: string,
  vendorId: string,
  input: QuotationInput
) {
  await assertPermission(ctx.principal, "rfqs.create");
  await captureQuotation(
    {
      organizationId: ctx.principal.organizationId,
      rfqId,
      vendorId,
      actorId: ctx.principal.userId,
      actorName: ctx.principal.name,
      supplierUserId: null,
    },
    input
  );
  return getRfq(ctx, rfqId);
}

// ---------------------------------------------------------------------------
// Quotation inbox (§24)
// ---------------------------------------------------------------------------

export async function inbox(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "rfqs.view");
  const tdb = scoped(ctx);

  const where: Prisma.QuotationWhereInput = {
    // Drafts belong to the supplier. They are not in the buyer's inbox because
    // they are not yet a bid — §11 and §15 both turn on that distinction.
    status: { notIn: ["DRAFT"] },
  };
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as QuotationStatus[] };
  }
  if (q.vendorId) where.vendorId = q.vendorId;
  if (q.search) {
    where.OR = [
      { quotationNumber: { contains: q.search, mode: "insensitive" } },
      { supplierReference: { contains: q.search, mode: "insensitive" } },
      { vendor: { companyName: { contains: q.search, mode: "insensitive" } } },
      { rfq: { rfqNumber: { contains: q.search, mode: "insensitive" } } },
      { rfq: { title: { contains: q.search, mode: "insensitive" } } },
    ];
  }
  if (q.from || q.to) {
    where.submittedAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }

  const [total, items] = await Promise.all([
    tdb.quotation.count({ where }),
    tdb.quotation.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "submittedAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        vendor: { select: { id: true, companyName: true, rating: true, status: true } },
        rfq: {
          select: { id: true, rfqNumber: true, title: true, status: true, deadline: true, isSealed: true },
        },
        _count: { select: { lineItems: true } },
      },
    }),
  ]);

  const now = Date.now();
  const shaped = items.map((qt) => ({
    ...qt,
    // Sealed bids stay sealed in the inbox too, or the inbox becomes the way
    // round the seal.
    ...(qt.rfq.isSealed && qt.rfq.deadline.getTime() > now
      ? { sealed: true as const, totalAmount: 0, subtotal: 0, taxAmount: 0, deliveryDays: 0 }
      : { sealed: false as const }),
    isExpired: qt.validUntil ? qt.validUntil.getTime() < now : false,
  }));

  return paginate(shaped, total, q.page, q.pageSize);
}

// ---------------------------------------------------------------------------
// Comparison (§25, §26)
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  quotationId: string;
  quotationNumber: string | null;
  vendorId: string;
  vendorName: string;
  revision: number;
  status: QuotationStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  deliveryDays: number;
  paymentTerms: string | null;
  warranty: string | null;
  validUntil: Date | null;
  isExpired: boolean;
  isCompliant: boolean;
  vendorRating: number;
  onTimeDeliveryRate: number;
  qualityRating: number;
  /** How this bid stands against the cheapest one on the table. */
  varianceFromLowest: number;
  variancePercent: number;
  isLowest: boolean;
  isFastest: boolean;
  /** How many of the RFQ's lines this supplier actually priced. */
  linesQuoted: number;
  linesRequested: number;
  coverage: number;
  weightedScore: number | null;
  rank: number | null;
}

/**
 * The comparison the buyer actually needs.
 *
 * Two things it deliberately refuses to do:
 *
 *   It does not compare headline totals as though they were the same thing. A bid
 *   that priced four of six lines is not cheaper than one that priced all six, and
 *   `coverage` is carried on every row so the table can say so out loud.
 *
 *   It does not treat a missing line as zero. A supplier who did not quote an item
 *   appears as a gap; scoring it as free would hand the award to the least
 *   responsive bidder, which is the classic way an automated comparison goes wrong.
 */
export async function comparison(ctx: ServiceContext, rfqId: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  const rfq = await loadRfq(ctx, rfqId);

  if (rfq.isSealed && rfq.deadline.getTime() > Date.now()) {
    throw conflict(
      `${rfq.rfqNumber} is a sealed RFQ. Bids cannot be compared until the deadline passes on ${rfq.deadline.toDateString()}.`
    );
  }

  const quotations = await db.quotation.findMany({
    where: { rfqId, status: { in: LIVE_STATUSES } },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      vendor: {
        select: {
          id: true,
          companyName: true,
          rating: true,
          onTimeDeliveryRate: true,
          qualityRating: true,
          riskLevel: true,
        },
      },
      scores: { include: { criterion: true } },
    },
  });

  if (quotations.length === 0) {
    return {
      rfqId,
      currency: rfq.currency,
      rows: [] as ComparisonRow[],
      lines: [],
      evaluation: null,
      summary: {
        invited: rfq.invitedVendors.length,
        responded: 0,
        lowestAmount: null,
        highestAmount: null,
        spread: null,
        averageAmount: null,
        estimatedValue: rfq.estimatedValue,
      },
    };
  }

  const now = Date.now();
  const amounts = quotations.map((q) => q.totalAmount);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const fastest = Math.min(...quotations.map((q) => q.deliveryDays));
  const requestedLines = rfq.lineItems.length;

  const evaluation = computeEvaluation(rfq, quotations);

  const rows: ComparisonRow[] = quotations.map((q) => {
    const quoted = q.lineItems.filter((l) => !l.isNoBid && l.rfqLineItemId).length;
    const scored = evaluation.byQuotation.get(q.id);
    return {
      quotationId: q.id,
      quotationNumber: q.quotationNumber,
      vendorId: q.vendorId,
      vendorName: q.vendor.companyName,
      revision: q.revision,
      status: q.status,
      currency: q.currency,
      subtotal: q.subtotal,
      discountAmount: q.discountAmount,
      taxAmount: q.taxAmount,
      shippingAmount: q.shippingAmount,
      totalAmount: q.totalAmount,
      deliveryDays: q.deliveryDays,
      paymentTerms: q.paymentTerms,
      warranty: q.warranty,
      validUntil: q.validUntil,
      isExpired: q.validUntil ? q.validUntil.getTime() < now : false,
      isCompliant: q.isCompliant,
      vendorRating: q.vendor.rating,
      onTimeDeliveryRate: q.vendor.onTimeDeliveryRate,
      qualityRating: q.vendor.qualityRating,
      varianceFromLowest: Math.round((q.totalAmount - lowest) * 100) / 100,
      variancePercent: lowest > 0 ? Math.round(((q.totalAmount - lowest) / lowest) * 10000) / 100 : 0,
      isLowest: q.totalAmount === lowest,
      isFastest: q.deliveryDays === fastest,
      linesQuoted: quoted,
      linesRequested: requestedLines,
      coverage: requestedLines > 0 ? Math.round((quoted / requestedLines) * 100) : 100,
      weightedScore: scored?.weightedScore ?? null,
      rank: scored?.rank ?? null,
    };
  });

  rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    return a.totalAmount - b.totalAmount;
  });

  // The normalised per-line view. This is where §26 lives: the RFQ line is the
  // spine, and each bid is matched onto it — by explicit id first, then by name
  // for a bid captured from an email that never carried one.
  const lines = rfq.lineItems.map((rl) => {
    const bids = quotations.map((q) => {
      const match =
        q.lineItems.find((ql) => ql.rfqLineItemId === rl.id) ??
        q.lineItems.find(
          (ql) => !ql.rfqLineItemId && ql.itemName.trim().toLowerCase() === rl.itemName.trim().toLowerCase()
        );

      if (!match || match.isNoBid) {
        return {
          quotationId: q.id,
          vendorId: q.vendorId,
          vendorName: q.vendor.companyName,
          quoted: false as const,
          isNoBid: match?.isNoBid ?? false,
        };
      }

      return {
        quotationId: q.id,
        vendorId: q.vendorId,
        vendorName: q.vendor.companyName,
        quoted: true as const,
        isNoBid: false,
        isAlternative: match.isAlternative,
        itemName: match.itemName,
        quotedQuantity: match.quantity,
        requestedQuantity: rl.quantity,
        // Flagged rather than corrected. A supplier quoting 1,000 against a
        // request for 800 may be offering a pack size; the buyer decides what
        // that means, but they have to be told it happened.
        quantityMatches: Math.abs(match.quantity - rl.quantity) < 0.0001,
        unit: match.unit,
        unitPrice: match.unitPrice,
        discountAmount: match.discountAmount,
        taxAmount: match.taxAmount,
        deliveryCost: match.deliveryCost,
        lineTotal: match.lineTotal,
        deliveryDays: match.deliveryDays,
        /** Per-unit cost including everything, so different pack sizes compare. */
        effectiveUnitRate: unitRateFor(match.quantity, match.lineTotal, rl.quantity),
        notes: match.notes,
      };
    });

    const priced = bids.filter((b) => b.quoted);
    const best = priced.length
      ? priced.reduce((m, b) =>
          (b.effectiveUnitRate ?? Infinity) < (m.effectiveUnitRate ?? Infinity) ? b : m
        )
      : null;

    return {
      rfqLineItemId: rl.id,
      itemName: rl.itemName,
      description: rl.description,
      specification: rl.specification,
      quantity: rl.quantity,
      unit: rl.unit,
      targetPrice: rl.targetPrice,
      requiredDeliveryDate: rl.requiredDeliveryDate,
      bids,
      bestVendorId: best?.quoted ? best.vendorId : null,
      // What the buyer would pay taking each line from whoever is cheapest on it.
      bestUnitRate: best?.quoted ? best.effectiveUnitRate : null,
    };
  });

  const splitAwardTotal = lines.reduce((sum, l) => {
    const best = l.bids.filter((b) => b.quoted).map((b) => b.lineTotal);
    return best.length ? sum + Math.min(...best) : sum;
  }, 0);

  return {
    rfqId,
    currency: rfq.currency,
    rows,
    lines,
    evaluation: evaluation.criteria.length > 0 ? evaluation : null,
    summary: {
      invited: rfq.invitedVendors.length,
      responded: quotations.length,
      lowestAmount: lowest,
      highestAmount: highest,
      spread: Math.round((highest - lowest) * 100) / 100,
      averageAmount: Math.round((amounts.reduce((a, b) => a + b, 0) / amounts.length) * 100) / 100,
      estimatedValue: rfq.estimatedValue,
      /** What a line-by-line split award would cost, against the best single bid. */
      splitAwardTotal: Math.round(splitAwardTotal * 100) / 100,
      splitAwardSaving: Math.round((lowest - splitAwardTotal) * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Evaluation (§27–§31)
// ---------------------------------------------------------------------------

/**
 * The shape the evaluator needs, described structurally rather than as a Prisma
 * payload type.
 *
 * The client extension in db.ts converts every numeric column to `number` on read,
 * so `QuotationGetPayload` — which still describes them as `Decimal` — does not
 * match what actually arrives. Naming the fields this function uses keeps the
 * signature honest and lets a test call it with plain objects.
 */
interface ScoredQuotation {
  id: string;
  vendorId: string;
  totalAmount: number;
  deliveryDays: number;
  vendor: { companyName: string };
  scores: { criterionId: string; score: number }[];
}

interface CriterionResult {
  criterionId: string;
  name: string;
  type: string;
  weight: number;
  maxScore: number;
  lowerIsBetter: boolean;
  isAutomatic: boolean;
  /** Raw score on the criterion's own scale, averaged across evaluators. */
  rawScore: number | null;
  /** 0–1 after inverting where lower is better. */
  normalised: number | null;
  /** normalised × weight. These sum to the weighted total. */
  contribution: number;
  evaluatorCount: number;
}

/**
 * Computes the evaluation result for every bid on an RFQ.
 *
 * The method is deliberately explicit rather than clever, because §31 asks for a
 * calculation anyone can follow:
 *
 *   1. Each criterion produces a raw score for each bid. Human criteria take the
 *      mean of the panel's scores; automatic ones (price, delivery) are derived
 *      from the bid itself by linear normalisation across the field, so nobody has
 *      to hand-score a number the system already knows.
 *   2. The raw score is divided by the criterion's maximum, giving 0–1, and
 *      inverted where lower is better.
 *   3. Each is multiplied by its weight and the results are summed.
 *
 * Weights are re-normalised over the criteria that actually produced a score, so
 * a panel part-way through its work still yields a comparable total rather than
 * penalising every bid for the criteria nobody has reached yet.
 */
function computeEvaluation(
  rfq: {
    criteria: {
      id: string;
      name: string;
      type: string;
      weight: number;
      maxScore: number;
      lowerIsBetter: boolean;
      isAutomatic: boolean;
    }[];
    evaluationMethod: string;
  },
  quotations: ScoredQuotation[]
) {
  const criteria = rfq.criteria;
  const byQuotation = new Map<string, { weightedScore: number; rank: number; criteria: CriterionResult[] }>();

  if (criteria.length === 0 || quotations.length === 0) {
    return { method: rfq.evaluationMethod, criteria: [], byQuotation, results: [] };
  }

  const amounts = quotations.map((q) => q.totalAmount);
  const deliveries = quotations.map((q) => q.deliveryDays);
  const priceRange = { min: Math.min(...amounts), max: Math.max(...amounts) };
  const deliveryRange = { min: Math.min(...deliveries), max: Math.max(...deliveries) };

  /** Linear position of `value` in `[min,max]`, where 0 is best when lower wins. */
  const position = (value: number, range: { min: number; max: number }): number =>
    range.max === range.min ? 0 : (value - range.min) / (range.max - range.min);

  const results = quotations.map((q) => {
    const perCriterion: CriterionResult[] = criteria.map((c) => {
      let rawScore: number | null = null;
      let evaluatorCount = 0;

      if (c.isAutomatic && c.type === "PRICE") {
        rawScore = c.maxScore * (1 - position(q.totalAmount, priceRange));
      } else if (c.isAutomatic && c.type === "DELIVERY") {
        rawScore = c.maxScore * (1 - position(q.deliveryDays, deliveryRange));
      } else {
        const scores = q.scores.filter((s) => s.criterionId === c.id);
        evaluatorCount = scores.length;
        if (scores.length > 0) {
          rawScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
        }
      }

      // An automatic criterion is already oriented so that higher is better; a
      // human score on a lower-is-better criterion still has to be inverted.
      const normalised =
        rawScore === null
          ? null
          : c.isAutomatic
            ? clamp01(rawScore / c.maxScore)
            : clamp01(c.lowerIsBetter ? 1 - rawScore / c.maxScore : rawScore / c.maxScore);

      return {
        criterionId: c.id,
        name: c.name,
        type: c.type,
        weight: c.weight,
        maxScore: c.maxScore,
        lowerIsBetter: c.lowerIsBetter,
        isAutomatic: c.isAutomatic,
        rawScore: rawScore === null ? null : round2(rawScore),
        normalised: normalised === null ? null : round4(normalised),
        contribution: 0,
        evaluatorCount,
      };
    });

    const answered = perCriterion.filter((c) => c.normalised !== null);
    const weightSum = answered.reduce((s, c) => s + c.weight, 0);

    let weighted = 0;
    for (const c of perCriterion) {
      if (c.normalised === null || weightSum <= 0) continue;
      c.contribution = round2(c.normalised * (c.weight / weightSum) * 100);
      weighted += c.contribution;
    }

    return {
      quotationId: q.id,
      vendorId: q.vendorId,
      vendorName: q.vendor.companyName,
      totalAmount: q.totalAmount,
      criteria: perCriterion,
      /** Percentage of the maximum achievable, across the criteria scored so far. */
      weightedScore: answered.length > 0 ? round2(weighted) : null,
      /** How much of the panel's work is done for this bid. */
      completeness:
        criteria.length === 0 ? 100 : Math.round((answered.length / criteria.length) * 100),
    };
  });

  // Ranking follows the RFQ's stated method — §31's "do not invent arbitrary
  // formulas". Lowest price ranks on money; the other two rank on the score, with
  // price breaking ties so two equal scores do not order themselves at random.
  const ranked = [...results].sort((a, b) => {
    if (rfq.evaluationMethod === "LOWEST_PRICE") return a.totalAmount - b.totalAmount;
    const sa = a.weightedScore ?? -1;
    const sb = b.weightedScore ?? -1;
    if (sb !== sa) return sb - sa;
    return a.totalAmount - b.totalAmount;
  });

  ranked.forEach((r, i) => {
    byQuotation.set(r.quotationId, {
      weightedScore: r.weightedScore ?? 0,
      rank: i + 1,
      criteria: r.criteria,
    });
  });

  return {
    method: rfq.evaluationMethod,
    criteria: criteria.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      weight: c.weight,
      maxScore: c.maxScore,
      lowerIsBetter: c.lowerIsBetter,
      isAutomatic: c.isAutomatic,
    })),
    byQuotation,
    results: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Records one evaluator's scores against one bid.
 *
 * Every score is written against the evaluator's own seat, so two panel members
 * scoring the same criterion produce two rows rather than one overwriting the
 * other (Rule 9). Re-scoring copies the previous value into
 * `QuotationScoreHistory` first, so an evaluator changing their mind leaves a
 * trail rather than erasing one (§28).
 */
export async function evaluateQuotation(
  ctx: ServiceContext,
  rfqId: string,
  quotationId: string,
  input: EvaluateInput
) {
  const { seat } = await assertCanEvaluate(ctx, rfqId);
  const tdb = scoped(ctx);

  const rfq = await tdb.rFQ.findUnique({
    where: { id: rfqId },
    include: { criteria: true },
  });
  if (!rfq) throw notFound("RFQ not found");

  if (rfq.isSealed && rfq.deadline.getTime() > Date.now()) {
    throw conflict("This is a sealed RFQ. Bids cannot be evaluated before the deadline.");
  }
  if (rfq.status === "AWARDED" || rfq.status === "CANCELLED" || rfq.status === "NO_AWARD") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)}; evaluation is closed`);
  }

  const quotation = await tdb.quotation.findFirst({
    where: { id: quotationId, rfqId },
  });
  if (!quotation) throw notFound("Quotation not found on this RFQ");
  if (quotation.status === "DRAFT") {
    throw conflict("That quotation has not been submitted");
  }

  const criterionScores = input.criterionScores ?? [];
  for (const cs of criterionScores) {
    const criterion = rfq.criteria.find((c) => c.id === cs.criterionId);
    if (!criterion) throw validation("Unknown evaluation criterion for this RFQ");
    if (criterion.isAutomatic) {
      throw validation(
        `"${criterion.name}" is scored automatically from the bid and cannot be scored by hand`
      );
    }
    if (cs.score < 0 || cs.score > criterion.maxScore) {
      throw validation(`Score for "${criterion.name}" must be between 0 and ${criterion.maxScore}`);
    }
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    for (const cs of criterionScores) {
      const existing = await tx.quotationScore.findFirst({
        where: { quotationId, criterionId: cs.criterionId, evaluatorId: seat?.id ?? null },
      });

      if (existing) {
        await tx.quotationScoreHistory.create({
          data: {
            scoreId: existing.id,
            score: existing.score,
            notes: existing.notes,
            scoredById: existing.scoredById,
            scoredAt: existing.scoredAt,
          },
        });
        await tx.quotationScore.update({
          where: { id: existing.id },
          data: { score: cs.score, notes: cs.notes ?? null, scoredById: ctx.principal.userId, scoredAt: now },
        });
      } else {
        await tx.quotationScore.create({
          data: {
            quotationId,
            criterionId: cs.criterionId,
            evaluatorId: seat?.id ?? null,
            score: cs.score,
            notes: cs.notes ?? null,
            scoredById: ctx.principal.userId,
            scoredAt: now,
          },
        });
      }
    }

    await tx.quotation.update({
      where: { id: quotationId },
      data: {
        ...(input.evaluationScore !== undefined ? { evaluationScore: input.evaluationScore } : {}),
        ...(input.evaluationNotes ? { evaluationNotes: input.evaluationNotes } : {}),
        ...(input.isCompliant !== undefined ? { isCompliant: input.isCompliant } : {}),
        ...(input.complianceNotes !== undefined ? { complianceNotes: input.complianceNotes || null } : {}),
        status:
          quotation.status === "SUBMITTED" || quotation.status === "RECEIVED"
            ? transition("quotation", quotation.status, "UNDER_EVALUATION")
            : quotation.status,
      },
    });

    if (rfq.status === "CLOSED" || rfq.status === "EXPIRED") {
      await tx.rFQ.update({
        where: { id: rfqId },
        data: { status: transition("rfq", rfq.status, "UNDER_EVALUATION"), evaluatedAt: now },
      });
    }
  });

  // The stored weighted score is a cache of the computed one, refreshed after
  // every scoring change so a list view can sort on it without recomputing the
  // whole evaluation per row.
  await refreshWeightedScores(rfqId);

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "quotation.scored",
    resource: "Quotation",
    resourceId: quotationId,
    after: {
      rfqId,
      evaluatorSeatId: seat?.id ?? null,
      scores: criterionScores.map((c) => ({ criterionId: c.criterionId, score: c.score })),
      notes: input.evaluationNotes,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "QUOTATION_SCORED",
    description: `${ctx.principal.name} scored a quotation on ${rfq.rfqNumber}`,
    rfqId,
    vendorId: quotation.vendorId,
    context: ctx.context,
  });

  return evaluationSummary(ctx, rfqId);
}

/** Recomputes and stores each bid's weighted total and rank. */
async function refreshWeightedScores(rfqId: string): Promise<void> {
  const rfq = await db.rFQ.findUnique({ where: { id: rfqId }, include: { criteria: true } });
  if (!rfq) return;

  const quotations = await db.quotation.findMany({
    where: { rfqId, status: { in: LIVE_STATUSES } },
    include: { scores: { include: { criterion: true } }, vendor: true, lineItems: true },
  });

  const evaluation = computeEvaluation(rfq, quotations);
  for (const r of evaluation.results) {
    await db.quotation.update({
      where: { id: r.quotationId },
      data: { weightedScore: r.weightedScore, rank: r.rank },
    });
  }
}

/**
 * The evaluation as the caller is entitled to see it — §30.
 *
 * A panel member sees their own scores and the aggregate. Only the chair, or
 * somebody holding `rfqs.manageEvaluation`, sees who scored what: knowing that a
 * colleague marked a supplier down is exactly the information that turns a panel
 * into a negotiation.
 */
export async function evaluationSummary(ctx: ServiceContext, rfqId: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  const { canSeeAll, seat } = await evaluationScope(ctx, rfqId);

  const rfq = await scoped(ctx).rFQ.findUnique({
    where: { id: rfqId },
    include: {
      criteria: { orderBy: { sortOrder: "asc" } },
      evaluators: {
        include: { user: { select: { id: true, name: true, initials: true, avatarColor: true } } },
      },
    },
  });
  if (!rfq) throw notFound("RFQ not found");

  if (rfq.isSealed && rfq.deadline.getTime() > Date.now()) {
    return {
      rfqId,
      sealed: true as const,
      method: rfq.evaluationMethod,
      criteria: rfq.criteria,
      evaluators: rfq.evaluators,
      results: [],
      myScores: [],
      canSeeAll,
      isPanelMember: seat !== null,
    };
  }

  const quotations = await db.quotation.findMany({
    where: { rfqId, status: { in: LIVE_STATUSES } },
    include: {
      scores: {
        include: {
          criterion: true,
          evaluator: { select: { id: true, userId: true, role: true } },
          scoredBy: { select: { id: true, name: true } },
          history: { orderBy: { replacedAt: "desc" } },
        },
      },
      vendor: true,
      lineItems: true,
    },
  });

  const evaluation = computeEvaluation(rfq, quotations);

  return {
    rfqId,
    sealed: false as const,
    method: rfq.evaluationMethod,
    criteria: rfq.criteria,
    evaluators: rfq.evaluators,
    results: evaluation.results,
    /** The caller's own scoring, so the UI can render what they have left to do. */
    myScores: quotations.flatMap((q) =>
      q.scores
        .filter((s) => s.scoredById === ctx.principal.userId)
        .map((s) => ({
          quotationId: q.id,
          criterionId: s.criterionId,
          score: s.score,
          notes: s.notes,
          scoredAt: s.scoredAt,
          revisions: s.history.length,
        }))
    ),
    /** Per-evaluator detail. Withheld from ordinary panel members by design. */
    panelScores: canSeeAll
      ? quotations.map((q) => ({
          quotationId: q.id,
          vendorName: q.vendor.companyName,
          scores: q.scores.map((s) => ({
            criterionId: s.criterionId,
            criterionName: s.criterion.name,
            evaluatorId: s.evaluator?.userId ?? null,
            evaluatorRole: s.evaluator?.role ?? null,
            scoredBy: s.scoredBy?.name ?? null,
            score: s.score,
            notes: s.notes,
            scoredAt: s.scoredAt,
            history: s.history,
          })),
        }))
      : null,
    canSeeAll,
    isPanelMember: seat !== null,
  };
}

/** Marks the caller's panel seat as finished, so the chair can see who is done. */
export async function completeMyEvaluation(ctx: ServiceContext, rfqId: string) {
  const { seat } = await assertCanEvaluate(ctx, rfqId);
  if (!seat) throw forbidden("You do not hold a seat on this panel");

  await db.rFQEvaluator.update({ where: { id: seat.id }, data: { completedAt: new Date() } });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.evaluation_completed",
    resource: "RFQ",
    resourceId: rfqId,
    after: { evaluatorSeatId: seat.id },
    context: ctx.context,
  });

  return evaluationSummary(ctx, rfqId);
}

export { computeEvaluation, LIVE_STATUSES };
