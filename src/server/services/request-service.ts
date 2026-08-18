// NextMav Procure — purchase request service.
//
// The request lifecycle, moved off the browser and made authoritative:
//
//   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → (PO issued) → COMPLETED
//                    ↘ REJECTED   ↘ CANCELLED
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
      { requestNumber: { contains: q.search } },
      { title: { contains: q.search } },
      { businessJustification: { contains: q.search } },
      { lineItems: { some: { itemName: { contains: q.search } } } },
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

  if (request.status !== "DRAFT") {
    throw conflict(`Only a draft can be submitted — this request is ${request.status.toLowerCase()}`);
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
  const updated = await db.$transaction(async (tx) => {
    await tx.approvalStep.deleteMany({ where: { requestId: id } });
    await tx.approvalStep.createMany({
      data: chain.map((s) => ({
        requestId: id,
        stage: s.stage,
        sequence: s.sequence,
        approverId: s.approverId,
        approverRole: s.approverRole,
        decision: "PENDING" as const,
        slaHours: s.slaHours,
        slaExpiresAt: s.slaExpiresAt,
      })),
    });

    return tx.purchaseRequest.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: now, workflowId: selected.id },
      include: requestInclude,
    });
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

  // Notify only the approvers at the first active sequence.
  const firstSequence = Math.min(...chain.map((c) => c.sequence));
  await emit({
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

    let nextStatus: RequestStatus;
    if (input.decision === "REJECTED") nextStatus = "REJECTED";
    else if (input.decision === "CHANGES_REQUESTED") nextStatus = "DRAFT";
    else nextStatus = state.isComplete ? "APPROVED" : "UNDER_REVIEW";

    // Requesting changes voids the remaining chain — it must be re-submitted.
    if (input.decision === "CHANGES_REQUESTED") {
      await tx.approvalStep.deleteMany({ where: { requestId, decision: "PENDING" } });
    }

    const updated = await tx.purchaseRequest.update({
      where: { id: requestId },
      data: { status: nextStatus },
      include: requestInclude,
    });

    return { updated, state, nextStatus, steps };
  });

  // Budget effects, outside the request transaction so a budget without a matching
  // department record cannot block a legitimate approval.
  if (result.nextStatus === "APPROVED" && request.departmentId) {
    await budget
      .reserveForRequest(
        { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
        request.totalEstimated,
        requestId,
        ctx.principal.userId
      )
      .catch((err) => {
        console.error("[request] budget reservation failed", err);
      });
  }
  if (result.nextStatus === "REJECTED" && request.departmentId) {
    await budget
      .releaseForRequest(
        { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
        requestId,
        ctx.principal.userId
      )
      .catch(() => {});
  }

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

  if (request.status === "COMPLETED" || request.status === "CANCELLED") {
    throw conflict(`This request is already ${request.status.toLowerCase()}`);
  }

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
    await tx.purchaseRequest.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });

  if (request.departmentId) {
    await budget
      .releaseForRequest(
        { organizationId: ctx.principal.organizationId, departmentId: request.departmentId },
        id,
        ctx.principal.userId
      )
      .catch(() => {});
  }

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
 * Closes a request once its downstream chain has fully settled.
 *
 * Called by the PO, receiving and invoice services rather than by a user, so
 * completion reflects reality: every PO closed, every invoice paid.
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
  if (request.status === "CANCELLED" || request.status === "COMPLETED") return;
  if (request.purchaseOrders.length === 0) return;

  const allReceived = request.purchaseOrders.every((po) =>
    po.lineItems.every((li) => li.receivedQty + li.rejectedQty >= li.orderedQty)
  );
  const allInvoicesPaid = request.purchaseOrders.every(
    (po) => po.invoices.length > 0 && po.invoices.every((inv) => inv.status === "PAID")
  );

  if (allReceived && allInvoicesPaid) {
    await db.purchaseRequest.update({
      where: { id: requestId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await recordActivity({
      organizationId,
      eventType: "REQUEST_COMPLETED",
      description: `${request.requestNumber} completed — all goods received and invoices settled`,
      severity: "SUCCESS",
      requestId,
    });
  }
}
