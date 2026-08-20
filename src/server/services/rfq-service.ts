// NextMav Procure — RFQ lifecycle.
//
// The document suppliers actually see, and the one every control in Phase 4/5
// hangs off:
//
//   DRAFT → UNDER_REVIEW → APPROVED → READY_TO_PUBLISH → PUBLISHED
//         → RESPONSE_PERIOD → CLOSED → UNDER_EVALUATION → AWARDED | NO_AWARD
//
// Three things about this module are worth stating up front, because they are the
// difference between a sourcing system and a set of forms:
//
//   Publication is a transaction. Validation, the status move, the invitations
//   and the event's own state all commit together or not at all (§10). A half
//   published RFQ — status changed, invitations missing — would leave suppliers
//   holding nothing while the buyer's dashboard says the market has been engaged.
//
//   Approval is not reimplemented here. Publication routes through the same
//   ApprovalInstance engine that governs requests and vendors (§7). Where an
//   organization has configured no RFQ workflow, the RFQ approves itself and says
//   so in the audit trail — an unconfigured control is recorded as absent rather
//   than silently invented.
//
//   Nothing here trusts the client for eligibility. A blacklisted, suspended or
//   archived supplier cannot be invited even if their id is posted directly
//   (Rule 5), and the deadline is enforced server-side on every write (§17).

import type { Prisma, RFQStatus, VendorStatus } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission, can } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import { transition, nextStates } from "../state-machine";
import * as workflow from "../engines/workflow";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import { resolveEventForRfq, syncEventStatus } from "./sourcing-service";
import type {
  createRfqSchema,
  updateRfqSchema,
  rfqLineItemsSchema,
  rfqCriteriaSchema,
  rfqEvaluatorsSchema,
  inviteSuppliersSchema,
  eligibleSupplierQuerySchema,
  rfqDecisionSchema,
  allowRevisionSchema,
  answerClarificationSchema,
  issueNoticeSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createRfqSchema>;
type UpdateInput = z.infer<typeof updateRfqSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["createdAt", "deadline", "rfqNumber", "status", "title", "publishedAt"] as const;

/** Statuses in which an RFQ is still open to quotations. */
export const OPEN_STATUSES: RFQStatus[] = ["PUBLISHED", "RESPONSE_PERIOD"];

/** Statuses in which the document is still the buyer's to edit. */
const EDITABLE_STATUSES: RFQStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "READY_TO_PUBLISH"];

/**
 * Supplier statuses that may be invited to a new sourcing event.
 *
 * APPROVED but not yet ACTIVE is included deliberately: approval is the decision
 * that the organization is willing to deal with them, and a supplier approved on
 * Friday should not be barred from Monday's tender for want of an activation
 * click. Everything else — prospective, onboarding, suspended, inactive,
 * rejected, archived, blacklisted — is out (Rule 5).
 */
export const INVITABLE_VENDOR_STATUSES: VendorStatus[] = ["ACTIVE", "APPROVED"];

const RISK_ORDER = ["UNRATED", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const rfqInclude = {
  sourcingEvent: {
    select: { id: true, eventNumber: true, title: true, status: true, type: true, requestId: true },
  },
  request: { select: { id: true, requestNumber: true, title: true, status: true } },
  categoryRef: { select: { id: true, code: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  lineItems: { orderBy: { sortOrder: "asc" } },
  criteria: { orderBy: { sortOrder: "asc" } },
  evaluators: {
    include: {
      user: { select: { id: true, name: true, email: true, initials: true, avatarColor: true } },
    },
    orderBy: { assignedAt: "asc" },
  },
  invitedVendors: {
    include: {
      vendor: {
        select: {
          id: true,
          companyName: true,
          email: true,
          phone: true,
          status: true,
          rating: true,
          onTimeDeliveryRate: true,
          qualityRating: true,
          complianceState: true,
          riskLevel: true,
          country: true,
        },
      },
    },
    orderBy: { invitedAt: "asc" },
  },
  purchaseOrders: { select: { id: true, poNumber: true, status: true } },
} satisfies Prisma.RFQInclude;

export type RfqDetail = Prisma.RFQGetPayload<{ include: typeof rfqInclude }>;

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

async function loadRfq(ctx: ServiceContext, id: string) {
  const rfq = await scoped(ctx).rFQ.findUnique({ where: { id }, include: rfqInclude });
  if (!rfq) throw notFound("RFQ not found");
  return rfq;
}

function assertEditable(rfq: { rfqNumber: string; status: RFQStatus }) {
  if (!EDITABLE_STATUSES.includes(rfq.status)) {
    throw conflict(
      `${rfq.rfqNumber} is ${pretty(rfq.status)} and can no longer be edited. Suppliers already hold it.`
    );
  }
}

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase();

/**
 * Whether the RFQ is complete enough to go to the market — §10's validation, and
 * the fact behind READY_TO_PUBLISH.
 *
 * Returned as a list rather than thrown, because the RFQ builder shows the buyer
 * what is still outstanding while they work rather than only at the moment they
 * press publish.
 */
export function publishReadiness(rfq: {
  deadline: Date;
  questionDeadline: Date | null;
  lineItems: { id: string }[];
  criteria: { weight: number }[];
  invitedVendors: { vendor: { status: VendorStatus; companyName: string } }[];
  evaluationMethod: string;
}): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];

  if (rfq.lineItems.length === 0) {
    problems.push({ path: "lineItems", message: "Add at least one line item for suppliers to price" });
  }

  const eligible = rfq.invitedVendors.filter((iv) =>
    INVITABLE_VENDOR_STATUSES.includes(iv.vendor.status)
  );
  if (rfq.invitedVendors.length === 0) {
    problems.push({ path: "invitedVendors", message: "Invite at least one approved supplier" });
  } else if (eligible.length === 0) {
    problems.push({
      path: "invitedVendors",
      message: "None of the invited suppliers is currently eligible to receive an RFQ",
    });
  }

  if (rfq.deadline.getTime() <= Date.now()) {
    problems.push({ path: "deadline", message: "The response deadline must be in the future" });
  }

  if (rfq.questionDeadline && rfq.questionDeadline.getTime() > rfq.deadline.getTime()) {
    problems.push({
      path: "questionDeadline",
      message: "Questions must close on or before the response deadline",
    });
  }

  // §27: weights are shares of one decision, so they have to add up to it. Only
  // checked when the method actually uses them — a lowest-price award needs no
  // criteria at all, and demanding them would be ceremony.
  if (rfq.evaluationMethod !== "LOWEST_PRICE") {
    if (rfq.criteria.length === 0) {
      problems.push({
        path: "criteria",
        message: "A weighted evaluation needs at least one criterion",
      });
    } else {
      const total = Math.round(rfq.criteria.reduce((s, c) => s + c.weight, 0) * 100) / 100;
      if (Math.abs(total - 100) > 0.01) {
        problems.push({
          path: "criteria",
          message: `Evaluation weights total ${total}%. They must total 100%.`,
        });
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "rfqs.view");
  const tdb = scoped(ctx);

  const where: Prisma.RFQWhereInput = {};
  if (q.status && q.status !== "ALL") where.status = { in: q.status.split(",") as RFQStatus[] };
  if (q.category) where.categoryId = q.category;
  if (q.vendorId) where.invitedVendors = { some: { vendorId: q.vendorId } };
  if (q.search) {
    where.OR = [
      { rfqNumber: { contains: q.search, mode: "insensitive" } },
      { referenceNumber: { contains: q.search, mode: "insensitive" } },
      { title: { contains: q.search, mode: "insensitive" } },
      { description: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.from || q.to) {
    where.deadline = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }
  // `departmentId` doubles as the buyer filter on this collection: sourcing is
  // owned by a person, not a department, and the list needs "mine" far more than
  // it needs a department cut.
  if (q.departmentId) where.createdById = q.departmentId;

  const [total, items] = await Promise.all([
    tdb.rFQ.count({ where }),
    tdb.rFQ.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        sourcingEvent: { select: { id: true, eventNumber: true, title: true } },
        categoryRef: { select: { id: true, name: true } },
        request: { select: { id: true, requestNumber: true } },
        invitedVendors: {
          select: {
            vendorId: true,
            status: true,
            vendor: { select: { id: true, companyName: true } },
          },
        },
        // Draft quotations belong to the supplier and are not a response yet, so
        // they must not appear in the buyer's response count.
        quotations: {
          where: { status: { notIn: ["DRAFT", "SUPERSEDED", "WITHDRAWN"] } },
          select: { id: true, vendorId: true, totalAmount: true, currency: true, status: true },
        },
        _count: { select: { invitedVendors: true } },
      },
    }),
  ]);

  const shaped = items.map((r) => {
    const responded = r.invitedVendors.filter((iv) => iv.status === "QUOTED").length;
    const declined = r.invitedVendors.filter((iv) => iv.status === "DECLINED").length;
    const viewed = r.invitedVendors.filter(
      (iv) => iv.status !== "INVITED" && iv.status !== "NO_RESPONSE"
    ).length;
    const amounts = r.quotations.map((q) => q.totalAmount);
    return {
      ...r,
      responseSummary: {
        invited: r._count.invitedVendors,
        viewed,
        responded,
        declined,
        pending: r._count.invitedVendors - responded - declined,
      },
      lowestQuote: amounts.length ? Math.min(...amounts) : null,
    };
  });

  return paginate(shaped, total, q.page, q.pageSize);
}

/**
 * One RFQ, with everything the buyer needs to act on it.
 *
 * Quotations are fetched separately from the main include because they are the
 * one part of the record that is conditionally readable: a sealed RFQ hides bid
 * contents until the deadline passes, and drafts are never the buyer's to see.
 */
export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  const rfq = await loadRfq(ctx, id);

  const [quotations, clarifications, recommendations, approval] = await Promise.all([
    readableQuotations(rfq),
    listClarifications(ctx, id),
    scoped(ctx).awardRecommendation.findMany({
      where: { rfqId: id },
      include: {
        vendor: { select: { id: true, companyName: true } },
        quotation: { select: { id: true, totalAmount: true, currency: true, revision: true } },
        recommendedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    approvalStateFor(ctx, "RFQ", id),
  ]);

  // An award recommendation is approved on its own chain, routed on value rather
  // than on the RFQ. Attaching it here means the award screen knows which step —
  // if any — the viewer can decide, without a second round trip per recommendation.
  const recommendationsWithApproval = await Promise.all(
    recommendations.map(async (r) => ({
      ...r,
      approval: await approvalStateFor(ctx, "AWARD", r.id),
    }))
  );

  return {
    ...rfq,
    quotations,
    clarifications,
    recommendations: recommendationsWithApproval,
    approval,
    readiness: publishReadiness(rfq),
    availableTransitions: nextStates("rfq", rfq.status),
    isSealedAndLocked: rfq.isSealed && rfq.deadline.getTime() > Date.now(),
  };
}

/**
 * The bids the buyer is allowed to read right now.
 *
 * Sealed bidding is enforced here rather than in the UI: before the deadline the
 * buyer learns that a bid exists and who sent it — which they need in order to
 * chase the rest — but not one figure from inside it. Hiding the existence too
 * would make the response monitor useless; showing the numbers would make sealing
 * a decoration.
 */
async function readableQuotations(rfq: { id: string; isSealed: boolean; deadline: Date }) {
  const sealed = rfq.isSealed && rfq.deadline.getTime() > Date.now();

  const quotations = await db.quotation.findMany({
    where: { rfqId: rfq.id, status: { notIn: ["DRAFT"] } },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      vendor: {
        select: {
          id: true,
          companyName: true,
          rating: true,
          onTimeDeliveryRate: true,
          qualityRating: true,
          status: true,
          riskLevel: true,
        },
      },
      scores: {
        include: {
          criterion: { select: { id: true, name: true, weight: true, maxScore: true } },
          evaluator: { select: { id: true, userId: true, role: true } },
          scoredBy: { select: { id: true, name: true } },
        },
      },
      submittedBySupplierUser: { select: { id: true, contactName: true, email: true } },
    },
    orderBy: [{ revision: "desc" }, { totalAmount: "asc" }],
  });

  if (!sealed) return quotations;

  return quotations.map((q) => ({
    ...q,
    sealed: true as const,
    subtotal: 0,
    discountAmount: 0,
    taxAmount: 0,
    shippingAmount: 0,
    totalAmount: 0,
    deliveryDays: 0,
    warranty: null,
    paymentTerms: null,
    notes: null,
    lineItems: [],
    scores: [],
  }));
}

/** The approval instance governing an entity, shaped for the UI. */
async function approvalStateFor(ctx: ServiceContext, entityType: "RFQ" | "AWARD", entityId: string) {
  const instance = await scoped(ctx).approvalInstance.findFirst({
    where: { entityType, entityId },
    orderBy: { startedAt: "desc" },
    include: {
      workflow: { select: { id: true, name: true, version: true } },
      steps: {
        orderBy: { sequence: "asc" },
        include: {
          approver: { select: { id: true, name: true, initials: true, avatarColor: true } },
          delegatedTo: { select: { id: true, name: true } },
          stageRef: { select: { id: true, name: true, description: true } },
        },
      },
    },
  });
  if (!instance) return null;

  const state = workflow.chainState(instance.steps);
  return {
    ...instance,
    activeStepIds: state.activeSteps.map((s) => s.id),
    isComplete: state.isComplete,
    isRejected: state.isRejected,
    /** The step this caller can decide right now, if any. */
    myStepId:
      state.activeSteps.find(
        (s) => s.approverId === ctx.principal.userId || s.delegatedToId === ctx.principal.userId
      )?.id ?? null,
  };
}

/**
 * The sourcing dashboard (§20). Every number is a database count; nothing here is
 * derived from a page of results that happened to be loaded.
 */
export async function dashboard(ctx: ServiceContext) {
  await assertPermission(ctx.principal, "rfqs.view");
  const organizationId = ctx.principal.organizationId;
  const soon = new Date(Date.now() + 3 * 86_400_000);

  const [byStatus, closingSoon, invitations, quotationAgg, awardsPending, myEvaluations] =
    await Promise.all([
      db.rFQ.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      }),
      db.rFQ.count({
        where: {
          organizationId,
          status: { in: OPEN_STATUSES },
          deadline: { gte: new Date(), lte: soon },
        },
      }),
      db.rFQVendor.groupBy({
        by: ["status"],
        where: { rfq: { organizationId, status: { notIn: ["DRAFT", "CANCELLED"] } } },
        _count: { _all: true },
      }),
      db.quotation.aggregate({
        where: { organizationId, status: { notIn: ["DRAFT", "SUPERSEDED", "WITHDRAWN"] } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      db.awardRecommendation.count({
        where: { organizationId, status: "PENDING_APPROVAL" },
      }),
      db.rFQEvaluator.count({
        where: {
          userId: ctx.principal.userId,
          completedAt: null,
          rfq: { organizationId, status: { in: ["CLOSED", "UNDER_EVALUATION", "EXPIRED"] } },
        },
      }),
    ]);

  const count = (s: RFQStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const inv = (s: string) => invitations.find((r) => r.status === s)?._count._all ?? 0;

  return {
    rfqs: {
      draft: count("DRAFT"),
      pendingApproval: count("UNDER_REVIEW"),
      approved: count("APPROVED") + count("READY_TO_PUBLISH"),
      published: count("PUBLISHED") + count("RESPONSE_PERIOD"),
      closingSoon,
      closed: count("CLOSED"),
      underEvaluation: count("UNDER_EVALUATION"),
      awarded: count("AWARDED"),
      noAward: count("NO_AWARD"),
      expired: count("EXPIRED"),
      cancelled: count("CANCELLED"),
      total: byStatus.reduce((s, r) => s + r._count._all, 0),
    },
    suppliers: {
      invited: invitations.reduce((s, r) => s + r._count._all, 0),
      viewed: inv("VIEWED") + inv("ACCEPTED") + inv("QUOTED"),
      accepted: inv("ACCEPTED"),
      responded: inv("QUOTED"),
      declined: inv("DECLINED"),
      pending: inv("INVITED") + inv("VIEWED") + inv("ACCEPTED"),
      noResponse: inv("NO_RESPONSE"),
    },
    quotations: {
      received: quotationAgg._count._all,
      // `_sum` on a Decimal column is not covered by the number-casting extension,
      // so it is converted here rather than leaking a Decimal to the client.
      totalValue: quotationAgg._sum.totalAmount ? Number(quotationAgg._sum.totalAmount) : 0,
    },
    awaitingMe: {
      awardApprovals: awardsPending,
      evaluations: myEvaluations,
    },
  };
}

// ---------------------------------------------------------------------------
// Draft authoring
// ---------------------------------------------------------------------------

/**
 * Creates an RFQ as a DRAFT.
 *
 * This is the change that makes the rest of the phase possible. Previously an RFQ
 * came into existence already issued to suppliers, which left nowhere to put
 * approval, no chance to build the line items over more than one sitting, and no
 * way to correct a mistake before the market saw it.
 */
export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "rfqs.create");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime())) throw validation("The response deadline is not a valid date");

  let lineItems = (input.lineItems ?? []).map((li) => ({ ...li, requestLineItemId: li.requestLineItemId }));
  let requestId: string | null = null;
  let categoryId = input.categoryId ?? null;

  if (input.requestId) {
    const request = await tdb.purchaseRequest.findUnique({
      where: { id: input.requestId },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    if (!request) throw validation("The linked purchase request does not exist");
    if (request.status !== "APPROVED" && request.status !== "IN_PROCUREMENT") {
      throw conflict(
        `Sourcing can only start from an approved request — ${request.requestNumber} is ${pretty(request.status)}`
      );
    }
    requestId = request.id;
    categoryId = categoryId ?? request.categoryId;

    // Derived, not copied: each RFQ line keeps a pointer back to the requested
    // line, so a quoted price can be set against what the requester estimated.
    if (lineItems.length === 0) {
      lineItems = request.lineItems.map((li) => ({
        itemName: li.itemName,
        description: li.description ?? "",
        specification: "",
        quantity: li.quantity,
        unit: li.unit,
        notes: "",
        targetPrice: li.estimatedCost,
        requestLineItemId: li.id,
      }));
    }
  }

  const vendors = await assertInvitable(ctx, input.invitedVendorIds);
  const criteria = normaliseCriteria(input.criteria ?? []);
  const evaluators = await resolveEvaluators(ctx, input.evaluators ?? []);

  const rfq = await db.$transaction(async (tx) => {
    const sourcingEventId = await resolveEventForRfq(tx, {
      organizationId,
      userId: ctx.principal.userId,
      sourcingEventId: input.sourcingEventId,
      requestId,
      title: input.title,
      description: input.description || null,
      categoryId,
      currency: input.currency,
      estimatedValue: input.estimatedValue ?? null,
      responseDeadline: deadline,
    });

    const rfqNumber = await nextDocumentNumber(organizationId, PREFIX.rfq, { client: tx });

    return tx.rFQ.create({
      data: {
        organizationId,
        rfqNumber,
        sourcingEventId,
        requestId,
        title: input.title,
        description: input.description || null,
        referenceNumber: input.referenceNumber || null,
        deadline,
        questionDeadline: input.questionDeadline ? new Date(input.questionDeadline) : null,
        requiredDeliveryDate: input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null,
        deliveryTerms: input.deliveryTerms || null,
        deliveryAddress: input.deliveryAddress || null,
        termsAndConditions: input.termsAndConditions || null,
        categoryId,
        currency: input.currency,
        estimatedValue: input.estimatedValue ?? null,
        showTargetPrice: input.showTargetPrice,
        isSealed: input.isSealed,
        allowSupplierRevision: input.allowSupplierRevision,
        evaluationMethod: input.evaluationMethod,
        status: "DRAFT",
        createdById: ctx.principal.userId,
        lineItems: {
          create: lineItems.map((li, i) => ({
            itemName: li.itemName,
            description: li.description || null,
            specification: li.specification || null,
            quantity: li.quantity,
            unit: li.unit ?? "unit",
            requiredDeliveryDate: li.requiredDeliveryDate ? new Date(li.requiredDeliveryDate) : null,
            targetPrice: li.targetPrice ?? null,
            notes: li.notes || null,
            requestLineItemId: li.requestLineItemId ?? null,
            sortOrder: i,
          })),
        },
        criteria: { create: criteria },
        evaluators: {
          create: evaluators.map((e) => ({
            userId: e.userId,
            role: e.role,
            isChair: e.isChair,
            assignedById: ctx.principal.userId,
          })),
        },
        invitedVendors: {
          create: vendors.map((v) => ({
            vendorId: v.id,
            status: "INVITED" as const,
            invitedById: ctx.principal.userId,
          })),
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
    after: {
      rfqNumber: rfq.rfqNumber,
      title: rfq.title,
      sourcingEventId: rfq.sourcingEventId,
      requestId,
      lineItems: lineItems.length,
      invited: vendors.length,
      status: "DRAFT",
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_CREATED",
    description: `${ctx.principal.name} drafted ${rfq.rfqNumber}: '${rfq.title}'`,
    rfqId: rfq.id,
    requestId,
    context: ctx.context,
  });

  return getById(ctx, rfq.id);
}

export async function update(ctx: ServiceContext, id: string, input: UpdateInput) {
  await assertPermission(ctx.principal, "rfqs.create");
  const rfq = await loadRfq(ctx, id);
  assertEditable(rfq);

  // Unchecked, so scalar foreign keys (categoryId) can be set directly rather
  // than through a nested relation connect — this is a flat field update.
  const data: Prisma.RFQUncheckedUpdateInput = {};
  const set = <K extends keyof Prisma.RFQUncheckedUpdateInput>(
    k: K,
    v: Prisma.RFQUncheckedUpdateInput[K]
  ) => {
    data[k] = v;
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description || null);
  if (input.referenceNumber !== undefined) set("referenceNumber", input.referenceNumber || null);
  if (input.deadline !== undefined) set("deadline", new Date(input.deadline));
  if (input.questionDeadline !== undefined) {
    set("questionDeadline", input.questionDeadline ? new Date(input.questionDeadline) : null);
  }
  if (input.requiredDeliveryDate !== undefined) {
    set("requiredDeliveryDate", input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null);
  }
  if (input.deliveryTerms !== undefined) set("deliveryTerms", input.deliveryTerms || null);
  if (input.deliveryAddress !== undefined) set("deliveryAddress", input.deliveryAddress || null);
  if (input.termsAndConditions !== undefined) set("termsAndConditions", input.termsAndConditions || null);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId || null);
  if (input.currency !== undefined) set("currency", input.currency);
  if (input.estimatedValue !== undefined) set("estimatedValue", input.estimatedValue ?? null);
  if (input.showTargetPrice !== undefined) set("showTargetPrice", input.showTargetPrice);
  if (input.isSealed !== undefined) set("isSealed", input.isSealed);
  if (input.allowSupplierRevision !== undefined) set("allowSupplierRevision", input.allowSupplierRevision);
  if (input.evaluationMethod !== undefined) set("evaluationMethod", input.evaluationMethod);

  if (input.lineItems) await replaceLineItems(ctx, id, input.lineItems);
  if (input.criteria) await replaceCriteria(ctx, id, input.criteria);
  if (input.evaluators) await replaceEvaluators(ctx, id, input.evaluators);

  if (Object.keys(data).length > 0) {
    await scoped(ctx).rFQ.update({ where: { id }, data });
  }

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.updated",
    resource: "RFQ",
    resourceId: id,
    before: { title: rfq.title, deadline: rfq.deadline, evaluationMethod: rfq.evaluationMethod },
    after: { ...data },
    context: ctx.context,
  });

  return getById(ctx, id);
}

async function replaceLineItems(
  ctx: ServiceContext,
  rfqId: string,
  lines: z.infer<typeof rfqLineItemsSchema>["lineItems"]
) {
  await db.$transaction(async (tx) => {
    // Lines a supplier may already have quoted against are not deleted blindly:
    // `onDelete: SetNull` on QuotationLineItem.rfqLineItemId means a removed line
    // orphans the bid against it rather than destroying the bid. Editing is only
    // reachable before publication, so in practice there is nothing to orphan.
    await tx.rFQLineItem.deleteMany({ where: { rfqId } });
    await tx.rFQLineItem.createMany({
      data: lines.map((li, i) => ({
        rfqId,
        itemName: li.itemName,
        description: li.description || null,
        specification: li.specification || null,
        quantity: li.quantity,
        unit: li.unit ?? "unit",
        requiredDeliveryDate: li.requiredDeliveryDate ? new Date(li.requiredDeliveryDate) : null,
        targetPrice: li.targetPrice ?? null,
        notes: li.notes || null,
        requestLineItemId: li.requestLineItemId ?? null,
        sortOrder: i,
      })),
    });
  });
}

export async function setLineItems(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof rfqLineItemsSchema>
) {
  await assertPermission(ctx.principal, "rfqs.create");
  const rfq = await loadRfq(ctx, id);
  assertEditable(rfq);
  await replaceLineItems(ctx, id, input.lineItems);

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.line_items_set",
    resource: "RFQ",
    resourceId: id,
    before: { lineItems: rfq.lineItems.length },
    after: { lineItems: input.lineItems.length },
    context: ctx.context,
  });

  return getById(ctx, id);
}

/**
 * Normalises the criterion set.
 *
 * Weights arriving as zero across the board — the common case when a buyer picks
 * criteria without thinking about proportions — are spread evenly rather than
 * rejected, so the RFQ is publishable by default and the buyer tunes from there.
 */
function normaliseCriteria(criteria: z.infer<typeof rfqCriteriaSchema>["criteria"]) {
  if (criteria.length === 0) return [];

  const total = criteria.reduce((s, c) => s + c.weight, 0);
  const even = Math.round((100 / criteria.length) * 100) / 100;

  return criteria.map((c, i) => ({
    name: c.name,
    description: c.description || null,
    type: c.type,
    weight: total > 0 ? c.weight : even,
    // Price-like criteria invert by nature; a buyer should not have to remember
    // to tick the box, and getting it wrong silently rewards the most expensive bid.
    lowerIsBetter: c.type === "PRICE" || c.type === "DELIVERY" || c.type === "RISK" ? true : c.lowerIsBetter,
    maxScore: c.maxScore,
    isAutomatic: c.isAutomatic,
    sortOrder: i,
  }));
}

async function replaceCriteria(
  ctx: ServiceContext,
  rfqId: string,
  criteria: z.infer<typeof rfqCriteriaSchema>["criteria"]
) {
  const names = criteria.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw validation("Evaluation criteria must have distinct names");
  }

  await db.$transaction(async (tx) => {
    // Scores cascade from the criterion. That is correct — a score against a
    // criterion that no longer exists is not evidence — and it is why criteria
    // cannot be edited once bids are being evaluated.
    await tx.rFQEvaluationCriterion.deleteMany({ where: { rfqId } });
    const rows = normaliseCriteria(criteria);
    if (rows.length > 0) {
      await tx.rFQEvaluationCriterion.createMany({ data: rows.map((r) => ({ ...r, rfqId })) });
    }
  });
}

export async function setCriteria(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof rfqCriteriaSchema>
) {
  await assertPermission(ctx.principal, "rfqs.manageEvaluation");
  const rfq = await loadRfq(ctx, id);

  // The yardstick may not change once it has been used. §27 puts criteria before
  // the bids arrive precisely so nobody can re-weight after seeing the numbers.
  const scored = await db.quotationScore.count({ where: { quotation: { rfqId: id } } });
  if (scored > 0) {
    throw conflict(
      "Evaluation has begun on this RFQ. Criteria cannot be changed once bids have been scored against them."
    );
  }
  if (!EDITABLE_STATUSES.includes(rfq.status) && rfq.status !== "CLOSED") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)}; its criteria are fixed`);
  }

  await replaceCriteria(ctx, id, input.criteria);

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.criteria_set",
    resource: "RFQ",
    resourceId: id,
    before: { criteria: rfq.criteria.map((c) => ({ name: c.name, weight: c.weight })) },
    after: { criteria: input.criteria.map((c) => ({ name: c.name, weight: c.weight })) },
    context: ctx.context,
  });

  return getById(ctx, id);
}

async function resolveEvaluators(
  ctx: ServiceContext,
  evaluators: z.infer<typeof rfqEvaluatorsSchema>["evaluators"]
) {
  if (evaluators.length === 0) return [];

  const ids = [...new Set(evaluators.map((e) => e.userId))];
  const users = await scoped(ctx).user.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    throw validation("One or more nominated evaluators is not an active member of this organization");
  }

  const chairs = evaluators.filter((e) => e.isChair);
  if (chairs.length > 1) throw validation("An evaluation panel has one chair");

  return evaluators;
}

async function replaceEvaluators(
  ctx: ServiceContext,
  rfqId: string,
  evaluators: z.infer<typeof rfqEvaluatorsSchema>["evaluators"]
) {
  const resolved = await resolveEvaluators(ctx, evaluators);

  await db.$transaction(async (tx) => {
    const existing = await tx.rFQEvaluator.findMany({ where: { rfqId }, include: { scores: true } });
    const keep = new Set(resolved.map((e) => e.userId));

    // An evaluator who has already scored is not removed. Their judgement is part
    // of the record the award rests on, and deleting the seat would cascade the
    // scores away with it — Rule 9 and §28 both forbid that.
    const removable = existing.filter((e) => !keep.has(e.userId) && e.scores.length === 0);
    if (removable.length > 0) {
      await tx.rFQEvaluator.deleteMany({ where: { id: { in: removable.map((e) => e.id) } } });
    }

    for (const e of resolved) {
      const current = existing.find((x) => x.userId === e.userId);
      if (current) {
        await tx.rFQEvaluator.update({
          where: { id: current.id },
          data: { role: e.role, isChair: e.isChair },
        });
      } else {
        await tx.rFQEvaluator.create({
          data: { rfqId, userId: e.userId, role: e.role, isChair: e.isChair },
        });
      }
    }
  });
}

export async function setEvaluators(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof rfqEvaluatorsSchema>
) {
  await assertPermission(ctx.principal, "rfqs.manageEvaluation");
  const rfq = await loadRfq(ctx, id);
  if (rfq.status === "AWARDED" || rfq.status === "CANCELLED" || rfq.status === "NO_AWARD") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)}; the panel is fixed`);
  }

  await replaceEvaluators(ctx, id, input.evaluators);

  const assigned = await scoped(ctx).rFQEvaluator.findMany({
    where: { rfqId: id },
    select: { userId: true },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.evaluators_set",
    resource: "RFQ",
    resourceId: id,
    before: { evaluators: rfq.evaluators.map((e) => e.userId) },
    after: { evaluators: assigned.map((e) => e.userId) },
    context: ctx.context,
  });

  // Only the newly appointed are told; re-saving a panel must not re-notify it.
  const added = assigned
    .map((a) => a.userId)
    .filter((uid) => !rfq.evaluators.some((e) => e.userId === uid));
  if (added.length > 0) {
    await emit({
      type: "rfq.evaluation_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: added,
      title: `You are on the evaluation panel for ${rfq.rfqNumber}`,
      message: `${ctx.principal.name} appointed you to evaluate bids for "${rfq.title}".`,
      severity: "info",
      link: "rfqs",
      entityType: "RFQ",
      entityId: id,
    });
  }

  return getById(ctx, id);
}

// ---------------------------------------------------------------------------
// Supplier selection and invitation
// ---------------------------------------------------------------------------

/**
 * Suppliers this organization may invite, with the filters §8 asks for.
 *
 * The eligibility rule is applied in the query, not offered as a filter the
 * caller can switch off: a barred supplier must not be selectable at all, and a
 * "show everyone" toggle is exactly how one ends up on a tender.
 */
export async function eligibleSuppliers(
  ctx: ServiceContext,
  q: z.infer<typeof eligibleSupplierQuerySchema>
) {
  await assertPermission(ctx.principal, "rfqs.create");
  const tdb = scoped(ctx);

  const where: Prisma.VendorWhereInput = {
    status: { in: INVITABLE_VENDOR_STATUSES },
  };
  if (q.search) {
    where.OR = [
      { companyName: { contains: q.search, mode: "insensitive" } },
      { code: { contains: q.search, mode: "insensitive" } },
      { email: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.categoryId) where.categoryLinks = { some: { categoryId: q.categoryId } };
  if (q.country) where.country = { equals: q.country, mode: "insensitive" };
  if (q.compliantOnly) where.complianceState = { in: ["COMPLIANT"] };
  if (q.maxRisk) {
    const allowed = RISK_ORDER.slice(0, RISK_ORDER.indexOf(q.maxRisk) + 1);
    where.riskLevel = { in: allowed as unknown as Prisma.EnumVendorRiskLevelFilter["in"] };
  }
  if (q.existingOnly) where.totalOrders = { gt: 0 };

  const vendors = await tdb.vendor.findMany({
    where,
    take: q.limit,
    orderBy: [{ rating: "desc" }, { companyName: "asc" }],
    select: {
      id: true,
      code: true,
      companyName: true,
      email: true,
      phone: true,
      country: true,
      city: true,
      status: true,
      complianceState: true,
      riskLevel: true,
      rating: true,
      qualityRating: true,
      onTimeDeliveryRate: true,
      totalOrders: true,
      totalValue: true,
      preferredCurrency: true,
      categoryLinks: { select: { category: { select: { id: true, name: true } } } },
      // Whether the supplier can actually be reached: an invitation to a company
      // with no portal login is a notification nobody will ever read.
      portalUsers: { where: { accessStatus: "ACTIVE" }, select: { id: true } },
    },
  });

  return vendors.map((v) => ({
    ...v,
    categories: v.categoryLinks.map((l) => l.category),
    hasPortalAccess: v.portalUsers.length > 0,
    categoryLinks: undefined,
    portalUsers: undefined,
  }));
}

/** Loads vendors and refuses any that must not be invited. Rule 5. */
async function assertInvitable(ctx: ServiceContext, vendorIds: string[]) {
  const unique = [...new Set(vendorIds)];
  if (unique.length === 0) return [];

  const vendors = await scoped(ctx).vendor.findMany({
    where: { id: { in: unique } },
    select: { id: true, companyName: true, status: true },
  });

  if (vendors.length !== unique.length) {
    throw validation("One or more selected suppliers do not exist in this organization");
  }

  const barred = vendors.filter((v) => !INVITABLE_VENDOR_STATUSES.includes(v.status));
  if (barred.length > 0) {
    throw validation(
      `Cannot invite ${barred.map((v) => `${v.companyName} (${pretty(v.status)})`).join(", ")} — only approved or active suppliers may be invited to source`,
      { vendorIds: barred.map((v) => v.id) }
    );
  }

  return vendors;
}

export async function inviteSuppliers(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof inviteSuppliersSchema>
) {
  await assertPermission(ctx.principal, "rfqs.create");
  const rfq = await loadRfq(ctx, id);

  if (rfq.status === "CANCELLED" || rfq.status === "AWARDED" || rfq.status === "NO_AWARD") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and is not taking new suppliers`);
  }
  if (rfq.deadline.getTime() <= Date.now() && OPEN_STATUSES.includes(rfq.status)) {
    throw conflict("The response deadline has passed — extend it before inviting more suppliers");
  }

  const vendors = await assertInvitable(ctx, input.vendorIds);
  const already = new Set(rfq.invitedVendors.map((iv) => iv.vendorId));
  const fresh = vendors.filter((v) => !already.has(v.id));
  if (fresh.length === 0) {
    throw conflict("Every selected supplier is already invited to this RFQ");
  }

  await db.rFQVendor.createMany({
    data: fresh.map((v) => ({
      rfqId: id,
      vendorId: v.id,
      status: "INVITED" as const,
      invitedById: ctx.principal.userId,
    })),
    skipDuplicates: true,
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.suppliers_invited",
    resource: "RFQ",
    resourceId: id,
    after: { vendors: fresh.map((v) => v.companyName) },
    context: ctx.context,
  });

  // A draft RFQ's invitation list is a plan, not an invitation. Suppliers are only
  // told once it is published — which is what makes publication meaningful.
  if (OPEN_STATUSES.includes(rfq.status)) {
    for (const vendor of fresh) {
      await notifySupplierOfInvitation(ctx.principal.organizationId, ctx.principal.userId, rfq, vendor.id);
    }
  }

  return getById(ctx, id);
}

export async function removeInvitation(ctx: ServiceContext, id: string, vendorId: string) {
  await assertPermission(ctx.principal, "rfqs.create");
  const rfq = await loadRfq(ctx, id);
  assertEditable(rfq);

  const invitation = rfq.invitedVendors.find((iv) => iv.vendorId === vendorId);
  if (!invitation) throw notFound("That supplier is not invited to this RFQ");

  await db.rFQVendor.delete({ where: { id: invitation.id } });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.supplier_removed",
    resource: "RFQ",
    resourceId: id,
    before: { vendor: invitation.vendor.companyName },
    context: ctx.context,
  });

  return getById(ctx, id);
}

async function notifySupplierOfInvitation(
  organizationId: string,
  actorId: string | null,
  rfq: { id: string; rfqNumber: string; title: string; deadline: Date },
  vendorId: string
) {
  // The supplier's activity row is written by the event bus, not here: `emit`
  // maps rfq.invited onto RFQ_RECEIVED. Writing one here as well produced two
  // feed entries per invitation, which the verification suite caught.
  await emit({
    type: "rfq.invited",
    organizationId,
    vendorId,
    actorId,
    title: `RFQ invitation — ${rfq.rfqNumber}`,
    message: `You have been invited to quote on "${rfq.title}". Responses close ${rfq.deadline.toDateString()}.`,
    severity: "info",
    entityType: "RFQ",
    entityId: rfq.id,
  });
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * Puts a draft RFQ in front of its approvers, or approves it outright where the
 * organization has configured no RFQ workflow.
 *
 * The second branch is not a loophole. §7 is conditional — "if the organization
 * requires approval" — and an organization that has deliberately not configured
 * one should not have its sourcing deadlocked. What matters is that the absence
 * is recorded: the audit row says the RFQ was approved with no workflow in force,
 * so nobody can later mistake it for a decision somebody took.
 */
export async function submitForApproval(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.create");
  const rfq = await loadRfq(ctx, id);

  if (rfq.status !== "DRAFT") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and is not a draft awaiting review`);
  }

  const problems = publishReadiness(rfq);
  if (problems.length > 0) {
    throw validation("This RFQ is not ready to go for review", { issues: problems });
  }

  const facts: workflow.RequestFacts = {
    organizationId: ctx.principal.organizationId,
    amount: rfq.estimatedValue ?? 0,
    priority: "MEDIUM",
    departmentId: null,
    category: rfq.categoryRef?.name ?? null,
  };

  const selected = await workflow.selectWorkflow(facts, "RFQ");

  if (!selected) {
    const now = new Date();
    await scoped(ctx).rFQ.update({
      where: { id },
      data: {
        status: transition("rfq", rfq.status, "READY_TO_PUBLISH"),
        submittedForApprovalAt: now,
        approvedAt: now,
        approvedById: ctx.principal.userId,
      },
    });
    await recordAudit({
      organizationId: ctx.principal.organizationId,
      userId: ctx.principal.userId,
      action: "rfq.approved",
      resource: "RFQ",
      resourceId: id,
      before: { status: rfq.status },
      after: {
        status: "READY_TO_PUBLISH",
        workflow: null,
        note: "No RFQ approval workflow is configured for this organization",
      },
      context: ctx.context,
    });
    return getById(ctx, id);
  }

  // The buyer who raised the RFQ cannot be its approver.
  const chain = await workflow.buildChain(selected, facts, rfq.createdById ?? ctx.principal.userId);
  if (chain.length === 0) {
    throw conflict(`Workflow "${selected.name}" produced no applicable approval stages`);
  }

  const now = new Date();
  const firstSequence = Math.min(...chain.map((c) => c.sequence));

  await db.$transaction(async (tx) => {
    // A resubmission supersedes the previous attempt; the old instance stays as
    // history so a rejection and the revision that followed both survive.
    await tx.approvalInstance.updateMany({
      where: { entityType: "RFQ", entityId: id, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: now, outcomeReason: "Superseded by resubmission" },
    });

    const instance = await tx.approvalInstance.create({
      data: {
        organizationId: ctx.principal.organizationId,
        workflowId: selected.id,
        entityType: "RFQ",
        entityId: id,
        status: "IN_PROGRESS",
        amount: rfq.estimatedValue ?? null,
        currency: rfq.currency,
        context: {
          rfqNumber: rfq.rfqNumber,
          title: rfq.title,
          deadline: rfq.deadline.toISOString(),
          invitedSuppliers: rfq.invitedVendors.length,
          lineItems: rfq.lineItems.length,
          workflowVersion: selected.version,
        },
      },
    });

    await tx.approvalStep.createMany({
      data: chain.map((s) => ({
        instanceId: instance.id,
        stageId: s.stageId,
        stage: s.stage,
        sequence: s.sequence,
        approverId: s.approverId,
        approverRole: s.approverRole,
        approverRoleId: s.approverRoleId,
        decision: "PENDING" as const,
        slaHours: s.slaHours,
        slaExpiresAt: s.slaExpiresAt,
      })),
    });

    await tx.rFQ.update({
      where: { id },
      data: {
        status: transition("rfq", rfq.status, "UNDER_REVIEW"),
        submittedForApprovalAt: now,
      },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.submitted_for_approval",
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: { status: "UNDER_REVIEW", workflow: selected.name, stages: chain.length },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_SUBMITTED",
    description: `${ctx.principal.name} submitted ${rfq.rfqNumber} for approval`,
    rfqId: id,
    context: ctx.context,
  });

  await emit({
    type: "rfq.approval_required",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: chain.filter((c) => c.sequence === firstSequence).map((c) => c.approverId),
    title: `Approve ${rfq.rfqNumber} for publication`,
    message: `${ctx.principal.name} needs approval to publish "${rfq.title}" to ${rfq.invitedVendors.length} supplier(s).`,
    severity: "approval",
    link: "rfqs",
    entityType: "RFQ",
    entityId: id,
  });

  return getById(ctx, id);
}

export async function decideApproval(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof rfqDecisionSchema>
) {
  await assertPermission(ctx.principal, "rfqs.approve");
  const tdb = scoped(ctx);
  const rfq = await loadRfq(ctx, id);

  if (rfq.status !== "UNDER_REVIEW") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and is not awaiting approval`);
  }

  const instance = await tdb.approvalInstance.findFirst({
    where: { entityType: "RFQ", entityId: id, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!instance) throw conflict("There is no approval in progress for this RFQ");

  workflow.assertCanDecide(instance.steps, input.stepId, ctx.principal.userId);

  if (input.decision === "REJECTED" && !input.comment.trim()) {
    throw validation("Rejecting an RFQ requires a reason", {
      issues: [{ path: "comment", message: "Say what has to change before this can go out" }],
    });
  }

  const now = new Date();
  const readiness = publishReadiness(rfq);

  const result = await db.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: input.stepId },
      data: {
        decision: input.decision,
        comment: input.comment || null,
        rejectionReason: input.decision === "REJECTED" ? input.comment : null,
        decidedAt: now,
        decidedById: ctx.principal.userId,
      },
    });

    const steps = await tx.approvalStep.findMany({
      where: { instanceId: instance.id },
      orderBy: { sequence: "asc" },
    });
    const state = workflow.chainState(steps);

    // Approval that clears the chain lands in READY_TO_PUBLISH when the document
    // is complete and APPROVED when it is not: the decision has been taken either
    // way, but readiness is a fact about the RFQ, not a thing an approver asserts.
    const target: RFQStatus =
      input.decision === "REJECTED"
        ? "DRAFT"
        : state.isComplete
          ? readiness.length === 0
            ? "READY_TO_PUBLISH"
            : "APPROVED"
          : "UNDER_REVIEW";

    if (input.decision === "REJECTED" || state.isComplete) {
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          status: input.decision === "REJECTED" ? "REJECTED" : "APPROVED",
          completedAt: now,
          decidedById: ctx.principal.userId,
          outcomeReason: input.comment || null,
        },
      });
      if (input.decision === "REJECTED") {
        await tx.approvalStep.deleteMany({ where: { instanceId: instance.id, decision: "PENDING" } });
      }
    }

    if (target !== rfq.status) {
      await tx.rFQ.update({
        where: { id },
        data: {
          status: transition("rfq", rfq.status, target),
          ...(input.decision === "APPROVED" && state.isComplete
            ? { approvedAt: now, approvedById: ctx.principal.userId }
            : {}),
        },
      });
    }

    return { state, target };
  });

  const verb = input.decision === "APPROVED" ? "approved" : "rejected";

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: `rfq.${verb}`,
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: { status: result.target, stepId: input.stepId, comment: input.comment },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: input.decision === "APPROVED" ? "RFQ_APPROVED" : "RFQ_REJECTED",
    description: `${ctx.principal.name} ${verb} ${rfq.rfqNumber}${input.comment ? ` — "${input.comment}"` : ""}`,
    severity: input.decision === "APPROVED" ? "SUCCESS" : "WARNING",
    rfqId: id,
    context: ctx.context,
  });

  if (result.state.isComplete || input.decision === "REJECTED") {
    await emit({
      type: input.decision === "APPROVED" ? "rfq.approved" : "rfq.rejected",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: rfq.createdById ? [rfq.createdById] : [],
      title: `${rfq.rfqNumber} ${verb}`,
      message:
        input.decision === "APPROVED"
          ? `${ctx.principal.name} approved ${rfq.rfqNumber}. It can now be published to suppliers.`
          : `${ctx.principal.name} sent ${rfq.rfqNumber} back — ${input.comment}`,
      severity: input.decision === "APPROVED" ? "success" : "warning",
      link: "rfqs",
      entityType: "RFQ",
      entityId: id,
    });
  } else {
    await emit({
      type: "rfq.approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: result.state.activeSteps.map((s) => s.delegatedToId ?? s.approverId),
      title: `Approve ${rfq.rfqNumber} for publication`,
      message: `${rfq.rfqNumber} has cleared the previous stage and is waiting on you.`,
      severity: "approval",
      link: "rfqs",
      entityType: "RFQ",
      entityId: id,
    });
  }

  return getById(ctx, id);
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Publishes an RFQ to its invited suppliers — §10, and the single most important
 * transaction in this phase.
 *
 * Everything that constitutes "the market has been engaged" commits together:
 * validation passes, the status moves, invitations are stamped as sent, the
 * sourcing event goes ACTIVE. The notifications are fired *after* the commit, on
 * purpose — an outbound message that cannot be unsent must never be produced by a
 * transaction that might still roll back.
 */
export async function publish(ctx: ServiceContext, id: string, note?: string) {
  await assertPermission(ctx.principal, "rfqs.issue");
  const rfq = await loadRfq(ctx, id);

  if (rfq.status === "PUBLISHED" || rfq.status === "RESPONSE_PERIOD") {
    throw conflict(`${rfq.rfqNumber} is already published`);
  }
  if (!nextStates("rfq", rfq.status).includes("PUBLISHED")) {
    throw conflict(
      rfq.status === "DRAFT" || rfq.status === "UNDER_REVIEW"
        ? `${rfq.rfqNumber} has not been approved for publication yet`
        : `${rfq.rfqNumber} is ${pretty(rfq.status)} and cannot be published`
    );
  }

  const problems = publishReadiness(rfq);
  if (problems.length > 0) {
    throw validation("This RFQ cannot be published yet", { issues: problems });
  }

  // Re-checked at the moment of publication rather than trusted from invitation
  // time: a supplier may have been suspended in the days between being selected
  // and the RFQ going out.
  const eligible = rfq.invitedVendors.filter((iv) =>
    INVITABLE_VENDOR_STATUSES.includes(iv.vendor.status)
  );
  const barred = rfq.invitedVendors.filter(
    (iv) => !INVITABLE_VENDOR_STATUSES.includes(iv.vendor.status)
  );

  const now = new Date();

  await db.$transaction(async (tx) => {
    // A supplier who became ineligible is dropped from the invitation list rather
    // than silently left on it — otherwise the response monitor counts them as
    // pending forever.
    if (barred.length > 0) {
      await tx.rFQVendor.deleteMany({ where: { id: { in: barred.map((b) => b.id) } } });
    }

    await tx.rFQVendor.updateMany({
      where: { id: { in: eligible.map((e) => e.id) }, status: "INVITED" },
      data: { invitedAt: now, invitedById: ctx.principal.userId },
    });

    await tx.rFQ.update({
      where: { id },
      data: {
        status: transition("rfq", rfq.status, "PUBLISHED"),
        publishedAt: now,
        publishedById: ctx.principal.userId,
      },
    });

    await syncEventStatus(tx, rfq.sourcingEventId, "ACTIVE", { publishedAt: now });
    await tx.sourcingEvent.updateMany({
      where: { id: rfq.sourcingEventId ?? "" },
      data: { responseDeadline: rfq.deadline },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.published",
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: {
      status: "PUBLISHED",
      publishedAt: now.toISOString(),
      suppliers: eligible.map((e) => e.vendor.companyName),
      droppedIneligible: barred.map((b) => b.vendor.companyName),
      note: note ?? null,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_PUBLISHED",
    description: `${ctx.principal.name} published ${rfq.rfqNumber} to ${eligible.length} supplier(s)`,
    severity: "SUCCESS",
    rfqId: id,
    context: ctx.context,
  });

  for (const iv of eligible) {
    await notifySupplierOfInvitation(ctx.principal.organizationId, ctx.principal.userId, rfq, iv.vendorId);
  }

  return getById(ctx, id);
}

export async function sendReminder(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.issue");
  const rfq = await loadRfq(ctx, id);

  if (!OPEN_STATUSES.includes(rfq.status)) {
    throw conflict("Reminders can only be sent while an RFQ is open for responses");
  }

  const pending = rfq.invitedVendors.filter(
    (iv) => iv.status === "INVITED" || iv.status === "VIEWED" || iv.status === "ACCEPTED"
  );
  if (pending.length === 0) throw conflict("Every invited supplier has already responded");

  await scoped(ctx).rFQ.update({ where: { id }, data: { remindersSent: { increment: 1 } } });

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
    eventType: "RFQ_REMINDER_SENT",
    description: `${ctx.principal.name} reminded ${pending.length} supplier(s) about ${rfq.rfqNumber}`,
    rfqId: id,
    context: ctx.context,
  });

  return getById(ctx, id);
}

/**
 * Lets one supplier replace a quotation they have already submitted — the
 * "authorized revision mechanism" Rule 4 requires.
 *
 * Recorded on the invitation, with a reason, because an unexplained re-quote
 * after bids are open is indistinguishable from letting one supplier see the
 * others' prices and try again.
 */
export async function allowRevision(
  ctx: ServiceContext,
  id: string,
  input: z.infer<typeof allowRevisionSchema>
) {
  await assertPermission(ctx.principal, "rfqs.issue");
  const rfq = await loadRfq(ctx, id);

  if (rfq.status === "AWARDED" || rfq.status === "CANCELLED" || rfq.status === "NO_AWARD") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)}; no further quotations can be taken`);
  }

  const invitation = rfq.invitedVendors.find((iv) => iv.vendorId === input.vendorId);
  if (!invitation) throw notFound("That supplier is not invited to this RFQ");
  if (invitation.status !== "QUOTED") {
    throw conflict("That supplier has not submitted a quotation to revise");
  }

  const now = new Date();
  await db.rFQVendor.update({
    where: { id: invitation.id },
    data: {
      revisionAllowedAt: now,
      revisionAllowedById: ctx.principal.userId,
      revisionReason: input.reason,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.revision_invited",
    resource: "RFQ",
    resourceId: id,
    after: { vendor: invitation.vendor.companyName, reason: input.reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "QUOTATION_REVISION_INVITED",
    description: `${ctx.principal.name} invited ${invitation.vendor.companyName} to revise their quotation for ${rfq.rfqNumber} — ${input.reason}`,
    severity: "WARNING",
    rfqId: id,
    vendorId: input.vendorId,
    context: ctx.context,
  });

  await emit({
    type: "rfq.revision_requested",
    organizationId: ctx.principal.organizationId,
    vendorId: input.vendorId,
    actorId: ctx.principal.userId,
    title: `Revision invited — ${rfq.rfqNumber}`,
    message: `${ctx.principal.name} has asked you to revise your quotation: ${input.reason}`,
    severity: "warning",
    entityType: "RFQ",
    entityId: id,
  });

  return getById(ctx, id);
}

// ---------------------------------------------------------------------------
// Closing, cancelling, expiry
// ---------------------------------------------------------------------------

/**
 * Closes the response period.
 *
 * Suppliers who never answered are marked NO_RESPONSE here rather than left as
 * INVITED, so the response monitor stops counting them as outstanding and the
 * record says plainly what happened.
 */
export async function close(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "rfqs.issue");
  const rfq = await loadRfq(ctx, id);

  if (!nextStates("rfq", rfq.status).includes("CLOSED")) {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and cannot be closed`);
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.rFQVendor.updateMany({
      where: { rfqId: id, status: { in: ["INVITED", "VIEWED", "ACCEPTED"] } },
      data: { status: "NO_RESPONSE" },
    });

    // A draft the supplier never submitted is not a bid. Withdrawn at close so it
    // cannot be submitted later against a closed RFQ, and so the supplier can see
    // what became of it.
    await tx.quotation.updateMany({
      where: { rfqId: id, status: "DRAFT" },
      data: { status: "WITHDRAWN", withdrawnAt: now, withdrawnReason: "RFQ closed before submission" },
    });

    await tx.rFQ.update({
      where: { id },
      data: {
        status: transition("rfq", rfq.status, "CLOSED"),
        closedAt: now,
        closedById: ctx.principal.userId,
      },
    });

    await syncEventStatus(tx, rfq.sourcingEventId, "EVALUATION");
  });

  const responses = await db.quotation.count({
    where: { rfqId: id, status: { notIn: ["DRAFT", "SUPERSEDED", "WITHDRAWN"] } },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.closed",
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: { status: "CLOSED", responses, reason: reason || null },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_CLOSED",
    description: `${ctx.principal.name} closed ${rfq.rfqNumber} with ${responses} quotation(s) received`,
    rfqId: id,
    context: ctx.context,
  });

  const evaluators = rfq.evaluators.map((e) => e.userId);
  if (evaluators.length > 0 && responses > 0) {
    await emit({
      type: "rfq.evaluation_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: evaluators,
      title: `Evaluation open — ${rfq.rfqNumber}`,
      message: `${rfq.rfqNumber} closed with ${responses} quotation(s). Your scores are needed.`,
      severity: "approval",
      link: "rfqs",
      entityType: "RFQ",
      entityId: id,
    });
  }

  for (const iv of rfq.invitedVendors) {
    await emit({
      type: "rfq.closed",
      organizationId: ctx.principal.organizationId,
      vendorId: iv.vendorId,
      actorId: ctx.principal.userId,
      title: `${rfq.rfqNumber} is closed`,
      message: `The response period for "${rfq.title}" has ended. You will be told the outcome.`,
      severity: "info",
      entityType: "RFQ",
      entityId: id,
    });
  }

  return getById(ctx, id);
}

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "rfqs.cancel");
  const rfq = await loadRfq(ctx, id);

  if (rfq.status === "AWARDED") {
    throw conflict("This RFQ has been awarded and cannot be cancelled");
  }
  if (rfq.purchaseOrders.length > 0) {
    throw conflict("This RFQ cannot be cancelled — a purchase order has already been raised from it");
  }
  if (!nextStates("rfq", rfq.status).includes("CANCELLED")) {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and cannot be cancelled`);
  }
  if (!reason.trim()) {
    throw validation("Cancelling an RFQ requires a reason", {
      issues: [{ path: "reason", message: "Say why this sourcing round is being stopped" }],
    });
  }

  const now = new Date();
  const wasLive = OPEN_STATUSES.includes(rfq.status);

  await db.$transaction(async (tx) => {
    await tx.rFQ.update({
      where: { id },
      data: {
        status: transition("rfq", rfq.status, "CANCELLED"),
        cancelledAt: now,
        cancelReason: reason,
      },
    });
    // Bids are not deleted (§34/§35: the history is evidence). They are marked
    // rejected so they cannot be awarded from, and so the supplier sees an
    // outcome rather than a bid that hangs unanswered forever.
    await tx.quotation.updateMany({
      where: { rfqId: id, status: { notIn: ["SELECTED", "WITHDRAWN", "SUPERSEDED"] } },
      data: { status: "REJECTED" },
    });
  });

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

  if (wasLive) {
    for (const iv of rfq.invitedVendors) {
      await emit({
        type: "rfq.cancelled",
        organizationId: ctx.principal.organizationId,
        vendorId: iv.vendorId,
        actorId: ctx.principal.userId,
        title: `${rfq.rfqNumber} has been cancelled`,
        message: `"${rfq.title}" will not proceed — ${reason}`,
        severity: "warning",
        entityType: "RFQ",
        entityId: id,
      });
    }
  }

  return getById(ctx, id);
}

/**
 * Closes an RFQ with no award — §35. Distinct from cancellation: the round ran,
 * the bids are on record, and the organization decided none of them would do.
 */
export async function noAward(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "rfqs.selectQuotation");
  const rfq = await loadRfq(ctx, id);

  if (!nextStates("rfq", rfq.status).includes("NO_AWARD")) {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)} and cannot be closed without award`);
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.rFQ.update({
      where: { id },
      data: { status: transition("rfq", rfq.status, "NO_AWARD"), closedAt: rfq.closedAt ?? now },
    });
    await tx.quotation.updateMany({
      where: { rfqId: id, status: { notIn: ["WITHDRAWN", "SUPERSEDED"] } },
      data: { status: "REJECTED" },
    });
    await tx.awardRecommendation.updateMany({
      where: { rfqId: id, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      data: { status: "WITHDRAWN", decidedAt: now, decisionReason: reason },
    });
    await syncEventStatus(tx, rfq.sourcingEventId, "CLOSED", { closedAt: now });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.no_award",
    resource: "RFQ",
    resourceId: id,
    before: { status: rfq.status },
    after: { status: "NO_AWARD", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_NO_AWARD",
    description: `${ctx.principal.name} closed ${rfq.rfqNumber} without an award — ${reason}`,
    severity: "WARNING",
    rfqId: id,
    context: ctx.context,
  });

  for (const iv of rfq.invitedVendors) {
    await emit({
      type: "rfq.result",
      organizationId: ctx.principal.organizationId,
      vendorId: iv.vendorId,
      actorId: ctx.principal.userId,
      title: `${rfq.rfqNumber} — no award`,
      message: `"${rfq.title}" has closed without an award being made. Thank you for taking part.`,
      severity: "info",
      entityType: "RFQ",
      entityId: id,
    });
  }

  return getById(ctx, id);
}

/**
 * Moves RFQs past their deadline out of the response period. Safe to run
 * repeatedly, and called on every buyer read of the RFQ collection so the state
 * is right even where no scheduler is running.
 */
export async function expireOverdue(organizationId: string): Promise<number> {
  const now = new Date();
  const overdue = await db.rFQ.findMany({
    where: { organizationId, status: { in: OPEN_STATUSES }, deadline: { lt: now } },
    select: { id: true, sourcingEventId: true },
  });
  if (overdue.length === 0) return 0;

  await db.$transaction(async (tx) => {
    await tx.rFQ.updateMany({
      where: { id: { in: overdue.map((r) => r.id) } },
      data: { status: "EXPIRED" },
    });
    await tx.rFQVendor.updateMany({
      where: { rfqId: { in: overdue.map((r) => r.id) }, status: { in: ["INVITED", "VIEWED", "ACCEPTED"] } },
      data: { status: "NO_RESPONSE" },
    });
    await tx.quotation.updateMany({
      where: { rfqId: { in: overdue.map((r) => r.id) }, status: "DRAFT" },
      data: { status: "WITHDRAWN", withdrawnAt: now, withdrawnReason: "Deadline passed before submission" },
    });
  });

  return overdue.length;
}

// ---------------------------------------------------------------------------
// Clarifications (§19)
// ---------------------------------------------------------------------------

/**
 * The clarification thread as the buyer sees it: every question, from every
 * supplier, with the asker named. The supplier-facing view is a different, much
 * narrower query — see supplier-service.
 */
export async function listClarifications(ctx: ServiceContext, rfqId: string) {
  return scoped(ctx).rFQClarification.findMany({
    where: { rfqId },
    include: {
      vendor: { select: { id: true, companyName: true } },
      askedBySupplierUser: { select: { id: true, contactName: true } },
      askedByUser: { select: { id: true, name: true } },
      answeredBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function answerClarification(
  ctx: ServiceContext,
  rfqId: string,
  clarificationId: string,
  input: z.infer<typeof answerClarificationSchema>
) {
  await assertPermission(ctx.principal, "rfqs.clarify");
  const tdb = scoped(ctx);

  const clarification = await tdb.rFQClarification.findFirst({
    where: { id: clarificationId, rfqId },
    include: { rfq: { select: { id: true, rfqNumber: true, title: true } } },
  });
  if (!clarification) throw notFound("Clarification not found on this RFQ");

  const now = new Date();
  await tdb.rFQClarification.update({
    where: { id: clarificationId },
    data: {
      answer: input.answer,
      visibility: input.visibility,
      status: "ANSWERED",
      answeredById: ctx.principal.userId,
      answeredAt: now,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.clarification_answered",
    resource: "RFQClarification",
    resourceId: clarificationId,
    after: { rfqId, visibility: input.visibility, answer: input.answer },
    context: ctx.context,
  });

  // A private answer goes to the supplier who asked. A published one is a change
  // to the terms every bidder is quoting against, so every invited supplier is
  // told — otherwise the answer advantages whoever asked.
  if (input.visibility === "ALL_SUPPLIERS") {
    const invited = await tdb.rFQVendor.findMany({ where: { rfqId }, select: { vendorId: true } });
    for (const iv of invited) {
      await emit({
        type: "rfq.clarification_issued",
        organizationId: ctx.principal.organizationId,
        vendorId: iv.vendorId,
        actorId: ctx.principal.userId,
        title: `Clarification issued — ${clarification.rfq.rfqNumber}`,
        message: `A question about "${clarification.rfq.title}" has been answered for all bidders. Review it before you quote.`,
        severity: "warning",
        entityType: "RFQ",
        entityId: rfqId,
      });
    }
  } else if (clarification.vendorId) {
    await emit({
      type: "rfq.clarification_issued",
      organizationId: ctx.principal.organizationId,
      vendorId: clarification.vendorId,
      actorId: ctx.principal.userId,
      title: `Your question was answered — ${clarification.rfq.rfqNumber}`,
      message: input.answer.slice(0, 240),
      severity: "info",
      entityType: "RFQ",
      entityId: rfqId,
    });
  }

  return listClarifications(ctx, rfqId);
}

/** A notice the buyer issues unprompted, visible to every invited supplier. */
export async function issueNotice(
  ctx: ServiceContext,
  rfqId: string,
  input: z.infer<typeof issueNoticeSchema>
) {
  await assertPermission(ctx.principal, "rfqs.clarify");
  const rfq = await loadRfq(ctx, rfqId);

  const created = await scoped(ctx).rFQClarification.create({
    data: {
      organizationId: ctx.principal.organizationId,
      rfqId,
      vendorId: null,
      askedByUserId: ctx.principal.userId,
      question: input.question,
      answer: input.answer,
      visibility: "ALL_SUPPLIERS",
      status: "ANSWERED",
      answeredById: ctx.principal.userId,
      answeredAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.notice_issued",
    resource: "RFQClarification",
    resourceId: created.id,
    after: { rfqId, question: input.question },
    context: ctx.context,
  });

  for (const iv of rfq.invitedVendors) {
    await emit({
      type: "rfq.clarification_issued",
      organizationId: ctx.principal.organizationId,
      vendorId: iv.vendorId,
      actorId: ctx.principal.userId,
      title: `Notice — ${rfq.rfqNumber}`,
      message: input.question,
      severity: "warning",
      entityType: "RFQ",
      entityId: rfqId,
    });
  }

  return listClarifications(ctx, rfqId);
}

// ---------------------------------------------------------------------------
// Access helpers shared with the quotation and award services
// ---------------------------------------------------------------------------

export { loadRfq, pretty, approvalStateFor };

/**
 * Whether this user may see the whole evaluation, or only their own scores.
 *
 * §30: an ordinary panel member sees what they scored. The chair, and anyone
 * holding `rfqs.manageEvaluation`, sees the panel's work in the round — somebody
 * has to be able to reconcile it.
 */
export async function evaluationScope(
  ctx: ServiceContext,
  rfqId: string
): Promise<{ canSeeAll: boolean; seat: { id: string; role: string; isChair: boolean } | null }> {
  const seat = await scoped(ctx).rFQEvaluator.findFirst({
    where: { rfqId, userId: ctx.principal.userId },
    select: { id: true, role: true, isChair: true },
  });
  const canSeeAll = seat?.isChair === true || (await can(ctx.principal, "rfqs.manageEvaluation"));
  return { canSeeAll, seat: seat ?? null };
}

/** Throws unless the caller holds a seat on the panel or manages the evaluation. */
export async function assertCanEvaluate(ctx: ServiceContext, rfqId: string) {
  await assertPermission(ctx.principal, "rfqs.evaluate");
  const { canSeeAll, seat } = await evaluationScope(ctx, rfqId);
  if (!seat && !canSeeAll) {
    throw forbidden("You are not on the evaluation panel for this RFQ");
  }
  return { canSeeAll, seat };
}
