// NextMav Procure — award recommendation, approval and award.
//
// The end of the sourcing chain, and the part that has to survive being
// questioned a year later. Three records, not one:
//
//   AwardRecommendation  what somebody proposed, on what evidence, and why
//   ApprovalInstance     who decided it, at which stage, and when
//   RFQAward             the decision itself, and what it committed the
//                        organization to
//
// Collapsing these into a status field on the RFQ — which is what existed before
// — makes "why was this supplier selected?" unanswerable. The recommendation
// carries a frozen snapshot of the evaluation as it stood when it was put
// forward, so a later re-score cannot quietly rewrite the basis on which an
// approver signed.
//
// Rule 7 (no award without a valid evaluation where one is required) and Rule 8
// (an award must reference a valid quotation) are enforced here, server-side, on
// every path — including the direct-award path used where an organization has
// configured no award workflow.

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { conflict, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { emit } from "../engines/events";
import { transition } from "../state-machine";
import * as workflow from "../engines/workflow";
import { scoped, type ServiceContext } from "./context";
import { syncEventStatus } from "./sourcing-service";
import { getById as getRfq, loadRfq, pretty } from "./rfq-service";
import { comparison } from "./quotation-service";
import type {
  createAwardRecommendationSchema,
  awardDecisionSchema,
  awardRfqSchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type RecommendInput = z.infer<typeof createAwardRecommendationSchema>;
type DecisionInput = z.infer<typeof awardDecisionSchema>;
type AwardInput = z.infer<typeof awardRfqSchema>;

const recommendationInclude = {
  vendor: { select: { id: true, companyName: true, status: true } },
  quotation: {
    select: {
      id: true,
      quotationNumber: true,
      totalAmount: true,
      currency: true,
      revision: true,
      status: true,
      validUntil: true,
    },
  },
  rfq: { select: { id: true, rfqNumber: true, title: true, status: true, currency: true } },
  recommendedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  items: true,
} satisfies Prisma.AwardRecommendationInclude;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Checks that a quotation is fit to be awarded — Rule 8, plus the practical
 * reasons a technically valid bid still cannot be taken.
 */
async function assertAwardable(ctx: ServiceContext, rfqId: string, quotationId: string) {
  const quotation = await scoped(ctx).quotation.findFirst({
    where: { id: quotationId, rfqId },
    include: { vendor: true, lineItems: true },
  });
  if (!quotation) throw notFound("Quotation not found on this RFQ");

  if (quotation.status === "DRAFT") {
    throw conflict("That quotation was never submitted");
  }
  if (quotation.status === "WITHDRAWN") {
    throw conflict("That quotation has been withdrawn by the supplier");
  }
  if (quotation.status === "SUPERSEDED") {
    throw conflict("That quotation has been superseded by a later revision from the same supplier");
  }
  if (quotation.status === "EXPIRED") {
    throw conflict("That quotation has expired");
  }
  if (quotation.validUntil && quotation.validUntil.getTime() < Date.now()) {
    throw conflict(
      `That quotation expired on ${quotation.validUntil.toDateString()}. Ask the supplier to re-quote before awarding.`
    );
  }
  // The supplier's standing is re-checked at the moment of award, not trusted
  // from when they were invited: weeks can pass, and a supplier blacklisted in
  // the meantime must not be handed work.
  if (quotation.vendor.status === "BLACKLISTED") {
    throw conflict(`${quotation.vendor.companyName} is blacklisted and cannot be awarded work`);
  }
  if (quotation.vendor.status === "SUSPENDED") {
    throw conflict(
      `${quotation.vendor.companyName} is suspended. Lift the suspension before awarding, or award another supplier.`
    );
  }

  return quotation;
}

/**
 * Rule 7: an RFQ whose method depends on scoring cannot be awarded until the
 * scoring has actually happened.
 *
 * A LOWEST_PRICE award needs no panel — the arithmetic is the evaluation. Any
 * other method means the organization said the decision turns on judgement, and
 * awarding with no judgement recorded would make that a fiction.
 */
async function assertEvaluated(rfqId: string, evaluationMethod: string) {
  if (evaluationMethod === "LOWEST_PRICE") return;

  const [criteria, manualCriteria, scores] = await Promise.all([
    db.rFQEvaluationCriterion.count({ where: { rfqId } }),
    db.rFQEvaluationCriterion.count({ where: { rfqId, isAutomatic: false } }),
    db.quotationScore.count({ where: { quotation: { rfqId } } }),
  ]);

  if (criteria === 0) {
    throw conflict(
      "This RFQ uses a weighted evaluation but has no criteria defined. Define them before awarding."
    );
  }
  if (manualCriteria > 0 && scores === 0) {
    throw conflict(
      "No bid has been scored yet. Complete the evaluation before recommending an award."
    );
  }
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export async function listRecommendations(ctx: ServiceContext, rfqId: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  return scoped(ctx).awardRecommendation.findMany({
    where: { rfqId },
    include: recommendationInclude,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Creates an award recommendation (§32).
 *
 * The evaluation snapshot is taken here, from the same comparison the buyer was
 * looking at. It is stored as jsonb on the recommendation rather than recomputed
 * at approval time, because the approver has to be able to see what the
 * recommender saw — not what the numbers happen to say by the time they get to it.
 */
export async function createRecommendation(
  ctx: ServiceContext,
  rfqId: string,
  input: RecommendInput
) {
  await assertPermission(ctx.principal, "rfqs.recommendAward");
  const rfq = await loadRfq(ctx, rfqId);

  if (rfq.status === "AWARDED") throw conflict(`${rfq.rfqNumber} has already been awarded`);
  if (rfq.status === "CANCELLED" || rfq.status === "NO_AWARD") {
    throw conflict(`${rfq.rfqNumber} is ${pretty(rfq.status)}`);
  }
  if (rfq.status === "DRAFT" || rfq.status === "UNDER_REVIEW" || rfq.status === "APPROVED" || rfq.status === "READY_TO_PUBLISH") {
    throw conflict(`${rfq.rfqNumber} has not been to the market yet`);
  }
  if (rfq.isSealed && rfq.deadline.getTime() > Date.now()) {
    throw conflict("Bids on a sealed RFQ cannot be recommended before the deadline");
  }

  const quotation = await assertAwardable(ctx, rfqId, input.quotationId);
  await assertEvaluated(rfqId, rfq.evaluationMethod);

  const existing = await scoped(ctx).awardRecommendation.findFirst({
    where: { rfqId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
  });
  if (existing) {
    throw conflict(
      "There is already an open award recommendation on this RFQ. Withdraw it before raising another.",
      { recommendationId: existing.id }
    );
  }

  // Partial awards name their lines; a full award takes the whole quotation.
  const items =
    input.type === "PARTIAL"
      ? (input.items ?? [])
      : quotation.lineItems
          .filter((li) => !li.isNoBid)
          .map((li) => ({
            rfqLineItemId: li.rfqLineItemId ?? undefined,
            quotationLineItemId: li.id,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
          }));

  if (input.type === "PARTIAL" && items.length === 0) {
    throw validation("A partial award has to name the lines being awarded", {
      issues: [{ path: "items", message: "Select at least one line" }],
    });
  }

  // Recomputed from the lines rather than taken from the quotation total, because
  // a partial award commits less than the bid — §14 again.
  const amount =
    input.type === "PARTIAL"
      ? Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100
      : quotation.totalAmount;

  const snapshot = await comparison(ctx, rfqId).catch(() => null);

  const created = await db.$transaction(async (tx) => {
    const rec = await tx.awardRecommendation.create({
      data: {
        organizationId: ctx.principal.organizationId,
        rfqId,
        quotationId: quotation.id,
        vendorId: quotation.vendorId,
        type: input.type,
        status: "DRAFT",
        recommendedAmount: amount,
        currency: quotation.currency,
        justification: input.justification,
        evaluationSummary: snapshot
          ? ({
              method: rfq.evaluationMethod,
              capturedAt: new Date().toISOString(),
              rows: snapshot.rows.map((r) => ({
                vendorName: r.vendorName,
                quotationNumber: r.quotationNumber,
                totalAmount: r.totalAmount,
                deliveryDays: r.deliveryDays,
                coverage: r.coverage,
                weightedScore: r.weightedScore,
                rank: r.rank,
              })),
              summary: snapshot.summary,
            } as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        recommendedById: ctx.principal.userId,
        items: {
          create: items.map((i) => ({
            rfqLineItemId: i.rfqLineItemId ?? null,
            quotationLineItemId: i.quotationLineItemId ?? null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: Math.round(i.quantity * i.unitPrice * 100) / 100,
          })),
        },
      },
      include: recommendationInclude,
    });
    return rec;
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "award.recommended",
    resource: "AwardRecommendation",
    resourceId: created.id,
    after: {
      rfqNumber: rfq.rfqNumber,
      vendor: created.vendor.companyName,
      amount,
      currency: created.currency,
      type: input.type,
      justification: input.justification,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "AWARD_RECOMMENDED",
    description: `${ctx.principal.name} recommended ${created.vendor.companyName} for ${rfq.rfqNumber} (${created.currency} ${amount.toLocaleString()})`,
    rfqId,
    vendorId: created.vendorId,
    context: ctx.context,
  });

  if (input.submit) {
    return submitRecommendation(ctx, rfqId, created.id);
  }

  return getRfq(ctx, rfqId);
}

/**
 * Puts a recommendation in front of its approvers (§33), or awards outright where
 * no award workflow is configured.
 *
 * Same shape as RFQ publication approval, and the same honesty about the
 * unconfigured case: the award still happens, and the audit row says there was no
 * workflow in force rather than implying somebody approved it.
 */
export async function submitRecommendation(
  ctx: ServiceContext,
  rfqId: string,
  recommendationId: string
) {
  await assertPermission(ctx.principal, "rfqs.recommendAward");
  const tdb = scoped(ctx);

  const rec = await tdb.awardRecommendation.findFirst({
    where: { id: recommendationId, rfqId },
    include: recommendationInclude,
  });
  if (!rec) throw notFound("Award recommendation not found");
  if (rec.status !== "DRAFT" && rec.status !== "REJECTED") {
    throw conflict(`This recommendation is ${pretty(rec.status)}`);
  }

  await assertAwardable(ctx, rfqId, rec.quotationId);

  const facts: workflow.RequestFacts = {
    organizationId: ctx.principal.organizationId,
    amount: rec.recommendedAmount,
    priority: "MEDIUM",
    departmentId: null,
    category: null,
  };

  const selected = await workflow.selectWorkflow(facts, "AWARD");
  const now = new Date();

  if (!selected) {
    await tdb.awardRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: transition("awardRecommendation", rec.status, "APPROVED"),
        submittedAt: now,
        decidedAt: now,
        decidedById: ctx.principal.userId,
        decisionReason: "No award approval workflow is configured for this organization",
      },
    });
    await recordAudit({
      organizationId: ctx.principal.organizationId,
      userId: ctx.principal.userId,
      action: "award.approved",
      resource: "AwardRecommendation",
      resourceId: recommendationId,
      before: { status: rec.status },
      after: { status: "APPROVED", workflow: null, note: "No award approval workflow configured" },
      context: ctx.context,
    });
    return finaliseAward(ctx, rfqId, recommendationId);
  }

  const chain = await workflow.buildChain(
    selected,
    facts,
    rec.recommendedById ?? ctx.principal.userId
  );
  if (chain.length === 0) {
    throw conflict(`Workflow "${selected.name}" produced no applicable approval stages`);
  }

  const firstSequence = Math.min(...chain.map((c) => c.sequence));

  await db.$transaction(async (tx) => {
    await tx.approvalInstance.updateMany({
      where: { entityType: "AWARD", entityId: recommendationId, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: now, outcomeReason: "Superseded by resubmission" },
    });

    const instance = await tx.approvalInstance.create({
      data: {
        organizationId: ctx.principal.organizationId,
        workflowId: selected.id,
        entityType: "AWARD",
        entityId: recommendationId,
        status: "IN_PROGRESS",
        amount: rec.recommendedAmount,
        currency: rec.currency,
        context: {
          rfqId,
          rfqNumber: rec.rfq.rfqNumber,
          vendor: rec.vendor.companyName,
          quotationNumber: rec.quotation.quotationNumber,
          amount: rec.recommendedAmount,
          type: rec.type,
          justification: rec.justification,
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

    await tx.awardRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: transition("awardRecommendation", rec.status, "PENDING_APPROVAL"),
        submittedAt: now,
      },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "award.submitted_for_approval",
    resource: "AwardRecommendation",
    resourceId: recommendationId,
    after: { workflow: selected.name, stages: chain.length, amount: rec.recommendedAmount },
    context: ctx.context,
  });

  await emit({
    type: "rfq.award_approval_required",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: chain.filter((c) => c.sequence === firstSequence).map((c) => c.approverId),
    title: `Approve award of ${rec.rfq.rfqNumber}`,
    message: `${ctx.principal.name} recommends ${rec.vendor.companyName} at ${rec.currency} ${rec.recommendedAmount.toLocaleString()}.`,
    severity: "approval",
    link: "rfqs",
    entityType: "RFQ",
    entityId: rfqId,
  });

  return getRfq(ctx, rfqId);
}

export async function decideRecommendation(
  ctx: ServiceContext,
  rfqId: string,
  recommendationId: string,
  input: DecisionInput
) {
  await assertPermission(ctx.principal, "rfqs.approveAward");
  const tdb = scoped(ctx);

  const rec = await tdb.awardRecommendation.findFirst({
    where: { id: recommendationId, rfqId },
    include: recommendationInclude,
  });
  if (!rec) throw notFound("Award recommendation not found");
  if (rec.status !== "PENDING_APPROVAL") {
    throw conflict(`This recommendation is ${pretty(rec.status)} and is not awaiting approval`);
  }

  const instance = await tdb.approvalInstance.findFirst({
    where: { entityType: "AWARD", entityId: recommendationId, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!instance) throw conflict("There is no approval in progress for this recommendation");

  workflow.assertCanDecide(instance.steps, input.stepId, ctx.principal.userId);

  if (input.decision === "REJECTED" && !input.comment.trim()) {
    throw validation("Rejecting an award requires a reason", {
      issues: [{ path: "comment", message: "Say why this award is not being approved" }],
    });
  }

  const now = new Date();

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
      await tx.awardRecommendation.update({
        where: { id: recommendationId },
        data: {
          status: transition(
            "awardRecommendation",
            rec.status,
            input.decision === "REJECTED" ? "REJECTED" : "APPROVED"
          ),
          decidedAt: now,
          decidedById: ctx.principal.userId,
          decisionReason: input.comment || null,
        },
      });
    }

    return state;
  });

  const verb = input.decision === "APPROVED" ? "approved" : "rejected";

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: `award.${verb}`,
    resource: "AwardRecommendation",
    resourceId: recommendationId,
    before: { status: rec.status },
    after: { stepId: input.stepId, decision: input.decision, comment: input.comment },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: input.decision === "APPROVED" ? "AWARD_APPROVED" : "AWARD_REJECTED",
    description: `${ctx.principal.name} ${verb} the award of ${rec.rfq.rfqNumber} to ${rec.vendor.companyName}${input.comment ? ` — "${input.comment}"` : ""}`,
    severity: input.decision === "APPROVED" ? "SUCCESS" : "WARNING",
    rfqId,
    vendorId: rec.vendorId,
    context: ctx.context,
  });

  if (input.decision === "REJECTED") {
    await emit({
      type: "rfq.rejected",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: rec.recommendedById ? [rec.recommendedById] : [],
      title: `Award of ${rec.rfq.rfqNumber} not approved`,
      message: `${ctx.principal.name} declined the recommendation — ${input.comment}`,
      severity: "warning",
      link: "rfqs",
      entityType: "RFQ",
      entityId: rfqId,
    });
    return getRfq(ctx, rfqId);
  }

  if (!result.isComplete) {
    await emit({
      type: "rfq.award_approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: result.activeSteps.map((s) => s.delegatedToId ?? s.approverId),
      title: `Approve award of ${rec.rfq.rfqNumber}`,
      message: `The award of ${rec.rfq.rfqNumber} has cleared the previous stage and is waiting on you.`,
      severity: "approval",
      link: "rfqs",
      entityType: "RFQ",
      entityId: rfqId,
    });
    return getRfq(ctx, rfqId);
  }

  // Fully approved. The award follows immediately rather than waiting for someone
  // to press a second button: the decision has been taken, and an approved
  // recommendation that has not been enacted is a state nobody is watching.
  return finaliseAward(ctx, rfqId, recommendationId);
}

// ---------------------------------------------------------------------------
// Award
// ---------------------------------------------------------------------------

/**
 * Writes the award (§34).
 *
 * Losing bids are marked REJECTED, never deleted: they are the evidence that a
 * competition took place, and §34 says so explicitly.
 */
async function finaliseAward(ctx: ServiceContext, rfqId: string, recommendationId: string) {
  const tdb = scoped(ctx);
  const rec = await tdb.awardRecommendation.findFirst({
    where: { id: recommendationId, rfqId },
    include: recommendationInclude,
  });
  if (!rec) throw notFound("Award recommendation not found");
  if (rec.status !== "APPROVED") {
    throw conflict("This recommendation has not been approved");
  }

  const rfq = await loadRfq(ctx, rfqId);
  if (rfq.selectedQuotationId) throw conflict(`${rfq.rfqNumber} has already been awarded`);

  const quotation = await assertAwardable(ctx, rfqId, rec.quotationId);
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.rFQAward.create({
      data: {
        organizationId: ctx.principal.organizationId,
        rfqId,
        quotationId: quotation.id,
        vendorId: quotation.vendorId,
        recommendationId,
        type: rec.type,
        awardedAmount: rec.recommendedAmount,
        currency: rec.currency,
        justification: rec.justification,
        awardedById: rec.recommendedById,
        approvedById: rec.decidedById,
        awardedAt: now,
      },
    });

    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: "SELECTED", awardedAt: now },
    });
    // Everything else that was still in contention loses. Superseded and withdrawn
    // bids are left alone — they already have a truthful status.
    await tx.quotation.updateMany({
      where: {
        rfqId,
        id: { not: quotation.id },
        status: { notIn: ["WITHDRAWN", "SUPERSEDED", "DRAFT"] },
      },
      data: { status: "REJECTED" },
    });

    await tx.rFQ.update({
      where: { id: rfqId },
      data: {
        selectedQuotationId: quotation.id,
        status: transition("rfq", rfq.status, "AWARDED"),
        awardedAt: now,
        awardedById: rec.decidedById ?? rec.recommendedById,
        // An RFQ awarded straight from the response period never went through a
        // formal close; stamp it so the timeline is complete either way.
        closedAt: rfq.closedAt ?? now,
      },
    });

    await syncEventStatus(tx, rfq.sourcingEventId, "AWARDED", { awardedAt: now });

    // The requirement that started all this is now satisfied by an order to come.
    if (rfq.requestId) {
      await tx.purchaseRequest.updateMany({
        where: { id: rfq.requestId, status: { in: ["APPROVED", "IN_PROCUREMENT"] } },
        data: { status: "ORDERED" },
      });
    }
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "rfq.awarded",
    resource: "RFQ",
    resourceId: rfqId,
    before: { status: rfq.status, selectedQuotationId: null },
    after: {
      status: "AWARDED",
      selectedQuotationId: quotation.id,
      recommendationId,
      vendor: rec.vendor.companyName,
      amount: rec.recommendedAmount,
      currency: rec.currency,
      type: rec.type,
      justification: rec.justification,
      approvedBy: rec.decidedBy?.name ?? null,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "RFQ_AWARDED",
    description: `${rfq.rfqNumber} awarded to ${rec.vendor.companyName} (${rec.currency} ${rec.recommendedAmount.toLocaleString()})`,
    severity: "SUCCESS",
    rfqId,
    vendorId: rec.vendorId,
    context: ctx.context,
  });

  // The winner is told they won. Everybody else is told the outcome — a supplier
  // left guessing is how an organization loses the bidders it wants next time.
  await emit({
    type: "rfq.awarded",
    organizationId: ctx.principal.organizationId,
    vendorId: rec.vendorId,
    actorId: ctx.principal.userId,
    title: `You have been awarded ${rfq.rfqNumber}`,
    message: `Your quotation for "${rfq.title}" has been selected. A purchase order will follow.`,
    severity: "success",
    entityType: "RFQ",
    entityId: rfqId,
  });

  for (const iv of rfq.invitedVendors.filter((v) => v.vendorId !== rec.vendorId)) {
    await emit({
      type: "rfq.result",
      organizationId: ctx.principal.organizationId,
      vendorId: iv.vendorId,
      actorId: ctx.principal.userId,
      title: `${rfq.rfqNumber} — outcome`,
      message: `"${rfq.title}" has been awarded to another supplier. Thank you for taking part.`,
      severity: "info",
      entityType: "RFQ",
      entityId: rfqId,
    });
  }

  await emit({
    type: "rfq.awarded",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: [
      ...(rfq.createdById ? [rfq.createdById] : []),
      ...(rec.recommendedById ? [rec.recommendedById] : []),
    ],
    title: `${rfq.rfqNumber} awarded`,
    message: `${rec.vendor.companyName} has been awarded ${rfq.rfqNumber}. It is ready to become a purchase order.`,
    severity: "success",
    link: "rfqs",
    entityType: "RFQ",
    entityId: rfqId,
  });

  return getRfq(ctx, rfqId);
}

/**
 * Awards an RFQ.
 *
 * Two ways in, and both end at the same place:
 *
 *   with `recommendationId` — enact an award that has already been approved
 *   with `quotationId`      — the direct path, which raises a recommendation and
 *                             runs it through approval. Where a workflow exists
 *                             the caller does not get to skip it; where none does,
 *                             the award completes and says so.
 */
export async function award(ctx: ServiceContext, rfqId: string, input: AwardInput) {
  await assertPermission(ctx.principal, "rfqs.selectQuotation");

  if (input.recommendationId) {
    return finaliseAward(ctx, rfqId, input.recommendationId);
  }

  if (!input.quotationId) {
    throw validation("Name the quotation being awarded, or the approved recommendation to enact");
  }

  const created = await createRecommendation(ctx, rfqId, {
    quotationId: input.quotationId,
    type: "FULL",
    justification:
      input.justification.trim().length >= 10
        ? input.justification
        : `Awarded on the evaluation recorded against this RFQ by ${ctx.principal.name}.`,
    submit: true,
  });

  return created;
}

export async function withdrawRecommendation(
  ctx: ServiceContext,
  rfqId: string,
  recommendationId: string,
  reason: string
) {
  await assertPermission(ctx.principal, "rfqs.recommendAward");
  const tdb = scoped(ctx);

  const rec = await tdb.awardRecommendation.findFirst({
    where: { id: recommendationId, rfqId },
    include: recommendationInclude,
  });
  if (!rec) throw notFound("Award recommendation not found");
  if (rec.status === "APPROVED") {
    throw conflict("An approved recommendation cannot be withdrawn — the award has been made");
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.approvalInstance.updateMany({
      where: { entityType: "AWARD", entityId: recommendationId, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: now, outcomeReason: reason },
    });
    await tx.awardRecommendation.update({
      where: { id: recommendationId },
      data: {
        status: transition("awardRecommendation", rec.status, "WITHDRAWN"),
        decidedAt: now,
        decidedById: ctx.principal.userId,
        decisionReason: reason,
      },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "award.withdrawn",
    resource: "AwardRecommendation",
    resourceId: recommendationId,
    before: { status: rec.status },
    after: { status: "WITHDRAWN", reason },
    context: ctx.context,
  });

  return getRfq(ctx, rfqId);
}
