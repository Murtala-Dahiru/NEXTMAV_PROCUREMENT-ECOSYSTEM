// Installs the default sourcing approval workflows — RFQ publication and award
// approval — into every organization that does not already have them.
//
// Separate from the seeder on purpose: `prisma/seed.ts` rebuilds a demo tenant
// from scratch, which is not something you run against a database holding real
// requests. This adds the Phase 4/5 configuration to a live tenant and leaves
// everything else alone.
//
// Unlike install-vendor-workflow.mjs, this does not restate the stage definitions:
// it imports the same module the application uses, so the workflow a live tenant
// gets and the one a new tenant gets can never drift apart.
//
//   node --env-file=.env --experimental-strip-types scripts/db/install-sourcing-workflows.mjs

import { PrismaClient } from "@prisma/client";
import {
  ensureRfqApprovalWorkflow,
  ensureAwardApprovalWorkflow,
  RFQ_WORKFLOW_NAME,
  AWARD_WORKFLOW_NAME,
} from "../../src/server/sourcing-workflow.ts";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });

  for (const org of orgs) {
    const rfq = await ensureRfqApprovalWorkflow(org.id, db);
    console.log(
      rfq.created
        ? `  ${org.name}: installed "${RFQ_WORKFLOW_NAME}"`
        : `  ${org.name}: already has an RFQ workflow — left alone`
    );

    const award = await ensureAwardApprovalWorkflow(org.id, db);
    console.log(
      award.created
        ? `  ${org.name}: installed "${AWARD_WORKFLOW_NAME}"`
        : `  ${org.name}: already has an award workflow — left alone`
    );

    // Both workflows open on a stage routed to PROCUREMENT_MANAGER. A workflow
    // whose first stage nobody holds refuses every submission with a
    // configuration error, so check it here rather than letting the first buyer
    // discover it mid-tender.
    const holders = await db.user.count({
      where: {
        organizationId: org.id,
        status: "ACTIVE",
        OR: [
          { role: "PROCUREMENT_MANAGER" },
          { role: "SUPER_ADMIN" },
          { roleAssignments: { some: { role: { key: "PROCUREMENT_MANAGER", isActive: true } } } },
        ],
      },
    });
    if (holders === 0) {
      console.log(
        `  ${org.name}: WARNING — nobody active holds Procurement Manager, so RFQ and award approvals cannot be routed`
      );
    }
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
