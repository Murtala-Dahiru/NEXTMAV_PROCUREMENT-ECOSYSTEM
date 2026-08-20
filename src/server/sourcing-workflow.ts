// NextMav Procure — the default sourcing approval workflows.
//
// §7 and §33 both say the same thing in different words: RFQ publication and
// award approval must run on the approval engine that already exists, not on a
// second hardcoded one bolted to the sourcing service. This module installs the
// *starting* workflows for an organization — ordinary rows, like the vendor
// onboarding workflow next door, which an administrator can re-stage, re-target
// or deactivate afterwards. Nothing in the sourcing service reads this file; it
// reads whatever workflow the database selects.
//
// Two workflows, because they gate different decisions:
//
//   RFQ    — may we put this requirement to the market at all, in these terms?
//            One stage. The check is on the document, and holding a tender up
//            through three desks before it is even published is how sourcing
//            cycles stretch to months.
//
//   AWARD  — is this the right supplier, at this price, on this evaluation?
//            Value-banded: a small award clears with procurement alone, a large
//            one picks up finance and then an executive. This is where the
//            organization's money is actually committed, so this is where the
//            scrutiny belongs.
//
// Both target a configured `Role` where one fits, with a legacy enum role behind
// it: `resolveApprover` prefers the role assignment and falls back to the enum,
// so the chain still builds in an organization that has not assigned its roles.

import type { UserRole } from "@prisma/client";
import type { Tx } from "./db.ts";

export const RFQ_WORKFLOW_NAME = "RFQ Publication Approval";
export const AWARD_WORKFLOW_NAME = "Award Approval";

interface StageSpec {
  name: string;
  stage: "DEPARTMENT_MANAGER" | "FINANCE" | "PROCUREMENT" | "EXECUTIVE";
  /** Configured role key this stage routes to, when the organization has one. */
  roleKey: string | null;
  /** Fallback when nobody holds the configured role. */
  approverRole: UserRole;
  escalationRole?: UserRole;
  slaHours: number;
  description: string;
  /** Amount band in which the stage applies. Outside it, the stage is skipped. */
  conditionMinAmount?: number;
  conditionMaxAmount?: number;
}

const RFQ_STAGES: StageSpec[] = [
  {
    name: "Sourcing Review",
    stage: "PROCUREMENT",
    roleKey: "PROCUREMENT_MANAGER",
    approverRole: "PROCUREMENT_MANAGER",
    escalationRole: "SUPER_ADMIN",
    slaHours: 24,
    description:
      "Confirms the requirement, the specification, the invited supplier list and the response deadline before the RFQ goes to the market.",
  },
];

const AWARD_STAGES: StageSpec[] = [
  {
    name: "Procurement Approval",
    stage: "PROCUREMENT",
    roleKey: "PROCUREMENT_MANAGER",
    approverRole: "PROCUREMENT_MANAGER",
    escalationRole: "SUPER_ADMIN",
    slaHours: 48,
    description:
      "Confirms the evaluation was carried out as the RFQ defined it and that the recommended supplier follows from the scores.",
  },
  {
    name: "Finance Approval",
    stage: "FINANCE",
    roleKey: "FINANCE_MANAGER",
    approverRole: "FINANCE_OFFICER",
    escalationRole: "SUPER_ADMIN",
    slaHours: 48,
    // Below this, the award is routine spend and a finance signature adds delay
    // rather than control.
    conditionMinAmount: 25_000,
    description: "Confirms budget cover and payment terms before the organization commits the spend.",
  },
  {
    name: "Executive Approval",
    stage: "EXECUTIVE",
    roleKey: "EXECUTIVE",
    approverRole: "SUPER_ADMIN",
    slaHours: 72,
    conditionMinAmount: 250_000,
    description: "Final authority on major awards.",
  },
];

async function installWorkflow(
  organizationId: string,
  client: Tx,
  spec: {
    name: string;
    description: string;
    entityType: "RFQ" | "AWARD";
    stages: StageSpec[];
  },
  /**
   * Roles this organization already has, when the caller has just read or written
   * them. Passing them in is not a micro-optimization: provisioning installs three
   * workflows back to back, and each one re-running the identical role lookup cost
   * three extra round trips inside the sign-up transaction — against a database in
   * another region that was several of the seconds a new user spent waiting, for an
   * answer already sitting in memory.
   */
  knownRoles?: { id: string; key: string }[]
): Promise<{ created: boolean; workflowId: string }> {
  const existing = await client.approvalWorkflow.findFirst({
    where: { organizationId, entityType: spec.entityType },
    select: { id: true },
  });
  if (existing) return { created: false, workflowId: existing.id };

  const roles =
    knownRoles ??
    (await client.role.findMany({
      where: { organizationId },
      select: { id: true, key: true },
    }));
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

  const workflow = await client.approvalWorkflow.create({
    data: {
      organizationId,
      name: spec.name,
      description: spec.description,
      entityType: spec.entityType,
      isActive: true,
      // Unset on purpose. The workflow itself matches every event of its type;
      // the value banding that matters is expressed on the *stages*, so a single
      // workflow can cover a $2,000 award and a $2,000,000 one and route them
      // differently. Bounding the workflow instead would mean an award above the
      // top band matched nothing and deadlocked.
      thresholdMin: null,
      thresholdMax: null,
      selectionPriority: 0,
      stages: {
        create: spec.stages.map((s, i) => ({
          name: s.name,
          stage: s.stage,
          sequence: i + 1,
          approverRole: s.approverRole,
          approverRoleId: s.roleKey ? (roleIdByKey.get(s.roleKey) ?? null) : null,
          escalationRole: s.escalationRole ?? null,
          slaHours: s.slaHours,
          allowDelegation: true,
          isParallel: false,
          isMandatory: true,
          conditionMinAmount: s.conditionMinAmount ?? null,
          conditionMaxAmount: s.conditionMaxAmount ?? null,
          description: s.description,
        })),
      },
    },
    select: { id: true },
  });

  return { created: true, workflowId: workflow.id };
}

/**
 * Installs the default RFQ publication workflow, once.
 *
 * Idempotent and non-destructive, matching `ensureSystemRoles` and
 * `ensureVendorOnboardingWorkflow`: an organization that already has an RFQ
 * workflow keeps whatever it has configured.
 */
export function ensureRfqApprovalWorkflow(
  organizationId: string,
  client: Tx,
  knownRoles?: { id: string; key: string }[]
) {
  return installWorkflow(
    organizationId,
    client,
    {
      name: RFQ_WORKFLOW_NAME,
      description: "Procurement review of an RFQ before it is published to suppliers.",
      entityType: "RFQ",
      stages: RFQ_STAGES,
    },
    knownRoles
  );
}

/** Installs the default award approval workflow, once. Same guarantees. */
export function ensureAwardApprovalWorkflow(
  organizationId: string,
  client: Tx,
  knownRoles?: { id: string; key: string }[]
) {
  return installWorkflow(
    organizationId,
    client,
    {
      name: AWARD_WORKFLOW_NAME,
      description:
        "Approval of an award recommendation, escalating with the value being committed.",
      entityType: "AWARD",
      stages: AWARD_STAGES,
    },
    knownRoles
  );
}
