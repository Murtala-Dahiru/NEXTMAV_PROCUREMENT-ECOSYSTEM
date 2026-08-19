// NextMav Procure — server-side authorization.
//
// This is the authority. The `useHasPermission` hook in the client is a UI
// affordance that decides whether to render a button; it is not a control.
// Every mutating service call must pass through `assertPermission` or an
// explicit, commented decision that no permission gate applies.
//
// Resolution order for a user's effective permissions:
//
//   1. per-user `customPermissions` — a full replacement, if set
//   2. the union of the permissions granted by every role the user holds
//      (`UserRoleAssignment` → `Role` → `RolePermission`), which is the
//      configurable path an organization actually administers
//   3. the `Role` row matching the user's legacy `role` enum value, for accounts
//      created before any role was assigned to them
//   4. the built-in `ROLE_PERMISSIONS` default for that enum value, so a database
//      with no roles installed still authorises correctly rather than locking
//      everybody out
//
// Steps 3 and 4 are bootstrap paths, not a second configuration surface: as soon
// as a user holds a role, the database is the only thing consulted.

import type { UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/types";
import { db } from "./db";
import { forbidden } from "./errors";
import type { InternalPrincipal } from "./session";

export type { Permission };

/** Per-request memo so a handler touching several gates issues one query. */
type PermissionCache = Map<string, Permission[]>;
const caches = new WeakMap<object, PermissionCache>();

function cacheFor(principal: InternalPrincipal): PermissionCache {
  let c = caches.get(principal);
  if (!c) {
    c = new Map();
    caches.set(principal, c);
  }
  return c;
}

/** Permissions granted by the roles the user currently holds. */
async function permissionsFromAssignedRoles(
  principal: InternalPrincipal
): Promise<Permission[] | null> {
  const now = new Date();
  const assignments = await db.userRoleAssignment.findMany({
    where: {
      userId: principal.userId,
      organizationId: principal.organizationId,
      role: { isActive: true },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { role: { select: { permissions: { select: { permission: true } } } } },
  });

  if (assignments.length === 0) return null;

  const held = new Set<string>();
  for (const a of assignments) {
    for (const p of a.role.permissions) held.add(p.permission);
  }
  return [...held] as Permission[];
}

/** Permissions of the Role row that corresponds to the user's legacy enum role. */
async function permissionsFromLegacyRole(
  principal: InternalPrincipal
): Promise<Permission[] | null> {
  const role = await db.role.findFirst({
    where: {
      organizationId: principal.organizationId,
      legacyRole: principal.role,
      isActive: true,
    },
    select: { permissions: { select: { permission: true } } },
  });
  if (!role) return null;
  return role.permissions.map((p) => p.permission) as Permission[];
}

export async function effectivePermissions(
  principal: InternalPrincipal
): Promise<Permission[]> {
  if (principal.customPermissions) return principal.customPermissions as Permission[];

  const cache = cacheFor(principal);
  const key = `${principal.organizationId}:${principal.userId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const resolved =
    (await permissionsFromAssignedRoles(principal)) ??
    (await permissionsFromLegacyRole(principal)) ??
    ROLE_PERMISSIONS[principal.role as UserRole] ??
    [];

  cache.set(key, resolved);
  return resolved;
}

export async function can(
  principal: InternalPrincipal,
  permission: Permission
): Promise<boolean> {
  const perms = await effectivePermissions(principal);
  return perms.includes(permission);
}

/** Throws `FORBIDDEN` unless the principal holds the permission. */
export async function assertPermission(
  principal: InternalPrincipal,
  permission: Permission
): Promise<void> {
  if (!(await can(principal, permission))) {
    throw forbidden(`Missing permission: ${permission}`);
  }
}

/** Throws unless the principal holds at least one of the permissions. */
export async function assertAnyPermission(
  principal: InternalPrincipal,
  permissions: Permission[]
): Promise<void> {
  const held = await effectivePermissions(principal);
  if (!permissions.some((p) => held.includes(p))) {
    throw forbidden(`Missing one of: ${permissions.join(", ")}`);
  }
}

/**
 * Ownership gate for records a user may only touch when they created them.
 * `editAll` short-circuits it — e.g. a procurement manager editing anyone's request.
 */
export async function assertOwnerOrPermission(
  principal: InternalPrincipal,
  ownerId: string,
  editAll: Permission
): Promise<void> {
  if (principal.userId === ownerId) return;
  await assertPermission(principal, editAll);
}
