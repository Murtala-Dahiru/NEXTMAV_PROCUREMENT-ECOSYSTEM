// NextMav Procure — server-side authorization.
//
// This is the authority. The `useHasPermission` hook in the client is a UI
// affordance that decides whether to render a button; it is not a control.
// Every mutating service call must pass through `assertPermission` or an
// explicit, commented decision that no permission gate applies.
//
// Resolution order for a user's effective permissions:
//   1. per-user `customPermissions` (a full replacement, if set)
//   2. per-organization `RolePermissionOverride` for the role (a full replacement)
//   3. the built-in `ROLE_PERMISSIONS` default for the role

import type { UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/types";
import { db } from "./db";
import { forbidden } from "./errors";
import type { InternalPrincipal } from "./session";

export type { Permission };

/** Per-request memo so a handler touching several gates issues one override query. */
type OverrideCache = Map<string, Permission[] | null>;
const overrideCaches = new WeakMap<object, OverrideCache>();

function cacheFor(principal: InternalPrincipal): OverrideCache {
  let c = overrideCaches.get(principal);
  if (!c) {
    c = new Map();
    overrideCaches.set(principal, c);
  }
  return c;
}

async function roleOverride(
  principal: InternalPrincipal
): Promise<Permission[] | null> {
  const cache = cacheFor(principal);
  const key = `${principal.organizationId}:${principal.role}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const row = await db.rolePermissionOverride.findUnique({
    where: {
      organizationId_role: {
        organizationId: principal.organizationId,
        role: principal.role,
      },
    },
  });

  let result: Permission[] | null = null;
  if (row) {
    try {
      const parsed = JSON.parse(row.permissions);
      if (Array.isArray(parsed)) result = parsed as Permission[];
    } catch {
      result = null;
    }
  }

  cache.set(key, result);
  return result;
}

export async function effectivePermissions(
  principal: InternalPrincipal
): Promise<Permission[]> {
  if (principal.customPermissions) return principal.customPermissions as Permission[];
  const override = await roleOverride(principal);
  if (override) return override;
  return ROLE_PERMISSIONS[principal.role as UserRole] ?? [];
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
