// Installs the default vendor onboarding workflow into every organization that
// does not already have one, and makes sure somebody holds the role its first
// stage routes to.
//
// Separate from the seeder on purpose: `prisma/seed.ts` rebuilds a demo tenant
// from scratch, which is not something you run against a database holding real
// requests. This adds the Phase 3 configuration to a live tenant and leaves
// everything else alone.
//
//   node --env-file=.env scripts/db/install-vendor-workflow.mjs

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const VENDOR_WORKFLOW_NAME = "Vendor Onboarding Workflow";

const STAGES = [
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

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });

  for (const org of orgs) {
    const existing = await db.approvalWorkflow.findFirst({
      where: { organizationId: org.id, entityType: "VENDOR" },
      select: { id: true, name: true },
    });

    if (existing) {
      console.log(`  ${org.name}: already has "${existing.name}" — left alone`);
    } else {
      const roles = await db.role.findMany({
        where: { organizationId: org.id },
        select: { id: true, key: true },
      });
      const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

      const wf = await db.approvalWorkflow.create({
        data: {
          organizationId: org.id,
          name: VENDOR_WORKFLOW_NAME,
          description:
            "Compliance, procurement and finance review before a supplier is approved for trading.",
          entityType: "VENDOR",
          isActive: true,
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
      console.log(`  ${org.name}: installed "${VENDOR_WORKFLOW_NAME}" (${STAGES.length} stages)`);
    }

    // The first stage routes to VENDOR_MANAGER. A workflow whose opening stage
    // nobody holds would refuse every submission with a configuration error, so
    // the role is granted to somebody who can actually do the reviewing.
    const vendorManagerRole = await db.role.findFirst({
      where: { organizationId: org.id, key: "VENDOR_MANAGER" },
      select: { id: true },
    });
    if (!vendorManagerRole) continue;

    const held = await db.userRoleAssignment.count({
      where: { organizationId: org.id, roleId: vendorManagerRole.id },
    });
    if (held > 0) {
      console.log(`  ${org.name}: VENDOR_MANAGER already held by ${held} user(s)`);
      continue;
    }

    // Preferred holder: an active department manager, who is senior enough to
    // review a supplier and is not the person who typically raises them.
    const candidate =
      (await db.user.findFirst({
        where: { organizationId: org.id, status: "ACTIVE", role: "DEPARTMENT_MANAGER" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      })) ??
      (await db.user.findFirst({
        where: { organizationId: org.id, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }));

    if (!candidate) {
      console.log(`  ${org.name}: no active user to hold VENDOR_MANAGER`);
      continue;
    }

    await db.userRoleAssignment.create({
      data: { organizationId: org.id, userId: candidate.id, roleId: vendorManagerRole.id },
    });
    console.log(`  ${org.name}: granted VENDOR_MANAGER to ${candidate.name}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
