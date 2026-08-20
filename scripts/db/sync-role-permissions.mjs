// Grants newly-introduced permissions to the system roles that should hold them.
//
// `ensureSystemRoles` is deliberately non-destructive: it never rewrites the
// permissions on a role that already exists, so an administrator's decision to
// remove a grant survives a redeploy. That is the right default, and it has one
// consequence — when a release *adds* a permission to the catalog, no existing
// role picks it up, and a capability ships that nobody can use.
//
// This closes that gap without reopening the other one. It only ever adds, and
// only permissions the role catalog in src/server/roles.ts says the role should
// have. A grant an administrator removed by hand will be restored by this, which
// is the trade-off: it is run deliberately, after a release that adds
// permissions, rather than automatically on every boot.
//
//   node --env-file=.env scripts/db/sync-role-permissions.mjs [--dry-run]

import { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "../../src/server/roles.ts";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  let granted = 0;
  let created = 0;

  for (const org of orgs) {
    // A release can add a whole role, not only a permission — the evaluator seat
    // introduced with sourcing is exactly that. Existing organizations never run
    // `ensureSystemRoles` again after bootstrap, so without this the role exists
    // in the catalog and nowhere an administrator can assign it.
    const present = new Set(
      (await db.role.findMany({ where: { organizationId: org.id }, select: { key: true } })).map((r) => r.key)
    );
    for (const spec of SYSTEM_ROLES) {
      if (present.has(spec.key)) continue;
      console.log(`  ${org.name}: new role ${spec.name} (${spec.permissions.length} permissions)`);
      created += 1;
      if (dryRun) continue;
      await db.role.create({
        data: {
          organizationId: org.id,
          key: spec.key,
          name: spec.name,
          description: spec.description,
          rank: spec.rank,
          isSystem: true,
          legacyRole: spec.legacyRole,
          permissions: { create: [...new Set(spec.permissions)].map((permission) => ({ permission })) },
        },
      });
    }

    const roles = await db.role.findMany({
      where: { organizationId: org.id },
      include: { permissions: { select: { permission: true } } },
    });

    for (const role of roles) {
      const spec = SYSTEM_ROLES.find((r) => r.key === role.key);
      if (!spec) continue; // A role the organization invented — not ours to change.

      const held = new Set(role.permissions.map((p) => p.permission));
      const missing = spec.permissions.filter((p) => !held.has(p));
      if (missing.length === 0) continue;

      console.log(`  ${org.name} · ${role.name}: +${missing.length} — ${missing.join(", ")}`);
      granted += missing.length;

      if (!dryRun) {
        await db.rolePermission.createMany({
          data: missing.map((permission) => ({ roleId: role.id, permission })),
          skipDuplicates: true,
        });
      }
    }
  }

  if (created > 0) {
    console.log(`  ${dryRun ? "Would create" : "Created"} ${created} role${created === 1 ? "" : "s"}.`);
  }
  console.log(
    granted === 0
      ? "  Every system role already holds its catalog permissions."
      : `  ${dryRun ? "Would grant" : "Granted"} ${granted} permission${granted === 1 ? "" : "s"}.`
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
