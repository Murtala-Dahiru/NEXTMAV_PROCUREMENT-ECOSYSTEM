// NextMav Procure — purchase request service.
//
// The request lifecycle, moved off the browser and made authoritative:
//
//   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → IN_PROCUREMENT → ORDERED
//         → PARTIALLY_FULFILLED → FULFILLED → CLOSED
//                    ↘ REJECTED   ↘ RETURNED   ↘ CANCELLED
//
// Every status change goes through the state machine in `state-machine.ts`, so a
// document cannot skip a stage or be revived from a terminal state.
//
// Three corrections to the previous behaviour are load-bearing:
//
//  1. A decision is only accepted from the *assigned* approver of the *currently
//     active* step. The old client action advanced whichever step was PENDING for
//     whoever clicked.
//  2. The approval chain comes from the configured workflow, not a hardcoded
//     four-stage array.
//  3. A request is no longer marked COMPLETED when a PO is issued. It completes
//     when the goods are received and the invoice is settled — issuing a PO means
//     procurement has *started*, not finished.

import type { Prisma, RequestStatus } from "@prisma/client";
import { db } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission, assertOwnerOrPermission } from "../permissions";
import { recordAudit, recordActivity, diff } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import * as workflow from "../engines/workflow";
import * as budget from "../engines/budget";
import { enqueue } from "../engines/outbox";
import { canTransition, nextStates, transition } from "../state-machine";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createRequestSchema,
  updateRequestSchema,
  requestDecisionSchema,
  delegateApprovalSchema,
  listQuerySchema,
  commentSchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createRequestSchema>;
type UpdateInput = z.infer<typeof updateRequestSchema>;
type DecisionInput = z.infer<typeof requestDecisionSchema>;
type DelegateInput = z.infer<typeof delegateApprovalSchema>;
type ListInput = z.infer<typeof listQuerySchema>;
type CommentInput = z.infer<typeof commentSchema>;

const SORTABLE = ["createdAt", "updatedAt", "totalEstimated", "neededByDate", "requestNumber", "status", "priority"] as const;

/** Statuses from which a request may still be edited by its owner. */
const EDITABLE_STATUSES: RequestStatus[] = ["DRAFT", "UNDER_REVIEW"];

const requestInclude = {
  lineItems: { orderBy: { sortOrder: "asc" } },
  approvals: { orderBy: { sequence: "asc" } },
  comments: { orderBy: { createdAt: "asc" } },
  watchers: true,
  department: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true, email: true, avatarColor: true, initials: true, role: true } },
  purchaseOrders: { select: { id: true, poNumber: true, status: true, totalAmount: true } },
  rfqs: { select: { id: true, rfqNumber: true, status: true, deadline: true } },
  versionHistory: { orderBy: { version: "desc" } },
} satisfies Prisma.PurchaseRequestInclude;

const lineTotal = (li: { quantity: number; estimatedCost: number }) => li.quantity * li.estimatedCost;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "requests.view");
  const tdb = scoped(ctx);

  const where: Prisma.PurchaseRequestWhereInput = {};

  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as RequestStatus[] };
  }
  if (q.priority && q.priority !== "ALL") {
    where.priority = { in: q.priority.split(",") as Prisma.EnumPriorityFilter["in"] };
  }
  if (q.departmentId && q.departmentId !== "ALL") where.departmentId = q.departmentId;
  if (q.category && q.category !== "ALL") where.category = q.category;
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }
  if (q.search) {
    where.OR = [
      { requestNumber: { contains: q.search, mode: "insensitive" } },
      { title: { contains: q.search, mode: "insensitive" } },
      { businessJustification: { contains: q.search, mode: "insensitive" } },
      { lineItems: { some: { itemName: { contains: q.search, mode: "insensitive" } } } },
    ];
  }

  // An employee without `requests.edit.all` still sees the organization's requests
  // (the permission map grants `requests.view` broadly), so no additional narrowing
  // is applied here. Department-only visibility would be a policy change, not a
  // security fix, and is left to configuration.

  const [total, items] = await Promise.all([
    tdb.purchaseRequest.count({ where }),
    tdb.purchaseRequest.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        approvals: { orderBy: { sequence: "asc" } },
        department: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, avatarColor: true, initials: true } },
        _count: { select: { comments: true, purchaseOrders: true } },
      },
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "requests.view");
  const request = await scoped(ctx).purchaseRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  if (!request) throw notFound("Purchase request not found");
  return request;
}

/** The approval queue for the signed-in user: steps they can act on right now. */
export async function myApprovalQueue(ctx: ServiceContext) {
  const tdb = scoped(ctx);

  const steps = await tdb.approvalStep.findMany({
    where: {
      decision: "PENDING",
      OR: [{ approverId: ctx.principal.userId }, { delegatedToId: ctx.principal.userId }],
    },
    include: {
      request: {
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          approvals: { orderBy: { sequence: "asc" } },
          department: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true, avatarColor: true, initials: true } },
        },
      },
    },
    orderBy: { slaExpiresAt: "asc" },
  });

  // Only surface steps that are genuinely actionable — a step at sequence 3 is not
  // the approver's problem while sequence 2 is still outstanding.
  return steps.filter((step) => {
    // Steps raised by a non-request approval instance (a PO, an invoice) have no
    // request to walk; they are surfaced by their own service.
    if (!step.request) return false;
    const state = workflow.chainState(step.request.approvals);
    return state.activeSteps.some((a) => a.id === step.id);
  });
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "requests.create");

  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const department = await tdb.department.findUnique({ where: { id: input.departmentId } });
  if (!department) throw validation("The selected department does not exist");

  const total = input.lineItems.reduce((sum, li) => sum + lineTotal(li), 0);
  const org = await db.organization.findUnique({ where: { id: organizationId } });

  const created = await db.$transaction(async (tx) => {
    const requestNumber = await nextDocumentNumber(organizationId, PREFIX.request, { client: tx });

    return tx.purchaseRequest.create({
      data: {
        organizationId,
        requestNumber,
        title: input.title,
        departmentId: input.departmentId,
        requestedById: ctx.principal.userId,
        status: "DRAFT",
        priority: input.priority,
        category: input.category || null,
        tags: JSON.stringify(input.tags ?? []),
        businessJustification: input.businessJustification,
        neededByDate: new Date(input.neededByDate),
        totalEstimated: total,
        currency: org?.currency ?? "USD",
        lineItems: {
          create: input.lineItems.map((li, i) => ({
            itemName: li.itemName,
            description: li.description || null,
            quantity: li.quantity,
            unit: li.unit,
            estimatedCost: li.estimatedCost,
            taxRate: li.taxRate ?? 0,
            sortOrder: i,
          })),
        },
        // The requester always watches their own request.
        watchers: { create: [{ userId: ctx.principal.userId }] },
      },
      include: requestInclude,
    });
  });

  if (input.templateId) {
    await tdb.requestTemplate
      .update({ where: { id: input.templateId }, data: { usageCount: { increment: 1 } } })
      .catch(() => {});
  }

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "request.created",
    resource: "PurchaseRequest",
    resourceId: created.id,
    after: { requestNumber: created.requestNumber, title: created.title, totalEstimated: total },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "REQUEST_CREATED",
    description: `${ctx.principal.name} created draft ${created.requestNumber}: '${created.title}'`,
    requestId: created.id,
    context: ctx.context,
  });

  if (input.submit) return submit(ctx, created.id);
  return created;
}

export async function update(ctx: ServiceContext, id: string, input: UpdateInput) {
  const tdb = scoped(ctx);
  const existing = await tdb.purchaseRequest.findUnique({
    where: { id },
    include: { lineItems: true, approvals: true },
  });
  if (!existing) throw notFound("Purchase request not found");

  await assertOwnerOrPermission(ctx.principal, existing.requestedById, "requests.edit.all");

  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw conflict(
      `A request in ${existing.status.replace(/_/g, " ").toLowerCase()} state cannot be edited`
    );
  }

  const nextLineItems = input.lineItems;
  const total = nextLineItems
    ? nextLineItems.reduce((sum, li) => sum + lineTotal(li), 0)
    : existing.totalEstimated;

  // Editing a request that has already entered the approval chain invalidates the
  // decisions made so far — approvers signed off on different numbers. The chain is
  // reset and a version snapshot is kept so the change is visible.
  const alreadyInReview = existing.status === "UNDER_REVIEW" || existing.approvals.length > 0;

  const updated = await db.$transaction(async (tx) => {
    if (alreadyInReview) {
      await tx.requestVersion.create({
        data: {
          requestId: id,
          version: existing.version,
          snapshot: JSON.stringify({
            title: existing.title,
            totalEstimated: existing.totalEstimated,
            priority: existing.priority,
            lineItems: existing.lineItems,
          }),
          reason: input.revisionReason ?? "Request edited during review",
          changedById: ctx.principal.userId,
        },
      });
      await tx.approvalStep.deleteMany({ where: { requestId: id } });
    }

    if (nextLineItems) {
      await tx.requestLineItem.deleteMany({ where: { requestId: id } });
    }

    return tx.purchaseRequest.update({
      where: { id },
      data: {
        title: input.title ?? undefined,
        departmentId: input.departmentId ?? undefined,
        priority: input.priority ?? undefined,
        category: input.category ?? undefined,
        tags: input.tags ? JSON.stringify(input.tags) : undefined,
        businessJustification: input.businessJustification ?? undefined,
        neededByDate: input.neededByDate ? new Date(input.neededByDate) : undefined,
        totalEstimated: total,
        version: alreadyInReview ? existing.version + 1 : existing.version,
        status: alreadyInReview ? "DRAFT" : existing.status,
        ...(nextLineItems
          ? {
              lineItems: {
                create: nextLineItems.map((li, i) => ({
                  itemName: li.itemName,
                  description: li.description || null,
                  quantity: li.quantity,
                  unit: li.unit,
                  estimatedCost: li.estimatedCost,
                  taxRate: li.taxRate ?? 0,
                  sortOrder: i,
                })),
              },
            }
          : {}),
      },
      include: requestInclude,
    });
  });

  const delta = diff(
    { title: existing.title, totalEstimated: existing.totalEstimated, priority: existing.priority },
    { title: updated.title, totalEstimated: updated.totalEstimated, priority: updated.priority }
  );

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "request.updated",
    resource: "PurchaseRequest",
    resourceId: id,
    before: delta.before,
    after: delta.after,
    context: ctx.context,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Submission — builds the approval chain from the configured workflow
// ---------------------------------------------------------------------------

export async function submit(ctx: ServiceContext, id: string) {
  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({
    where: { id },
    include: { lineItems: true, approvals: true },
  });
  if (!request) throw notFound("Purchase request not found");

  await assertOwnerOrPermission(ctx.principal, request.requestedById, "requests.edit.all");

  // A returned request is submitted the same way a draft is: that is the whole
  // point of returning it rather than rejecting it. The state machine is the
  // authority on which statuses can move to SUBMITTED, so this does not restate
  // the rule — it asks.
  //
  // `nextStates` rather than `canTransition`, because the latter treats a move to
  // the status you are already in as legal. Here that would let a request already
  // under approval be re-submitted, discarding decisions people had made.
  if (!nextStates("request", request.status).includes("SUBMITTED")) {
    throw conflict(
      `A request that is ${request.status.replace(/_/g, " ").toLowerCase()} cannot be submitted for approval`
    );
  }
  if (request.lineItems.length === 0) {
    throw validation("A request must have at least one line item before submission");
  }

  const facts: workflow.RequestFacts = {
    organizationId: ctx.principal.organizationId,
    amount: request.totalEstimated,
    priority: request.priority,
    departmentId: request.departmentId,
    category: request.category,
  };

  const selected = await workflow.selectWorkflow(facts);
  if (!selected) {
    throw conflict(
      "No approval workflow matches this request. Configure a workflow covering this amount and priority in Settings → Workflows."
    );
  }

  const chain = await workflow.buildChain(selected, facts, request.requestedById);
  if (chain.length === 0) {
    throw conflict(`Workflow "${selected.name}" produced no applicable approval stages`);
  }

  const now = new Date();
  const nextStatus = transition("request", request.status, "SUBMITTED");
  const firstSequence = Math.min(...chain.map((c) => c.sequence));

  const updated = await db.$transaction(async (tx) => {
    // A resubmission starts a fresh instance; the previous one stays as history.
    await tx.approvalInstance.updateMany({
      where: { requestId: id, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: now, outcomeReason: "Superseded by resubmission" },
    });
    await tx.approvalStep.deleteMany({ where: { requestId: id, decision: "PENDING" } });

    const instance = await tx.approvalInstance.create({
      data: {
        organizationId: ctx.principal.organizationId,
        workflowId: selected.id,
        entityType: "REQUEST",
        entityId: id,
        requestId: id,
        status: "IN_PROGRESS",
        amount: request.totalEstimated,
        currency: request.currency,
        context: {
          priority: request.priority,
          departmentId: request.departmentId,
          category: request.category,
          workflowVersion: selected.version,
        },
      },
    });

    await tx.approvalStep.createMany({
      data: chain.map((s) => ({
        instanceId: instance.id,
        requestId: id,
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

    // The demand signal: money asked for, not yet claimed. Recorded on submission
    // so a department's pipeline is visible before anything is approved.
    if (request.departmentId) {
      await budget.signalRequested(
        { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
        request.totalEstimated,
        id,
        ctx.principal.userId,
        tx
      );
    }

    const saved = await tx.purchaseRequest.update({
      where: { id },
      data: { status: nextStatus, submittedAt: now, workflowId: selected.id, returnedAt: null, returnReason: null },
      include: requestInclude,
    });

    await enqueue(tx, {
      type: "request.approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: chain.filter((c) => c.sequence === firstSequence).map((c) => c.approverId),
      title: `Approval required — ${request.requestNumber}`,
      message: `${ctx.principal.name} submitted "${request.title}" (${request.totalEstimated.toLocaleString()}) for your approval.`,
      severity: "approval",
      link: "approvals",
      entityType: "REQUEST",
      entityId: id,
      payload: { requestNumber: request.requestNumber, amount: request.totalEstimated },
    });

    return saved;
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "request.submitted",
    resource: "PurchaseRequest",
    resourceId: id,
    before: { status: request.status },
    after: { status: "SUBMITTED", workflow: selected.name, stages: chain.length },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "REQUEST_SUBMITTED",
    description: `${ctx.principal.name} submitted ${request.requestNumber}: '${request.title}' into "${selected.name}"`,
    requestId: id,
    context: ctx.context,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export async function decide(ctx: ServiceContext, requestId: string, input: DecisionInput) {
  await assertPermission(
    ctx.principal,
    input.decision === "REJECTED" ? "requests.reject" : "requests.approve"
  );

  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({
    where: { id: requestId },
    include: { approvals: { orderBy: { sequence: "asc" } }, watchers: true },
  });
  if (!request) throw notFound("Purchase request not found");

  if (request.status !== "SUBMITTED" && request.status !== "UNDER_REVIEW") {
    throw conflict(`This request is ${request.status.toLowerCase()} and is no longer in approval`);
  }

  // The gate the old implementation lacked entirely.
  workflow.assertCanDecide(request.approvals, input.stepId, ctx.principal.userId);

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: input.stepId },
      data: { decision: input.decision, comment: input.comment || null, decidedAt: now },
    });

    const steps = await tx.approvalStep.findMany({
      where: { requestId },
      orderBy: { sequence: "asc" },
    });
    const state = workflow.chainState(steps);

    // "Changes requested" returns the request to its owner for revision. It is
    // not a rejection and not a draft that was never submitted, so it has its own
    // state — the requester can see why it came back.
    let target: RequestStatus;
    if (input.decision === "REJECTED") target = "REJECTED";
    else if (input.decision === "CHANGES_REQUESTED") target = "RETURNED";
    else target = state.isComplete ? "APPROVED" : "UNDER_REVIEW";

    const nextStatus = transition("request", request.status, target);

    // Requesting changes voids the remaining chain — it must be re-submitted.
    if (input.decision === "CHANGES_REQUESTED") {
      await tx.approvalStep.deleteMany({ where: { requestId, decision: "PENDING" } });
    }

    // Close out the approval instance when the chain has resolved.
    if (nextStatus === "APPROVED" || nextStatus === "REJECTED" || nextStatus === "RETURNED") {
      await tx.approvalInstance.updateMany({
        where: { requestId, status: "IN_PROGRESS" },
        data: {
          status:
            nextStatus === "APPROVED" ? "APPROVED" : nextStatus === "REJECTED" ? "REJECTED" : "RETURNED",
          completedAt: now,
          decidedById: ctx.principal.userId,
          outcomeReason: input.comment || null,
        },
      });
    }

    // Budget movements run inside the same transaction as the decision. §23: an
    // approval that reserves no money, or a reservation for an approval that
    // rolled back, are both corruptions of the budget position. A hard-limit
    // breach therefore blocks the approval rather than being swallowed.
    if (request.departmentId) {
      if (nextStatus === "APPROVED") {
        await budget.reserveForRequest(
          { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
          request.totalEstimated,
          requestId,
          ctx.principal.userId,
          tx
        );
      } else if (nextStatus === "REJECTED" || nextStatus === "RETURNED") {
        await budget.releaseForRequest(
          { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
          requestId,
          ctx.principal.userId,
          tx
        );
      }
    }

    const updated = await tx.purchaseRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus,
        approvedAt: nextStatus === "APPROVED" ? now : undefined,
        rejectedAt: nextStatus === "REJECTED" ? now : undefined,
        rejectionReason: nextStatus === "REJECTED" ? input.comment || null : undefined,
        returnedAt: nextStatus === "RETURNED" ? now : undefined,
        returnReason: nextStatus === "RETURNED" ? input.comment || null : undefined,
      },
      include: requestInclude,
    });

    return { updated, state, nextStatus, steps };
  });

  const verb =
    input.decision === "APPROVED"
      ? "approved"
      : input.decision === "REJECTED"
        ? "rejected"
        : "requested changes on";

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: `request.${input.decision.toLowerCase()}`,
    resource: "PurchaseRequest",
    resourceId: requestId,
    before: { status: request.status },
    after: { status: result.nextStatus, stepId: input.stepId, comment: input.comment || null },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType:
      input.decision === "APPROVED"
        ? "REQUEST_APPROVED"
        : input.decision === "REJECTED"
          ? "REQUEST_REJECTED"
          : "STATUS_CHANGE",
    description: `${ctx.principal.name} ${verb} ${request.requestNumber}${input.comment ? ` — "${input.comment}"` : ""}`,
    severity: input.decision === "REJECTED" ? "WARNING" : "SUCCESS",
    requestId,
    context: ctx.context,
  });

  const watchers = request.watchers.map((w) => w.userId);

  await emit({
    type:
      input.decision === "APPROVED"
        ? result.state.isComplete
          ? "request.approved"
          : "request.approval_required"
        : input.decision === "REJECTED"
          ? "request.rejected"
          : "request.changes_requested",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: [...watchers, request.requestedById],
    title: `${request.requestNumber} ${verb}`,
    message: `${ctx.principal.name} ${verb} "${request.title}"${input.comment ? ` — ${input.comment}` : ""}`,
    severity:
      input.decision === "APPROVED" ? "success" : input.decision === "REJECTED" ? "error" : "warning",
    link: "requests",
    entityType: "REQUEST",
    entityId: requestId,
  });

  // Hand off to the next sequence.
  if (input.decision === "APPROVED" && !result.state.isComplete) {
    await emit({
      type: "request.approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: result.state.activeSteps.map((s) => s.delegatedToId ?? s.approverId),
      title: `Approval required — ${request.requestNumber}`,
      message: `"${request.title}" (${request.totalEstimated.toLocaleString()}) has cleared the previous stage and needs your approval.`,
      severity: "approval",
      link: "approvals",
      entityType: "REQUEST",
      entityId: requestId,
    });
  }

  return result.updated;
}

export async function delegate(ctx: ServiceContext, requestId: string, input: DelegateInput) {
  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({
    where: { id: requestId },
    include: { approvals: true },
  });
  if (!request) throw notFound("Purchase request not found");

  const step = request.approvals.find((s) => s.id === input.stepId);
  if (!step) throw notFound("Approval step not found");
  if (step.decision !== "PENDING") throw conflict("This approval has already been decided");
  if (step.approverId !== ctx.principal.userId) {
    throw forbidden("Only the assigned approver can delegate this step");
  }

  const delegateTo = await tdb.user.findUnique({ where: { id: input.delegateToId } });
  if (!delegateTo || delegateTo.status !== "ACTIVE") {
    throw validation("The chosen delegate is not an active user in this organization");
  }
  if (delegateTo.id === request.requestedById) {
    throw validation("A request cannot be delegated to its own requester");
  }

  // Delegation must respect the workflow: a stage marked `allowDelegation: false`
  // (typically finance) cannot be handed off.
  if (request.workflowId) {
    const stageConfig = await db.approvalWorkflowStage.findFirst({
      where: { workflowId: request.workflowId, stage: step.stage },
    });
    if (stageConfig && !stageConfig.allowDelegation) {
      throw forbidden(`The ${stageConfig.name} stage does not permit delegation`);
    }
  }

  await tdb.approvalStep.update({
    where: { id: input.stepId },
    data: { delegatedToId: input.delegateToId },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "approval.delegated",
    resource: "ApprovalStep",
    resourceId: input.stepId,
    before: { delegatedToId: step.delegatedToId },
    after: { delegatedToId: input.delegateToId, reason: input.reason },
    context: ctx.context,
  });

  await emit({
    type: "approval.delegated",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: [input.delegateToId],
    title: `Approval delegated to you — ${request.requestNumber}`,
    message: `${ctx.principal.name} delegated approval of "${request.title}" to you.${input.reason ? ` Reason: ${input.reason}` : ""}`,
    severity: "approval",
    link: "approvals",
    entityType: "REQUEST",
    entityId: requestId,
  });

  return getById(ctx, requestId);
}

// ---------------------------------------------------------------------------
// Cancellation, comments, watchers
// ---------------------------------------------------------------------------

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "requests.cancel");

  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({
    where: { id },
    include: { purchaseOrders: true, watchers: true },
  });
  if (!request) throw notFound("Purchase request not found");

  if (request.status === "CLOSED" || request.status === "CANCELLED") {
    throw conflict(`This request is already ${request.status.toLowerCase()}`);
  }
  transition("request", request.status, "CANCELLED");

  const liveOrders = request.purchaseOrders.filter(
    (po) => !["CANCELLED", "DRAFT"].includes(po.status)
  );
  if (liveOrders.length > 0) {
    throw conflict(
      `This request cannot be cancelled — ${liveOrders.length} purchase order(s) have already been issued against it. Cancel those first.`,
      { purchaseOrders: liveOrders.map((p) => p.poNumber) }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.approvalStep.deleteMany({ where: { requestId: id, decision: "PENDING" } });
    await tx.approvalInstance.updateMany({
      where: { requestId: id, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: new Date(), outcomeReason: reason },
    });
    await tx.purchaseRequest.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    // Whatever this request was holding goes back to the budget, in the same
    // transaction that cancelled it.
    if (request.departmentId) {
      await budget.releaseForRequest(
        { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
        id,
        ctx.principal.userId,
        tx
      );
    }
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "request.cancelled",
    resource: "PurchaseRequest",
    resourceId: id,
    before: { status: request.status },
    after: { status: "CANCELLED", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "REQUEST_CANCELLED",
    description: `${ctx.principal.name} cancelled ${request.requestNumber} — ${reason}`,
    severity: "WARNING",
    requestId: id,
    context: ctx.context,
  });

  await emit({
    type: "request.cancelled",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: request.watchers.map((w) => w.userId),
    title: `${request.requestNumber} cancelled`,
    message: `${ctx.principal.name} cancelled "${request.title}" — ${reason}`,
    severity: "warning",
    link: "requests",
    entityType: "REQUEST",
    entityId: id,
  });

  return getById(ctx, id);
}

export async function addComment(ctx: ServiceContext, requestId: string, input: CommentInput) {
  await assertPermission(ctx.principal, "requests.comment");

  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({
    where: { id: requestId },
    include: { watchers: true },
  });
  if (!request) throw notFound("Purchase request not found");

  await db.comment.create({
    data: {
      entityType: "REQUEST",
      entityId: requestId,
      requestId,
      authorId: ctx.principal.userId,
      content: input.content,
      mentions: JSON.stringify(input.mentions ?? []),
    },
  });

  // Commenting subscribes you to the thread.
  await db.requestWatcher
    .create({ data: { requestId, userId: ctx.principal.userId } })
    .catch(() => {});

  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "COMMENT_ADDED",
    description: `${ctx.principal.name} commented on ${request.requestNumber}`,
    requestId,
    context: ctx.context,
  });

  const recipients = [
    ...request.watchers.map((w) => w.userId),
    ...(input.mentions ?? []),
  ];

  await emit({
    type: "request.submitted",
    organizationId: ctx.principal.organizationId,
    actorId: ctx.principal.userId,
    recipientIds: recipients,
    title: `New comment on ${request.requestNumber}`,
    message: `${ctx.principal.name}: ${input.content.slice(0, 160)}`,
    severity: "mention",
    link: "requests",
    entityType: "REQUEST",
    entityId: requestId,
  });

  return getById(ctx, requestId);
}

export async function toggleWatcher(ctx: ServiceContext, requestId: string, userId: string) {
  const tdb = scoped(ctx);
  const request = await tdb.purchaseRequest.findUnique({ where: { id: requestId } });
  if (!request) throw notFound("Purchase request not found");

  const existing = await db.requestWatcher.findUnique({
    where: { requestId_userId: { requestId, userId } },
  });

  if (existing) {
    await db.requestWatcher.delete({ where: { id: existing.id } });
  } else {
    await db.requestWatcher.create({ data: { requestId, userId } });
  }

  return getById(ctx, requestId);
}

/**
 * Moves a request along its fulfilment states from the facts downstream.
 *
 * Called by the PO, receiving, invoice and payment services rather than by a
 * user, so the status reflects reality rather than intent:
 *
 *   ORDERED               a purchase order exists
 *   PARTIALLY_FULFILLED   some ordered quantity has been received
 *   FULFILLED             everything ordered has been received or rejected
 *   CLOSED               ... and every invoice against it has been paid
 */
export async function reconcileCompletion(organizationId: string, requestId: string) {
  const request = await db.purchaseRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      purchaseOrders: {
        where: { status: { notIn: ["CANCELLED"] } },
        include: { invoices: true, lineItems: true },
      },
    },
  });
  if (!request) return;
  if (request.status === "CANCELLED" || request.status === "CLOSED") return;
  if (request.purchaseOrders.length === 0) return;

  const lines = request.purchaseOrders.flatMap((po) => po.lineItems);
  const settled = (li: { receivedQty: number; rejectedQty: number; orderedQty: number }) =>
    li.receivedQty + li.rejectedQty >= li.orderedQty;

  const allReceived = lines.length > 0 && lines.every(settled);
  const someReceived = lines.some((li) => li.receivedQty > 0);
  const allInvoicesPaid = request.purchaseOrders.every(
    (po) => po.invoices.length > 0 && po.invoices.every((inv) => inv.status === "PAID")
  );

  const target: RequestStatus =
    allReceived && allInvoicesPaid
      ? "CLOSED"
      : allReceived
        ? "FULFILLED"
        : someReceived
          ? "PARTIALLY_FULFILLED"
          : "ORDERED";

  if (target === request.status) return;
  if (!canTransition("request", request.status, target)) return;

  const now = new Date();
  await db.purchaseRequest.update({
    where: { id: requestId },
    data: {
      status: target,
      orderedAt: target === "ORDERED" ? (request.orderedAt ?? now) : undefined,
      fulfilledAt: target === "FULFILLED" || target === "CLOSED" ? (request.fulfilledAt ?? now) : undefined,
      closedAt: target === "CLOSED" ? now : undefined,
    },
  });

  await recordActivity({
    organizationId,
    eventType: target === "CLOSED" ? "REQUEST_COMPLETED" : "STATUS_CHANGE",
    description:
      target === "CLOSED"
        ? `${request.requestNumber} closed — all goods received and invoices settled`
        : `${request.requestNumber} is now ${target.toLowerCase().replace(/_/g, " ")}`,
    severity: target === "CLOSED" ? "SUCCESS" : "INFO",
    requestId,
  });
}
