// NextMav Procure — service context.
//
// Every service call takes one of these. Bundling the principal with the request
// metadata means a service can never be written that performs a mutation without
// having the identity available to authorize and audit it.

import type { RequestContext } from "../audit";
import type { InternalPrincipal, SupplierPrincipal } from "../session";
import { tenantDb, type TenantClient } from "../tenancy";

export interface ServiceContext {
  principal: InternalPrincipal;
  context: RequestContext;
}

export interface SupplierServiceContext {
  principal: SupplierPrincipal;
  context: RequestContext;
}

/** Tenant-scoped client for the caller's organization. */
export function scoped(ctx: ServiceContext | SupplierServiceContext): TenantClient {
  return tenantDb(ctx.principal.organizationId);
}

export const orgOf = (ctx: ServiceContext | SupplierServiceContext) =>
  ctx.principal.organizationId;

export const actorOf = (ctx: ServiceContext) => ctx.principal.userId;

/** Standard envelope for every paginated collection endpoint. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Translates `?sort=field&dir=asc` into a Prisma orderBy, with an allowlist. */
export function orderBy(
  sort: string | undefined,
  dir: "asc" | "desc",
  allowed: readonly string[],
  fallback: string
): Record<string, "asc" | "desc"> {
  const field = sort && allowed.includes(sort) ? sort : fallback;
  return { [field]: dir };
}
