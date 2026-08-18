// NextMav Procure — approval workflow engine.
//
// The previous implementation walked a hardcoded array
// `["DEPARTMENT_MANAGER","FINANCE","PROCUREMENT","EXECUTIVE"]` and read only
// `slaHours` from the configured workflow. Everything else the workflow model
// expressed — thresholds, parallel stages, conditions, delegation, escalation —
// was inert.
//
// This engine makes the configuration authoritative:
//
//   selectWorkflow()  picks the workflow whose predicate matches the request
//   buildChain()      materialises the stages into ApprovalSteps, skipping
//                     stages whose amount condition excludes them
//   advance()         records one decision and computes what happens next
//
// Stages sharing a `sequence` are parallel: all of them must approve before the
// chain moves on. A rejection at any point ends the chain.

import type { ApprovalDecision, Prisma, UserRole } from "@prisma/client";
import { db } from "../db";
import { conflict, notFound } from "../errors";

export interface RequestFacts {
  organizationId: string;
  amount: number;
  priority: string;
  departmentId: string | null;
  category: string | null;
}

type WorkflowWithStages = Prisma.ApprovalWorkflowGetPayload<{ include: { stages: true } }>;

function matchesJsonFilter(raw: string | null, value: string | null): boolean {
  // A null filter means "no constraint on this dimension".
  if (!raw) return true;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return true;
    return value !== null && list.includes(value);
  } catch {
    return true;
  }
}

/**
 * Picks the workflow governing a request.
 *
 * Preference order: higher `selectionPriority` first, then the narrower amount
 * band. A workflow bounded to ≤ $25,000 is more specific than an unbounded one
 * and must win for a $3,000 request.
 */
export async function selectWorkflow(facts: RequestFacts): Promise<WorkflowWithStages | null> {
  const candidates = await db.approvalWorkflow.findMany({
    where: { organizationId: facts.organizationId, isActive: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });

  const matching = candidates.filter((w) => {
    if (w.thresholdMin !== null && facts.amount < w.thresholdMin) return false;
    if (w.thresholdMax !== null && facts.amount > w.thresholdMax) return false;
    if (!matchesJsonFilter(w.priorityFilter, facts.priority)) return false;
    if (!matchesJsonFilter(w.departmentFilter, facts.departmentId)) return false;
    if (!matchesJsonFilter(w.categoryFilter, facts.category)) return false;
    return w.stages.length > 0;
  });

  if (matching.length === 0) return null;

  matching.sort((a, b) => {
    if (b.selectionPriority !== a.selectionPriority) return b.selectionPriority - a.selectionPriority;
    const spanA = (a.thresholdMax ?? Number.POSITIVE_INFINITY) - (a.thresholdMin ?? 0);
    const spanB = (b.thresholdMax ?? Number.POSITIVE_INFINITY) - (b.thresholdMin ?? 0);
    return spanA - spanB;
  });

  return matching[0];
}

export interface PlannedStep {
  stage: WorkflowWithStages["stages"][number]["stage"];
  sequence: number;
  approverId: string;
  approverRole: UserRole;
  slaHours: number;
  slaExpiresAt: Date;
}

/**
 * Resolves the approver for a stage.
 *
 * Department-manager stages prefer the manager of the requesting department, so
 * a request from Engineering is approved by Engineering's manager rather than by
 * whichever department manager the query happened to return first — which is what
 * the old `users.find(u => u.role === "DEPARTMENT_MANAGER")` did.
 *
 * The requester is never chosen as their own approver.
 */
async function resolveApprover(
  organizationId: string,
  role: UserRole,
  departmentId: string | null,
  excludeUserId: string | null
): Promise<{ id: string; role: UserRole } | null> {
  const base = {
    organizationId,
    role,
    status: "ACTIVE" as const,
    ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
  };

  if (departmentId && role === "DEPARTMENT_MANAGER") {
    const departmental = await db.user.findFirst({
      where: { ...base, departmentId },
      orderBy: { createdAt: "asc" },
    });
    if (departmental) return { id: departmental.id, role: departmental.role };
  }

  const anyHolder = await db.user.findFirst({ where: base, orderBy: { createdAt: "asc" } });
  return anyHolder ? { id: anyHolder.id, role: anyHolder.role } : null;
}

/**
 * Materialises a workflow into concrete approval steps for one request.
 *
 * Stages carrying an amount condition that the request does not meet are skipped
 * entirely — that is how "conditional approval" is expressed without code.
 */
export async function buildChain(
  workflow: WorkflowWithStages,
  facts: RequestFacts,
  requesterId: string
): Promise<PlannedStep[]> {
  const now = Date.now();
  const planned: PlannedStep[] = [];

  for (const stage of workflow.stages) {
    if (stage.conditionMinAmount !== null && facts.amount < stage.conditionMinAmount) continue;
    if (stage.conditionMaxAmount !== null && facts.amount > stage.conditionMaxAmount) continue;

    const approver = await resolveApprover(
      facts.organizationId,
      stage.approverRole,
      facts.departmentId,
      requesterId
    );
    if (!approver) {
      // A stage with nobody to perform it would deadlock the request. Skipping it
      // silently would weaken the control, so this is surfaced as a configuration
      // error the administrator must fix.
      throw conflict(
        `Approval workflow "${workflow.name}" requires a ${stage.approverRole.replace(/_/g, " ").toLowerCase()} but no active user holds that role`,
        { stage: stage.name, requiredRole: stage.approverRole }
      );
    }

    planned.push({
      stage: stage.stage,
      sequence: stage.sequence,
      approverId: approver.id,
      approverRole: stage.approverRole,
      slaHours: stage.slaHours,
      slaExpiresAt: new Date(now + stage.slaHours * 3600 * 1000),
    });
  }

  return planned;
}

export interface ChainState {
  /** Steps awaiting a decision at the current sequence. */
  activeSteps: { id: string; approverId: string; delegatedToId: string | null }[];
  currentSequence: number | null;
  isComplete: boolean;
  isRejected: boolean;
}

type StepRow = {
  id: string;
  sequence: number;
  decision: ApprovalDecision;
  approverId: string;
  delegatedToId: string | null;
};

/**
 * Derives where a chain stands from its steps alone.
 *
 * Deriving rather than storing a pointer means the chain cannot disagree with
 * itself: there is no "current stage" field that can drift from the decisions.
 */
export function chainState(steps: StepRow[]): ChainState {
  if (steps.some((s) => s.decision === "REJECTED")) {
    return { activeSteps: [], currentSequence: null, isComplete: false, isRejected: true };
  }

  const outstanding = steps
    .filter((s) => s.decision === "PENDING")
    .sort((a, b) => a.sequence - b.sequence);

  if (outstanding.length === 0) {
    return { activeSteps: [], currentSequence: null, isComplete: true, isRejected: false };
  }

  const currentSequence = outstanding[0].sequence;
  const activeSteps = outstanding
    .filter((s) => s.sequence === currentSequence)
    .map((s) => ({ id: s.id, approverId: s.approverId, delegatedToId: s.delegatedToId }));

  return { activeSteps, currentSequence, isComplete: false, isRejected: false };
}

/**
 * Confirms a user may decide a given step *right now*.
 *
 * This is the check the old client-side `approveRequest` never made: it advanced
 * whichever step happened to be PENDING regardless of who was asking. Three
 * things must hold — the step is the one currently active, it is still pending,
 * and the caller is its assigned approver or delegate.
 */
export function assertCanDecide(
  steps: StepRow[],
  stepId: string,
  userId: string
): { step: StepRow; state: ChainState } {
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw notFound("Approval step not found");

  if (step.decision !== "PENDING") {
    throw conflict("This approval has already been decided");
  }

  const state = chainState(steps);
  if (!state.activeSteps.some((a) => a.id === stepId)) {
    throw conflict("An earlier approval stage is still outstanding");
  }

  const isApprover = step.approverId === userId;
  const isDelegate = step.delegatedToId === userId;
  if (!isApprover && !isDelegate) {
    throw conflict("You are not the assigned approver for this stage");
  }

  return { step, state };
}

/** Steps whose SLA has lapsed and that have not yet been escalated. */
export async function findBreachedSteps(organizationId: string) {
  return db.approvalStep.findMany({
    where: {
      decision: "PENDING",
      isEscalated: false,
      slaExpiresAt: { lt: new Date() },
      request: { organizationId },
    },
    include: {
      request: { select: { id: true, requestNumber: true, title: true, organizationId: true } },
    },
  });
}

/** Resolves who a breached step escalates to, per the workflow stage configuration. */
export async function resolveEscalationTarget(
  organizationId: string,
  workflowId: string | null,
  stage: string,
  departmentId: string | null
): Promise<{ id: string; role: UserRole } | null> {
  if (!workflowId) return null;

  const stageRow = await db.approvalWorkflowStage.findFirst({
    where: { workflowId, stage: stage as WorkflowWithStages["stages"][number]["stage"] },
  });
  if (!stageRow?.escalationRole) return null;

  return resolveApprover(organizationId, stageRow.escalationRole, departmentId, null);
}
