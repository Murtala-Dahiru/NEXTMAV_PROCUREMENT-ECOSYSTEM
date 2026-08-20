// NextMav Procure — the role catalog.
//
// §5 of the mandate: "Do not hardcode every permission into individual pages.
// The database should support a scalable permission model."
//
// What is code and what is data, and why:
//
//   CODE   the permission *catalog* (`Permission` in src/lib/types.ts). It
//          enumerates what the application knows how to check, so it can only
//          grow when the application does. A permission string that no code
//          gates is a lie, and this is what stops one being invented.
//   DATA   roles, the permissions each role grants, and who holds which role.
//          An organization can define "Category Buyer", give it exactly the
//          rights it should have, and route approvals to it — with no deploy.
//
// The roles below are the *starting set* installed for a new organization. They
// are seeded as ordinary rows: an administrator can re-permission or deactivate
// any of them afterwards, and the platform reads the rows, never this file.

import type { UserRole } from "@prisma/client";
// Relative rather than the "@/" alias: prisma/seed.ts loads this module through
// plain node, which has no path mapping.
import { PERMISSION_LABELS, ROLE_PERMISSIONS, type Permission } from "../lib/types.ts";
// Type-only, so this module carries no runtime dependency on the Prisma client
// singleton: prisma/seed.ts imports the role catalog while holding its own client.
import type { Tx } from "./db.ts";
import { validation } from "./errors.ts";

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export interface SystemRole {
  key: string;
  name: string;
  description: string;
  /** Seniority. Escalation walks upward through this. */
  rank: number;
  /** The legacy `UserRole` enum value this role corresponds to, where one exists. */
  legacyRole: UserRole | null;
  permissions: Permission[];
}

const REQUESTER: Permission[] = [
  "requests.view", "requests.create", "requests.edit.own", "requests.cancel", "requests.comment",
  "vendors.view", "rfqs.view", "purchaseOrders.view", "documents.view", "ai.assistant",
];

// A procurement officer builds and runs the sourcing event but does not decide
// it: §40 puts publication, award approval and the award itself with the manager.
// The officer can still recommend an award — proposing is the work, approving is
// the control, and separating them is the point of the whole approval chain.
const SOURCING: Permission[] = [
  "requests.view", "requests.comment",
  "vendors.view", "vendors.create", "vendors.edit", "vendors.notes",
  "rfqs.view", "rfqs.create", "rfqs.cancel",
  "rfqs.manageEvaluation", "rfqs.evaluate", "rfqs.clarify", "rfqs.recommendAward",
  "purchaseOrders.view", "purchaseOrders.create",
  "goodsReceipts.view", "invoices.view",
  "contracts.view", "documents.view", "documents.upload",
  "reports.view", "budgets.view", "ai.assistant",
];

/**
 * The roles installed for a new organization.
 *
 * The set covers every role named in §5 of the mandate. Where a role has no
 * counterpart in the legacy `UserRole` enum its `legacyRole` is null: such roles
 * are held through `UserRoleAssignment` and targeted in workflows by id, which is
 * exactly the path that lets an organization add its own.
 */
export const SYSTEM_ROLES: SystemRole[] = [
  {
    key: "ADMINISTRATOR",
    name: "Administrator",
    description: "Full control of the organization, its people and its configuration.",
    rank: 100,
    legacyRole: "SUPER_ADMIN",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "EXECUTIVE",
    name: "Executive",
    description: "Organization-wide visibility and final approval on high-value spend.",
    rank: 90,
    legacyRole: null,
    permissions: [
      "requests.view", "requests.approve", "requests.reject", "requests.comment",
      "vendors.view", "vendors.approve", "vendors.notes",
      "rfqs.view", "rfqs.evaluate", "rfqs.approveAward",
      "purchaseOrders.view", "purchaseOrders.approve",
      "goodsReceipts.view", "invoices.view", "payments.view", "payments.approve",
      "contracts.view", "documents.view",
      "reports.view", "reports.export", "budgets.view", "audit.view", "ai.assistant",
    ],
  },
  {
    key: "PROCUREMENT_MANAGER",
    name: "Procurement Manager",
    description: "Owns sourcing and purchase orders end to end.",
    rank: 70,
    legacyRole: "PROCUREMENT_MANAGER",
    permissions: ROLE_PERMISSIONS.PROCUREMENT_MANAGER,
  },
  {
    key: "PROCUREMENT_OFFICER",
    name: "Procurement Officer",
    description: "Runs RFQs and prepares purchase orders; cannot issue or approve them.",
    rank: 50,
    legacyRole: null,
    permissions: SOURCING,
  },
  {
    key: "FINANCE_MANAGER",
    name: "Finance Manager",
    description: "Owns budgets and authorises payment.",
    rank: 70,
    legacyRole: null,
    permissions: [
      ...ROLE_PERMISSIONS.FINANCE_OFFICER,
      "budgets.manage", "payments.approve", "payments.process", "payments.reconcile",
      "reports.export", "settings.view",
    ],
  },
  {
    key: "FINANCE_OFFICER",
    name: "Finance Officer",
    description: "Processes invoices and prepares payments for authorisation.",
    rank: 50,
    legacyRole: "FINANCE_OFFICER",
    permissions: ROLE_PERMISSIONS.FINANCE_OFFICER.filter((p) => p !== "payments.approve"),
  },
  {
    key: "DEPARTMENT_MANAGER",
    name: "Department Manager",
    description: "Approves spend for their department and owns its budget position.",
    rank: 60,
    legacyRole: "DEPARTMENT_MANAGER",
    permissions: ROLE_PERMISSIONS.DEPARTMENT_MANAGER,
  },
  {
    key: "APPROVER",
    name: "Approver",
    description: "Approves requests routed to them without other procurement rights.",
    rank: 55,
    legacyRole: null,
    permissions: [
      "requests.view", "requests.approve", "requests.reject", "requests.comment",
      "purchaseOrders.view", "budgets.view", "documents.view", "ai.assistant",
    ],
  },
  {
    key: "VENDOR_MANAGER",
    name: "Vendor Manager",
    description: "Owns the supplier master: onboarding, compliance, risk and performance.",
    rank: 50,
    legacyRole: null,
    permissions: [
      "vendors.view", "vendors.create", "vendors.edit", "vendors.archive",
      "vendors.approve", "vendors.suspend", "vendors.compliance", "vendors.risk", "vendors.notes", "vendors.portal",
      "contracts.view", "contracts.manage",
      "rfqs.view", "purchaseOrders.view", "invoices.view",
      "documents.view", "documents.upload", "reports.view", "ai.assistant",
    ],
  },
  {
    key: "WAREHOUSE_OFFICER",
    name: "Warehouse / Receiving Officer",
    description: "Records deliveries and posts them to stock.",
    rank: 40,
    legacyRole: null,
    permissions: [
      "purchaseOrders.view",
      "goodsReceipts.view", "goodsReceipts.create", "goodsReceipts.post",
      "inventory.view", "inventory.manage",
      "assets.view", "documents.view", "documents.upload", "ai.assistant",
    ],
  },
  {
    key: "ASSET_MANAGER",
    name: "Asset Manager",
    description: "Owns the asset register from receipt through to disposal.",
    rank: 40,
    legacyRole: null,
    permissions: [
      "purchaseOrders.view", "goodsReceipts.view",
      "assets.view", "assets.manage", "inventory.view",
      "documents.view", "documents.upload", "reports.view", "ai.assistant",
    ],
  },
  {
    key: "EVALUATOR",
    name: "Evaluator",
    description:
      "Sits on RFQ evaluation panels: scores the bids they are assigned and nothing more.",
    rank: 45,
    legacyRole: null,
    // Deliberately narrow. An evaluator holds "rfqs.view" because they must read
    // the RFQ they are judging, but the service still checks panel membership
    // before showing them a bid — the permission opens the module, the seat opens
    // the document.
    permissions: [
      "rfqs.view", "rfqs.evaluate",
      "vendors.view", "documents.view", "ai.assistant",
    ],
  },
  {
    key: "REQUESTER",
    name: "Requester",
    description: "Raises purchase requests on behalf of their department.",
    rank: 20,
    legacyRole: null,
    permissions: REQUESTER,
  },
  {
    key: "EMPLOYEE",
    name: "Employee",
    description: "Raises their own requests and follows their progress.",
    rank: 10,
    legacyRole: "EMPLOYEE",
    permissions: ROLE_PERMISSIONS.EMPLOYEE,
  },
  {
    key: "AUDITOR",
    name: "Auditor",
    description: "Reads everything, changes nothing.",
    rank: 30,
    legacyRole: "AUDITOR",
    permissions: ROLE_PERMISSIONS.AUDITOR,
  },
];

/** Rejects any permission string the application has no gate for. */
export function assertKnownPermissions(permissions: string[]): Permission[] {
  const unknown = permissions.filter((p) => !PERMISSION_SET.has(p));
  if (unknown.length > 0) {
    throw validation("Unknown permission", [
      { path: "permissions", message: `Not in the permission catalog: ${unknown.join(", ")}` },
    ]);
  }
  return permissions as Permission[];
}

/**
 * Installs the starting role set for an organization.
 *
 * Idempotent, and deliberately non-destructive: a role that already exists keeps
 * whatever permissions the organization has configured for it. Only its
 * descriptive fields are refreshed, and only when they have actually drifted, so
 * re-running this never silently restores an access grant an administrator
 * removed — and never spends a write to change nothing.
 *
 * Written in bulk rather than role by role, which is not premature optimization
 * but a correctness fix. This runs inside the provisioning transaction, and the
 * previous version issued one `create` per role, each carrying a nested write for
 * its permissions — roughly thirty sequential round trips for the fifteen roles
 * below. Against a pooled database in another region that exceeded Prisma's
 * 30-second interactive transaction timeout, so the transaction expired
 * mid-flight and *every* sign-up on a fresh organization failed with P2028. The
 * three statements here do the same work in three round trips.
 */
export async function ensureSystemRoles(organizationId: string, client: Tx) {
  const existing = await client.role.findMany({
    where: { organizationId },
    // Enough to tell whether a refresh is warranted, so the common case — nothing
    // has drifted — costs no writes at all.
    select: { id: true, key: true, name: true, description: true, rank: true, isSystem: true },
  });
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const missing = SYSTEM_ROLES.filter((role) => !byKey.has(role.key));

  if (missing.length > 0) {
    await client.role.createMany({
      data: missing.map((role) => ({
        organizationId,
        key: role.key,
        name: role.name,
        description: role.description,
        rank: role.rank,
        isSystem: true,
        legacyRole: role.legacyRole,
      })),
      // Two provisioning attempts racing over the same organization would
      // otherwise collide on the (organizationId, key) unique index; the loser
      // adopts what the winner wrote, which is the same thing it meant to write.
      skipDuplicates: true,
    });

    // The ids are needed to attach permissions, and `createMany` does not return
    // rows. One read is still far cheaper than fifteen nested creates.
    const created = await client.role.findMany({
      where: { organizationId, key: { in: missing.map((r) => r.key) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(created.map((r) => [r.key, r.id]));

    const permissions = missing.flatMap((role) => {
      const roleId = idByKey.get(role.key);
      if (!roleId) return [];
      // Deduplicated: several role definitions are composed from others, and a
      // permission granted twice is the same grant, not a conflict.
      return [...new Set(role.permissions)].map((permission) => ({ roleId, permission }));
    });

    if (permissions.length > 0) {
      await client.rolePermission.createMany({ data: permissions, skipDuplicates: true });
    }
  }

  // Descriptive drift on roles that already existed. Almost always empty, so this
  // loop almost always costs nothing.
  for (const role of SYSTEM_ROLES) {
    const current = byKey.get(role.key);
    if (!current) continue;
    if (
      current.name === role.name &&
      current.description === role.description &&
      current.rank === role.rank &&
      current.isSystem
    ) {
      continue;
    }
    await client.role.update({
      where: { id: current.id },
      data: { name: role.name, description: role.description, rank: role.rank, isSystem: true },
    });
  }

  return client.role.findMany({ where: { organizationId }, orderBy: { rank: "desc" } });
}

/** Replaces a role's permission set. Validated against the catalog first. */
export async function setRolePermissions(
  roleId: string,
  permissions: string[],
  client: Tx
): Promise<Permission[]> {
  const valid = assertKnownPermissions(permissions);
  await client.rolePermission.deleteMany({ where: { roleId } });
  if (valid.length > 0) {
    await client.rolePermission.createMany({
      data: valid.map((permission) => ({ roleId, permission })),
    });
  }
  return valid;
}

/** Grants a role to a user, optionally scoped to one department. */
export async function assignRole(
  input: {
    organizationId: string;
    userId: string;
    roleKey: string;
    departmentId?: string | null;
    grantedById?: string | null;
    expiresAt?: Date | null;
  },
  client: Tx
) {
  const role = await client.role.findUnique({
    where: { organizationId_key: { organizationId: input.organizationId, key: input.roleKey } },
  });
  if (!role) {
    throw validation("Unknown role", [
      { path: "roleKey", message: `No role "${input.roleKey}" in this organization` },
    ]);
  }

  // Not an upsert: the composite unique carries a nullable departmentId, and in
  // Postgres two NULLs never collide — so an upsert keyed on it would create a
  // duplicate grant every time a role was assigned organization-wide.
  const existing = await client.userRoleAssignment.findFirst({
    where: {
      userId: input.userId,
      roleId: role.id,
      departmentId: input.departmentId ?? null,
    },
  });

  if (existing) {
    return client.userRoleAssignment.update({
      where: { id: existing.id },
      data: { expiresAt: input.expiresAt ?? null, grantedById: input.grantedById ?? existing.grantedById },
    });
  }

  return client.userRoleAssignment.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      roleId: role.id,
      departmentId: input.departmentId ?? null,
      grantedById: input.grantedById ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

/** Users holding a role right now, by role key. Used to resolve approvers. */
export async function usersWithRoleKey(
  organizationId: string,
  roleKey: string,
  client: Tx,
  departmentId: string | null = null
) {
  const now = new Date();
  return client.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      roleAssignments: {
        some: {
          role: { key: roleKey, isActive: true },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ...(departmentId ? { OR: [{ departmentId: null }, { departmentId }] } : {}),
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}
