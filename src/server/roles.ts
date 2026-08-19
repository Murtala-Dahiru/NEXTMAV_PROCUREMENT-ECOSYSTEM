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

const SOURCING: Permission[] = [
  "requests.view", "requests.comment",
  "vendors.view", "vendors.create", "vendors.edit",
  "rfqs.view", "rfqs.create", "rfqs.issue", "rfqs.cancel", "rfqs.selectQuotation",
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
      "vendors.view", "rfqs.view", "purchaseOrders.view", "purchaseOrders.approve",
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
 * descriptive fields are refreshed, so re-running this never silently restores
 * an access grant an administrator removed.
 */
export async function ensureSystemRoles(organizationId: string, client: Tx) {
  const existing = await client.role.findMany({
    where: { organizationId },
    select: { id: true, key: true },
  });
  const byKey = new Map(existing.map((r) => [r.key, r.id]));

  for (const role of SYSTEM_ROLES) {
    const id = byKey.get(role.key);
    if (id) {
      await client.role.update({
        where: { id },
        data: { name: role.name, description: role.description, rank: role.rank, isSystem: true },
      });
      continue;
    }
    await client.role.create({
      data: {
        organizationId,
        key: role.key,
        name: role.name,
        description: role.description,
        rank: role.rank,
        isSystem: true,
        legacyRole: role.legacyRole,
        // Deduplicated: several role definitions are composed from others, and a
        // permission granted twice is the same grant, not a conflict.
        permissions: {
          create: [...new Set(role.permissions)].map((permission) => ({ permission })),
        },
      },
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
