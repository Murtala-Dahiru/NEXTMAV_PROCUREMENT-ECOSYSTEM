// NextMav Procure — the supplier portal.
//
// Everything in this module answers to one question: what is this supplier
// entitled to see and do? §42 gives the list, and it is short — the RFQs they were
// invited to, their own quotations, their own communications, their own status.
// Nothing else. Not another bidder's name, not a competitor's price, not a score,
// not an internal note, not the buyer's target price unless the RFQ deliberately
// published it.
//
// Two structural decisions carry that guarantee, rather than leaving it to the
// care of whoever writes the next endpoint:
//
//   Every read starts from the invitation, not from the RFQ. A supplier's own
//   RFQVendor row is the only doorway into a tender; there is no code path here
//   that loads an RFQ by id and then checks whether the caller should have it.
//   That ordering is what makes Rule 1 and §49's ID-manipulation test structural
//   instead of aspirational.
//
//   Nothing returns a Prisma record straight out. Every response is assembled by
//   an explicit projection — `forSupplier`, below. A field added to the RFQ model
//   next year does not silently start appearing in the supplier's payload; it has
//   to be added here, deliberately.
//
// The supplier principal itself carries no role, no userId and no department (see
// session.ts), so a supplier token is structurally incapable of satisfying an
// internal permission check even if one were reached by accident.

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { recordActivity, recordAudit } from "../audit";
import { emit } from "../engines/events";
import { costQuotation } from "../quotation-math";
import { captureQuotation } from "./quotation-service";
import type { SupplierServiceContext } from "./context";
import type {
  saveQuotationDraftSchema,
  submitQuotationSchema,
  declineInvitationSchema,
  withdrawQuotationSchema,
  askClarificationSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type DraftInput = z.infer<typeof saveQuotationDraftSchema>;
type SubmitInput = z.infer<typeof submitQuotationSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

/** RFQ statuses a supplier is allowed to know exist at all. */
const VISIBLE_TO_SUPPLIER = [
  "PUBLISHED",
  "RESPONSE_PERIOD",
  "CLOSED",
  "UNDER_EVALUATION",
  "AWARDED",
  "NO_AWARD",
  "EXPIRED",
  "CANCELLED",
] as const;

// ---------------------------------------------------------------------------
// The doorway
// ---------------------------------------------------------------------------

/**
 * Loads an RFQ *through* this supplier's invitation to it.
 *
 * The query is anchored on RFQVendor with both the vendor and the organization
 * pinned. An RFQ the supplier was not invited to, or one belonging to another
 * tenant, does not resolve — it 404s rather than 403s, because confirming that a
 * tender exists is itself information a stranger should not get.
 */
async function invitationFor(ctx: SupplierServiceContext, rfqId: string) {
  const invitation = await db.rFQVendor.findFirst({
    where: {
      rfqId,
      vendorId: ctx.principal.vendorId,
      rfq: { organizationId: ctx.principal.organizationId },
    },
    include: {
      rfq: {
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          organization: { select: { id: true, name: true, logoUrl: true, country: true } },
        },
      },
    },
  });

  if (!invitation) throw notFound("RFQ not found");

  if (!VISIBLE_TO_SUPPLIER.includes(invitation.rfq.status as (typeof VISIBLE_TO_SUPPLIER)[number])) {
    // The RFQ exists but has not been published. From the supplier's side that is
    // indistinguishable from not existing, and must stay that way.
    throw notFound("RFQ not found");
  }

  return invitation;
}

type InvitationWithRfq = Awaited<ReturnType<typeof invitationFor>>;

/**
 * The single projection every supplier-facing RFQ response goes through.
 *
 * What is deliberately absent is as important as what is here: no
 * `estimatedValue`, no `createdById`, no approval state, no evaluation method, no
 * criteria, no other invitations, no quotation but the supplier's own. The target
 * price on each line appears only where the RFQ set `showTargetPrice` — §11's
 * "internal target pricing unless intentionally exposed".
 */
function forSupplier(invitation: InvitationWithRfq) {
  const rfq = invitation.rfq;
  const now = Date.now();
  const closed = rfq.deadline.getTime() < now || rfq.status !== "PUBLISHED" && rfq.status !== "RESPONSE_PERIOD";

  return {
    id: rfq.id,
    rfqNumber: rfq.rfqNumber,
    referenceNumber: rfq.referenceNumber,
    title: rfq.title,
    description: rfq.description,
    status: rfq.status,
    currency: rfq.currency,
    deadline: rfq.deadline,
    questionDeadline: rfq.questionDeadline,
    requiredDeliveryDate: rfq.requiredDeliveryDate,
    deliveryTerms: rfq.deliveryTerms,
    deliveryAddress: rfq.deliveryAddress,
    termsAndConditions: rfq.termsAndConditions,
    publishedAt: rfq.publishedAt,
    isSealed: rfq.isSealed,
    allowSupplierRevision: rfq.allowSupplierRevision,
    buyer: {
      organizationId: rfq.organization.id,
      name: rfq.organization.name,
      logoUrl: rfq.organization.logoUrl,
      country: rfq.organization.country,
    },
    lineItems: rfq.lineItems.map((li) => ({
      id: li.id,
      itemName: li.itemName,
      description: li.description,
      specification: li.specification,
      quantity: li.quantity,
      unit: li.unit,
      requiredDeliveryDate: li.requiredDeliveryDate,
      notes: li.notes,
      // Redaction, not omission: the field is always present so the client shape
      // is stable, and it is null unless the buyer chose to publish it.
      targetPrice: rfq.showTargetPrice ? li.targetPrice : null,
      sortOrder: li.sortOrder,
    })),
    myInvitation: {
      status: invitation.status,
      invitedAt: invitation.invitedAt,
      viewedAt: invitation.viewedAt,
      acceptedAt: invitation.acceptedAt,
      respondedAt: invitation.respondedAt,
      declinedAt: invitation.declinedAt,
      declineReason: invitation.declineReason,
      /** Set when the buyer has invited a revision of an already-submitted bid. */
      revisionInvited: invitation.revisionAllowedAt !== null,
      revisionReason: invitation.revisionReason,
    },
    isOpen: !closed,
    /** Server-computed, so the countdown a supplier sees is the one enforced. */
    secondsRemaining: Math.max(0, Math.floor((rfq.deadline.getTime() - now) / 1000)),
  };
}

/** Whether this supplier may write a quotation against this RFQ right now. */
function canRespond(invitation: InvitationWithRfq): { ok: boolean; reason?: string } {
  const rfq = invitation.rfq;
  if (rfq.status === "CANCELLED") return { ok: false, reason: "This RFQ has been cancelled" };
  if (rfq.status !== "PUBLISHED" && rfq.status !== "RESPONSE_PERIOD") {
    return { ok: false, reason: "The response period for this RFQ has closed" };
  }
  if (rfq.deadline.getTime() < Date.now()) {
    return { ok: false, reason: `The deadline passed on ${rfq.deadline.toUTCString()}` };
  }
  if (invitation.status === "DECLINED") {
    return { ok: false, reason: "You declined this invitation" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The supplier's dashboard. Counts only ever range over their own invitations. */
export async function dashboard(ctx: SupplierServiceContext) {
  const { vendorId, organizationId } = ctx.principal;
  const soon = new Date(Date.now() + 3 * 86_400_000);

  const [invitations, openCount, closingSoon, quotations, awards] = await Promise.all([
    db.rFQVendor.groupBy({
      by: ["status"],
      where: { vendorId, rfq: { organizationId, status: { in: [...VISIBLE_TO_SUPPLIER] } } },
      _count: { _all: true },
    }),
    db.rFQVendor.count({
      where: {
        vendorId,
        rfq: {
          organizationId,
          status: { in: ["PUBLISHED", "RESPONSE_PERIOD"] },
          deadline: { gt: new Date() },
        },
      },
    }),
    db.rFQVendor.count({
      where: {
        vendorId,
        status: { in: ["INVITED", "VIEWED", "ACCEPTED"] },
        rfq: {
          organizationId,
          status: { in: ["PUBLISHED", "RESPONSE_PERIOD"] },
          deadline: { gte: new Date(), lte: soon },
        },
      },
    }),
    db.quotation.groupBy({
      by: ["status"],
      where: { vendorId, organizationId },
      _count: { _all: true },
    }),
    db.rFQAward.count({ where: { vendorId, organizationId, cancelledAt: null } }),
  ]);

  const inv = (s: string) => invitations.find((r) => r.status === s)?._count._all ?? 0;
  const quo = (s: string) => quotations.find((r) => r.status === s)?._count._all ?? 0;

  return {
    invitations: {
      total: invitations.reduce((s, r) => s + r._count._all, 0),
      open: openCount,
      closingSoon,
      awaitingResponse: inv("INVITED") + inv("VIEWED") + inv("ACCEPTED"),
      responded: inv("QUOTED"),
      declined: inv("DECLINED"),
    },
    quotations: {
      drafts: quo("DRAFT"),
      submitted: quo("SUBMITTED") + quo("RECEIVED") + quo("UNDER_EVALUATION"),
      won: quo("SELECTED"),
      unsuccessful: quo("REJECTED"),
    },
    awards,
  };
}

/** The RFQs this supplier has been invited to. */
export async function myRfqs(ctx: SupplierServiceContext, q: ListInput) {
  const { vendorId, organizationId } = ctx.principal;

  // Built as one object rather than mutated in place: the organization and
  // published-status constraints are the isolation boundary, and a later branch
  // that reassigned `where.rfq` would silently drop them.
  const rfqFilter: Prisma.RFQWhereInput = {
    organizationId,
    status: { in: [...VISIBLE_TO_SUPPLIER] },
  };

  const wanted = q.status && q.status !== "ALL" ? q.status.split(",") : [];
  const invitationStatuses = wanted.filter((w) => w !== "OPEN");

  if (wanted.includes("OPEN")) {
    rfqFilter.status = { in: ["PUBLISHED", "RESPONSE_PERIOD"] };
    rfqFilter.deadline = { gt: new Date() };
  }
  if (q.search) {
    rfqFilter.OR = [
      { rfqNumber: { contains: q.search, mode: "insensitive" } },
      { title: { contains: q.search, mode: "insensitive" } },
    ];
  }

  const where: Prisma.RFQVendorWhereInput = {
    vendorId,
    rfq: rfqFilter,
    ...(invitationStatuses.length > 0
      ? { status: { in: invitationStatuses as Prisma.EnumRFQInvitationStatusFilter["in"] } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.rFQVendor.count({ where }),
    db.rFQVendor.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { rfq: { deadline: q.dir } },
      include: {
        rfq: {
          select: {
            id: true,
            rfqNumber: true,
            title: true,
            status: true,
            currency: true,
            deadline: true,
            publishedAt: true,
            organization: { select: { name: true } },
            _count: { select: { lineItems: true } },
          },
        },
      },
    }),
  ]);

  // The supplier's own quotations, fetched separately and matched on. Including
  // them through the RFQ relation would have meant a where-clause on a nested
  // list — one missed filter away from returning a competitor's bid.
  const myQuotes = await db.quotation.findMany({
    where: { vendorId, organizationId, rfqId: { in: rows.map((r) => r.rfqId) } },
    select: { id: true, rfqId: true, status: true, totalAmount: true, currency: true, revision: true, submittedAt: true },
    orderBy: { revision: "desc" },
  });

  const now = Date.now();
  const items = rows.map((r) => {
    const mine = myQuotes.find((q) => q.rfqId === r.rfqId);
    return {
      rfqId: r.rfqId,
      rfqNumber: r.rfq.rfqNumber,
      title: r.rfq.title,
      buyerName: r.rfq.organization.name,
      status: r.rfq.status,
      currency: r.rfq.currency,
      deadline: r.rfq.deadline,
      publishedAt: r.rfq.publishedAt,
      lineItemCount: r.rfq._count.lineItems,
      invitationStatus: r.status,
      invitedAt: r.invitedAt,
      viewedAt: r.viewedAt,
      isOpen:
        (r.rfq.status === "PUBLISHED" || r.rfq.status === "RESPONSE_PERIOD") &&
        r.rfq.deadline.getTime() > now,
      secondsRemaining: Math.max(0, Math.floor((r.rfq.deadline.getTime() - now) / 1000)),
      myQuotation: mine
        ? {
            id: mine.id,
            status: mine.status,
            totalAmount: mine.totalAmount,
            currency: mine.currency,
            revision: mine.revision,
            submittedAt: mine.submittedAt,
          }
        : null,
    };
  });

  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/**
 * One RFQ, as the supplier sees it — and the point at which "viewed" becomes true.
 *
 * The view is recorded on a genuine read of the document rather than on a list
 * impression, because §23's response monitor is only useful if "5 viewed" means
 * five suppliers actually opened the tender.
 */
export async function getRfq(ctx: SupplierServiceContext, rfqId: string) {
  const invitation = await invitationFor(ctx, rfqId);
  const now = new Date();

  const firstView = invitation.viewedAt === null;
  await db.rFQVendor.update({
    where: { id: invitation.id },
    data: {
      viewedAt: invitation.viewedAt ?? now,
      lastViewedAt: now,
      viewCount: { increment: 1 },
      // Only INVITED advances to VIEWED. A supplier who has already accepted or
      // quoted must not be walked backwards by re-reading the page.
      ...(invitation.status === "INVITED" ? { status: "VIEWED" as const } : {}),
    },
  });

  if (firstView) {
    await db.supplierActivity.create({
      data: {
        vendorId: ctx.principal.vendorId,
        type: "RFQ_VIEWED",
        description: `Opened ${invitation.rfq.rfqNumber}: ${invitation.rfq.title}`,
        referenceId: rfqId,
      },
    });
    await recordAudit({
      organizationId: ctx.principal.organizationId,
      supplierUserId: ctx.principal.supplierUserId,
      action: "rfq.viewed_by_supplier",
      resource: "RFQ",
      resourceId: rfqId,
      after: { vendorId: ctx.principal.vendorId, rfqNumber: invitation.rfq.rfqNumber },
      context: ctx.context,
    });
  }

  const [quotation, clarifications] = await Promise.all([
    myQuotationFor(ctx, rfqId),
    listClarifications(ctx, rfqId),
  ]);

  const eligibility = canRespond({
    ...invitation,
    status: invitation.status === "INVITED" ? "VIEWED" : invitation.status,
  });

  return {
    ...forSupplier(invitation),
    myQuotation: quotation,
    clarifications,
    canRespond: eligibility.ok,
    cannotRespondReason: eligibility.reason ?? null,
    canAskQuestions:
      eligibility.ok &&
      (!invitation.rfq.questionDeadline || invitation.rfq.questionDeadline.getTime() > Date.now()),
  };
}

// ---------------------------------------------------------------------------
// Responding to an invitation
// ---------------------------------------------------------------------------

export async function acceptInvitation(ctx: SupplierServiceContext, rfqId: string) {
  const invitation = await invitationFor(ctx, rfqId);
  const eligibility = canRespond(invitation);
  if (!eligibility.ok) throw conflict(eligibility.reason!);

  if (invitation.status === "QUOTED") {
    throw conflict("You have already submitted a quotation for this RFQ");
  }

  const now = new Date();
  await db.rFQVendor.update({
    where: { id: invitation.id },
    data: { status: "ACCEPTED", acceptedAt: invitation.acceptedAt ?? now },
  });

  await db.supplierActivity.create({
    data: {
      vendorId: ctx.principal.vendorId,
      type: "RFQ_ACCEPTED",
      description: `Accepted the invitation to quote on ${invitation.rfq.rfqNumber}`,
      referenceId: rfqId,
    },
  });
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    supplierUserId: ctx.principal.supplierUserId,
    action: "rfq.invitation_accepted",
    resource: "RFQ",
    resourceId: rfqId,
    after: { vendorId: ctx.principal.vendorId },
    context: ctx.context,
  });

  await notifyBuyers(ctx, invitation.rfq, "rfq.invitation_accepted", {
    title: `Supplier accepted — ${invitation.rfq.rfqNumber}`,
    message: `${ctx.principal.contactName} confirmed their intention to quote on "${invitation.rfq.title}".`,
  });

  return getRfq(ctx, rfqId);
}

export async function declineInvitation(
  ctx: SupplierServiceContext,
  rfqId: string,
  input: z.infer<typeof declineInvitationSchema>
) {
  const invitation = await invitationFor(ctx, rfqId);
  const eligibility = canRespond(invitation);
  if (!eligibility.ok) throw conflict(eligibility.reason!);

  if (invitation.status === "QUOTED") {
    throw conflict(
      "You have already submitted a quotation. Withdraw it before declining the invitation."
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.rFQVendor.update({
      where: { id: invitation.id },
      data: { status: "DECLINED", declinedAt: now, declineReason: input.reason },
    });
    await tx.quotation.updateMany({
      where: { rfqId, vendorId: ctx.principal.vendorId, status: "DRAFT" },
      data: { status: "WITHDRAWN", withdrawnAt: now, withdrawnReason: "Invitation declined" },
    });
  });

  await db.supplierActivity.create({
    data: {
      vendorId: ctx.principal.vendorId,
      type: "RFQ_DECLINED",
      description: `Declined ${invitation.rfq.rfqNumber} — ${input.reason}`,
      referenceId: rfqId,
    },
  });
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    supplierUserId: ctx.principal.supplierUserId,
    action: "rfq.invitation_declined",
    resource: "RFQ",
    resourceId: rfqId,
    after: { vendorId: ctx.principal.vendorId, reason: input.reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    eventType: "RFQ_DECLINED",
    description: `A supplier declined ${invitation.rfq.rfqNumber} — ${input.reason}`,
    severity: "WARNING",
    rfqId,
    vendorId: ctx.principal.vendorId,
    context: ctx.context,
  });

  await notifyBuyers(ctx, invitation.rfq, "rfq.invitation_declined", {
    title: `Supplier declined — ${invitation.rfq.rfqNumber}`,
    message: `A supplier will not be quoting on "${invitation.rfq.title}" — ${input.reason}`,
  });

  return getRfq(ctx, rfqId);
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

/**
 * This supplier's quotation on an RFQ: the live draft if there is one, otherwise
 * the latest submitted revision.
 *
 * A draft outranks a submission because a draft only exists when the buyer has
 * invited a revision — otherwise submitting supersedes and discards it.
 */
async function myQuotationFor(ctx: SupplierServiceContext, rfqId: string) {
  const quotations = await db.quotation.findMany({
    where: { rfqId, vendorId: ctx.principal.vendorId, organizationId: ctx.principal.organizationId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    orderBy: { revision: "desc" },
  });
  if (quotations.length === 0) return null;

  const chosen = quotations.find((q) => q.status === "DRAFT") ?? quotations[0];

  return {
    id: chosen.id,
    quotationNumber: chosen.quotationNumber,
    revision: chosen.revision,
    status: chosen.status,
    currency: chosen.currency,
    subtotal: chosen.subtotal,
    discountAmount: chosen.discountAmount,
    taxAmount: chosen.taxAmount,
    shippingAmount: chosen.shippingAmount,
    totalAmount: chosen.totalAmount,
    deliveryDays: chosen.deliveryDays,
    warranty: chosen.warranty,
    paymentTerms: chosen.paymentTerms,
    validUntil: chosen.validUntil,
    validityDays: chosen.validityDays,
    supplierReference: chosen.supplierReference,
    notes: chosen.notes,
    submittedAt: chosen.submittedAt,
    withdrawnAt: chosen.withdrawnAt,
    lineItems: chosen.lineItems,
    // Deliberately absent: evaluationScore, weightedScore, rank, evaluationNotes,
    // isCompliant, complianceNotes. Those are the buyer's assessment of this bid
    // and §30 puts them out of reach — Rule 10.
    history: quotations.map((q) => ({
      id: q.id,
      revision: q.revision,
      status: q.status,
      totalAmount: q.status === "DRAFT" ? null : q.totalAmount,
      submittedAt: q.submittedAt,
    })),
  };
}

export async function getMyQuotation(ctx: SupplierServiceContext, rfqId: string) {
  await invitationFor(ctx, rfqId);
  return myQuotationFor(ctx, rfqId);
}

/**
 * Saves work in progress (§15).
 *
 * A draft is the supplier's own workspace: it is not visible to the buyer, it does
 * not count as a response, and it is allowed to be incomplete. Only one exists per
 * supplier per RFQ, so saving repeatedly refines the same record rather than
 * littering the tender with abandoned attempts.
 *
 * Totals are computed on every save even though nothing is committed, so what the
 * supplier sees while drafting is what will be submitted.
 */
export async function saveDraft(ctx: SupplierServiceContext, rfqId: string, input: DraftInput) {
  const invitation = await invitationFor(ctx, rfqId);
  const eligibility = canRespond(invitation);
  if (!eligibility.ok) throw conflict(eligibility.reason!);

  const submitted = await db.quotation.findFirst({
    where: {
      rfqId,
      vendorId: ctx.principal.vendorId,
      status: { notIn: ["DRAFT", "WITHDRAWN", "SUPERSEDED"] },
    },
    orderBy: { revision: "desc" },
  });

  // Rule 4. A submitted bid is not editable; a draft may only exist alongside one
  // when the buyer has opened a revision.
  if (submitted && !invitation.rfq.allowSupplierRevision && invitation.revisionAllowedAt === null) {
    throw conflict(
      "Your quotation has been submitted and cannot be changed. Ask the buyer to invite a revision."
    );
  }

  const rfqLineIds = new Set(invitation.rfq.lineItems.map((l) => l.id));
  for (const li of input.lineItems) {
    if (li.rfqLineItemId && !rfqLineIds.has(li.rfqLineItemId)) {
      throw validation("A quoted line refers to an item that is not on this RFQ");
    }
  }

  const totals = costQuotation(input.lineItems, {
    discountAmount: input.discountAmount,
    shippingAmount: input.shippingAmount,
  });

  const validUntil = input.validUntil
    ? new Date(input.validUntil)
    : input.validityDays
      ? new Date(invitation.rfq.deadline.getTime() + input.validityDays * 86_400_000)
      : null;

  const existingDraft = await db.quotation.findFirst({
    where: { rfqId, vendorId: ctx.principal.vendorId, status: "DRAFT" },
  });

  const lineData = input.lineItems.map((li, i) => {
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
  });

  const header = {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    shippingAmount: totals.shippingAmount,
    totalAmount: totals.totalAmount,
    deliveryDays: input.deliveryDays,
    warranty: input.warranty || null,
    paymentTerms: input.paymentTerms || null,
    validUntil,
    validityDays: input.validityDays ?? null,
    supplierReference: input.supplierReference || null,
    notes: input.notes || null,
  };

  await db.$transaction(async (tx) => {
    if (existingDraft) {
      await tx.quotationLineItem.deleteMany({ where: { quotationId: existingDraft.id } });
      await tx.quotation.update({
        where: { id: existingDraft.id },
        data: { ...header, lineItems: { create: lineData } },
      });
      return;
    }

    // The revision number is reserved at draft time so the supplier can see which
    // version they are preparing, and so a concurrent submission cannot collide.
    const latest = await tx.quotation.findFirst({
      where: { rfqId, vendorId: ctx.principal.vendorId },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });

    await tx.quotation.create({
      data: {
        organizationId: ctx.principal.organizationId,
        rfqId,
        vendorId: ctx.principal.vendorId,
        revision: (latest?.revision ?? 0) + 1,
        currency: invitation.rfq.currency,
        status: "DRAFT",
        submittedAt: null,
        submittedBySupplierUserId: ctx.principal.supplierUserId,
        ...header,
        lineItems: { create: lineData },
      },
    });
  });

  if (!existingDraft) {
    await db.supplierActivity.create({
      data: {
        vendorId: ctx.principal.vendorId,
        type: "QUOTE_DRAFTED",
        description: `Started a quotation for ${invitation.rfq.rfqNumber}`,
        referenceId: rfqId,
      },
    });
  }

  return myQuotationFor(ctx, rfqId);
}

/**
 * Submits the quotation (§16).
 *
 * Validation of completeness happens here and only here — a draft is allowed to be
 * half-finished, a submission is not. Everything past this point runs through
 * `captureQuotation`, which is the same code the buyer's internal capture uses, so
 * a bid taken over the phone and a bid typed into the portal are the same record
 * governed by the same rules.
 */
export async function submitQuotation(
  ctx: SupplierServiceContext,
  rfqId: string,
  input: SubmitInput
) {
  const invitation = await invitationFor(ctx, rfqId);
  const eligibility = canRespond(invitation);
  if (!eligibility.ok) throw conflict(eligibility.reason!);

  const problems: { path: string; message: string }[] = [];

  const priced = input.lineItems.filter((li) => !li.isNoBid);
  if (priced.length === 0) {
    problems.push({ path: "lineItems", message: "Price at least one line, or decline the invitation" });
  }
  for (const [i, li] of input.lineItems.entries()) {
    if (!li.isNoBid && li.unitPrice <= 0) {
      problems.push({ path: `lineItems.${i}.unitPrice`, message: `Give a price for "${li.itemName}"` });
    }
  }
  if (input.deliveryDays === undefined || input.deliveryDays === null) {
    problems.push({ path: "deliveryDays", message: "State your delivery lead time" });
  }
  if (!input.validUntil && !input.validityDays) {
    problems.push({ path: "validUntil", message: "State how long this quotation stays valid" });
  }

  // Every RFQ line has to be answered — with a price or with an explicit no-bid.
  // Silence on a line is the ambiguity that makes a comparison unusable.
  const answered = new Set(input.lineItems.map((li) => li.rfqLineItemId).filter(Boolean));
  const unanswered = invitation.rfq.lineItems.filter((l) => !answered.has(l.id));
  if (unanswered.length > 0) {
    problems.push({
      path: "lineItems",
      message: `Respond to every line — missing: ${unanswered.map((l) => l.itemName).join(", ")}`,
    });
  }

  if (problems.length > 0) {
    throw validation("This quotation is not ready to submit", { issues: problems });
  }

  const quotation = await captureQuotation(
    {
      organizationId: ctx.principal.organizationId,
      rfqId,
      vendorId: ctx.principal.vendorId,
      actorId: null,
      actorName: ctx.principal.contactName,
      supplierUserId: ctx.principal.supplierUserId,
    },
    input
  );

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    supplierUserId: ctx.principal.supplierUserId,
    action: "quotation.submitted_by_supplier",
    resource: "Quotation",
    resourceId: quotation.id,
    after: {
      rfqId,
      vendorId: ctx.principal.vendorId,
      totalAmount: quotation.totalAmount,
      revision: quotation.revision,
    },
    context: ctx.context,
  });

  return myQuotationFor(ctx, rfqId);
}

/**
 * Withdraws a submitted quotation.
 *
 * Permitted only while the RFQ is still open. Once the response period closes the
 * bid is part of a competition that is being decided, and letting a supplier pull
 * it at that point would let them dodge an award they no longer like the look of.
 */
export async function withdrawQuotation(
  ctx: SupplierServiceContext,
  rfqId: string,
  input: z.infer<typeof withdrawQuotationSchema>
) {
  const invitation = await invitationFor(ctx, rfqId);

  if (invitation.rfq.status !== "PUBLISHED" && invitation.rfq.status !== "RESPONSE_PERIOD") {
    throw conflict("This RFQ has closed. A submitted quotation can no longer be withdrawn.");
  }
  if (invitation.rfq.deadline.getTime() < Date.now()) {
    throw conflict("The deadline has passed. A submitted quotation can no longer be withdrawn.");
  }

  const quotation = await db.quotation.findFirst({
    where: {
      rfqId,
      vendorId: ctx.principal.vendorId,
      status: { in: ["SUBMITTED", "RECEIVED", "DRAFT"] },
    },
    orderBy: { revision: "desc" },
  });
  if (!quotation) throw notFound("You have no live quotation on this RFQ");
  if (quotation.status === "SELECTED") {
    throw conflict("This quotation has been awarded and cannot be withdrawn");
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: "WITHDRAWN", withdrawnAt: now, withdrawnReason: input.reason },
    });
    await tx.rFQVendor.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", respondedAt: null },
    });
  });

  await db.supplierActivity.create({
    data: {
      vendorId: ctx.principal.vendorId,
      type: "QUOTE_WITHDRAWN",
      description: `Withdrew the quotation for ${invitation.rfq.rfqNumber} — ${input.reason}`,
      referenceId: rfqId,
    },
  });
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    supplierUserId: ctx.principal.supplierUserId,
    action: "quotation.withdrawn",
    resource: "Quotation",
    resourceId: quotation.id,
    before: { status: quotation.status },
    after: { status: "WITHDRAWN", reason: input.reason },
    context: ctx.context,
  });

  await notifyBuyers(ctx, invitation.rfq, "rfq.quotation_withdrawn", {
    title: `Quotation withdrawn — ${invitation.rfq.rfqNumber}`,
    message: `A supplier withdrew their quotation — ${input.reason}`,
  });

  return myQuotationFor(ctx, rfqId);
}

/** This supplier's submission history across every RFQ (§48, test 12 side). */
export async function myQuotations(ctx: SupplierServiceContext, q: ListInput) {
  const where: Prisma.QuotationWhereInput = {
    vendorId: ctx.principal.vendorId,
    organizationId: ctx.principal.organizationId,
  };
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as Prisma.EnumQuotationStatusFilter["in"] };
  }

  const [total, items] = await Promise.all([
    db.quotation.count({ where }),
    db.quotation.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quotationNumber: true,
        revision: true,
        status: true,
        currency: true,
        totalAmount: true,
        deliveryDays: true,
        validUntil: true,
        submittedAt: true,
        createdAt: true,
        rfq: { select: { id: true, rfqNumber: true, title: true, status: true, deadline: true } },
        _count: { select: { lineItems: true } },
      },
    }),
  ]);

  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Clarifications (§19)
// ---------------------------------------------------------------------------

/**
 * What this supplier may read of the clarification thread: their own questions,
 * plus anything the buyer published to all bidders.
 *
 * Another supplier's private question is not returned — and neither is the
 * identity of whoever asked a published one, because "who is worried about clause
 * 7" is competitive intelligence.
 */
export async function listClarifications(ctx: SupplierServiceContext, rfqId: string) {
  const rows = await db.rFQClarification.findMany({
    where: {
      rfqId,
      organizationId: ctx.principal.organizationId,
      OR: [
        { vendorId: ctx.principal.vendorId },
        { visibility: "ALL_SUPPLIERS", status: "ANSWERED" },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((c) => ({
    id: c.id,
    question: c.question,
    answer: c.answer,
    status: c.status,
    visibility: c.visibility,
    createdAt: c.createdAt,
    answeredAt: c.answeredAt,
    /** Whether this supplier asked it, so the UI can separate "mine" from notices. */
    isMine: c.vendorId === ctx.principal.vendorId,
  }));
}

export async function askClarification(
  ctx: SupplierServiceContext,
  rfqId: string,
  input: z.infer<typeof askClarificationSchema>
) {
  const invitation = await invitationFor(ctx, rfqId);

  if (invitation.rfq.status !== "PUBLISHED" && invitation.rfq.status !== "RESPONSE_PERIOD") {
    throw conflict("This RFQ is no longer open for questions");
  }
  const questionsClose = invitation.rfq.questionDeadline ?? invitation.rfq.deadline;
  if (questionsClose.getTime() < Date.now()) {
    throw conflict(`Questions closed on ${questionsClose.toDateString()}`);
  }

  const created = await db.rFQClarification.create({
    data: {
      organizationId: ctx.principal.organizationId,
      rfqId,
      vendorId: ctx.principal.vendorId,
      askedBySupplierUserId: ctx.principal.supplierUserId,
      question: input.question,
      visibility: "PRIVATE",
      status: "OPEN",
    },
  });

  await db.supplierActivity.create({
    data: {
      vendorId: ctx.principal.vendorId,
      type: "CLARIFICATION_ASKED",
      description: `Asked a question about ${invitation.rfq.rfqNumber}`,
      referenceId: rfqId,
    },
  });
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    supplierUserId: ctx.principal.supplierUserId,
    action: "rfq.clarification_asked",
    resource: "RFQClarification",
    resourceId: created.id,
    after: { rfqId, vendorId: ctx.principal.vendorId },
    context: ctx.context,
  });

  await notifyBuyers(ctx, invitation.rfq, "rfq.clarification_asked", {
    title: `Question on ${invitation.rfq.rfqNumber}`,
    message: input.question.slice(0, 240),
  });

  return listClarifications(ctx, rfqId);
}

// ---------------------------------------------------------------------------
// Notifying the other side
// ---------------------------------------------------------------------------

/**
 * Tells the buying side something a supplier did.
 *
 * The recipients are the people who own this RFQ — its creator and its evaluation
 * panel — not every procurement manager in the tenant. A notification that goes to
 * everyone is one nobody reads.
 */
async function notifyBuyers(
  ctx: SupplierServiceContext,
  rfq: { id: string; createdById: string | null; organizationId: string },
  type: Parameters<typeof emit>[0]["type"],
  message: { title: string; message: string }
) {
  const evaluators = await db.rFQEvaluator.findMany({
    where: { rfqId: rfq.id },
    select: { userId: true },
  });
  const recipients = [
    ...new Set([...(rfq.createdById ? [rfq.createdById] : []), ...evaluators.map((e) => e.userId)]),
  ];
  if (recipients.length === 0) return;

  await emit({
    type,
    organizationId: ctx.principal.organizationId,
    // No actorId: the actor is a supplier, and `actorId` addresses the employee
    // realm. Passing the supplier's id here would suppress the notification for
    // whichever employee happened to share that id.
    actorId: null,
    recipientIds: recipients,
    title: message.title,
    message: message.message,
    severity: "info",
    link: "rfqs",
    entityType: "RFQ",
    entityId: rfq.id,
  });
}

/** The supplier's own activity feed. */
export async function myActivity(ctx: SupplierServiceContext, limit = 50) {
  return db.supplierActivity.findMany({
    where: { vendorId: ctx.principal.vendorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
}

/** The supplier's own profile, as the portal header renders it. */
export async function me(ctx: SupplierServiceContext) {
  const vendor = await db.vendor.findFirst({
    where: { id: ctx.principal.vendorId, organizationId: ctx.principal.organizationId },
    select: {
      id: true,
      code: true,
      companyName: true,
      email: true,
      phone: true,
      status: true,
      complianceState: true,
      preferredCurrency: true,
      organization: { select: { id: true, name: true, logoUrl: true } },
    },
  });
  if (!vendor) throw forbidden("This supplier account is no longer active");

  return {
    contact: {
      id: ctx.principal.supplierUserId,
      name: ctx.principal.contactName,
      email: ctx.principal.email,
    },
    vendor: {
      id: vendor.id,
      code: vendor.code,
      companyName: vendor.companyName,
      email: vendor.email,
      phone: vendor.phone,
      status: vendor.status,
      complianceState: vendor.complianceState,
      preferredCurrency: vendor.preferredCurrency,
    },
    buyer: vendor.organization,
  };
}
