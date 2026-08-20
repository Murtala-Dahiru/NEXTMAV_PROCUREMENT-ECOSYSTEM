// NextMav Procure — the default vendor onboarding workflow.
//
// §15 is explicit that vendor approval must run on the existing configurable
// engine rather than on a second, hardcoded one. This module installs the
// *starting* workflow for an organization — a row, like any other, that an
// administrator can re-stage, re-target or deactivate afterwards. Nothing in the
// vendor service reads this file; it reads whatever workflow the database
// selects.
//
// The three stages are the ones §15 names. Each targets a configured `Role` where
// one fits, with a legacy enum role behind it: `resolveApprover` prefers the role
// assignment and falls back to the enum, so the chain still builds in an
// organization that has not assigned its roles yet.

import type { UserRole } from "@prisma/client";
import type { Tx } from "./db.ts";

export const VENDOR_WORKFLOW_NAME = "Vendor Onboarding Workflow";

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
}

const STAGES: StageSpec[] = [
  {
    name: "Compliance Review",
    stage: "PROCUREMENT",
    roleKey: "VENDOR_MANAGER",
    approverRole: "PROCUREMENT_MANAGER",
    slaHours: 48,
    description:
      "Confirms the supplier's registration, tax standing and mandatory certificates are present and verified.",
  },
  {
    name: "Procurement Review",
    stage: "PROCUREMENT",
    roleKey: "PROCUREMENT_MANAGER",
    approverRole: "PROCUREMENT_MANAGER",
    escalationRole: "SUPER_ADMIN",
    slaHours: 48,
    description:
      "Confirms the organization has a genuine need for this supplier and that its categories are right.",
  },
  {
    name: "Finance Review",
    stage: "FINANCE",
    roleKey: "FINANCE_MANAGER",
    approverRole: "FINANCE_OFFICER",
    escalationRole: "SUPER_ADMIN",
    slaHours: 72,
    description: "Confirms banking details and payment terms before the supplier can be paid.",
  },
];

/**
 * Installs the default vendor onboarding workflow, once.
 *
 * Idempotent and non-destructive, matching `ensureSystemRoles`: an organization
 * that already has a VENDOR workflow keeps whatever it has configured. Re-running
 * this must never quietly restore a stage an administrator removed.
 */
export async function ensureVendorOnboardingWorkflow(
  organizationId: string,
  client: Tx,
  /**
   * Roles this organization already has, when the caller has just read or written
   * them. Passing them in is not a micro-optimization: provisioning installs three
   * workflows back to back, and each one re-running the identical role lookup cost
   * three extra round trips inside the sign-up transaction — against a database in
   * another region that was three of the seconds a new user spent waiting, for an
   * answer already sitting in memory.
   */
  knownRoles?: { id: string; key: string }[]
): Promise<{ created: boolean; workflowId: string }> {
  const existing = await client.approvalWorkflow.findFirst({
    where: { organizationId, entityType: "VENDOR" },
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
      name: VENDOR_WORKFLOW_NAME,
      description:
        "Compliance, procurement and finance review before a supplier is approved for trading.",
      entityType: "VENDOR",
      isActive: true,
      // Vendor onboarding is not routed on value — a supplier has no amount at
      // the point it is approved. Leaving the thresholds unset is what makes this
      // workflow match every vendor rather than a spend band.
      thresholdMin: null,
      thresholdMax: null,
      selectionPriority: 0,
      stages: {
        create: STAGES.map((s, i) => ({
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
          description: s.description,
        })),
      },
    },
    select: { id: true },
  });

  return { created: true, workflowId: workflow.id };
}
