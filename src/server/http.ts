// NextMav Procure — route handler plumbing.
//
// Every API route is wrapped by one of these. The wrapper is what guarantees that
// a route cannot accidentally ship without authentication, tenant scoping, input
// validation or error translation — those are not left to the author of each route.
//
//   withUser     — requires an employee session; supplies a tenant-scoped client.
//   withSupplier — requires a supplier session; supplies the vendor id only.
//   withPublic   — no session (login, health). Still rate-limited.

import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { AppError, rateLimited, unauthenticated, validation } from "./errors";
import { getInternalPrincipal, getSupplierPrincipal, type InternalPrincipal, type SupplierPrincipal } from "./session";
import { tenantDb, type TenantClient } from "./tenancy";
import { requestContext, type RequestContext } from "./audit";
import { db } from "./db";

export interface UserCtx<P = Record<string, string>> {
  req: NextRequest;
  params: P;
  principal: InternalPrincipal;
  /** Tenant-scoped Prisma client. Prefer this over importing `db` directly. */
  tdb: TenantClient;
  organizationId: string;
  context: RequestContext;
}

export interface SupplierCtx<P = Record<string, string>> {
  req: NextRequest;
  params: P;
  principal: SupplierPrincipal;
  organizationId: string;
  vendorId: string;
  context: RequestContext;
}

export interface PublicCtx<P = Record<string, string>> {
  req: NextRequest;
  params: P;
  context: RequestContext;
}

type NextRouteArgs<P> = { params: Promise<P> };

function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? undefined } },
      { status: err.status }
    );
  }

  // Anything unrecognised is a bug. Log it in full server-side; return nothing
  // useful to the caller, because stack traces and Prisma messages leak schema.
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "An unexpected error occurred" } },
    { status: 500 }
  );
}

function ok(result: unknown): NextResponse {
  if (result instanceof NextResponse) return result;
  if (result === undefined) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimit {
  /** Max requests allowed in the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Distinguishes buckets for different routes. */
  bucket: string;
  /**
   * Derives the bucket key from the request. Defaults to the caller's identity
   * (user id, or IP for unauthenticated routes).
   *
   * Login uses this to key on the submitted email instead: keying purely on IP
   * means one office behind a single NAT address locks itself out, while an
   * attacker with a botnet is barely slowed. Per-account is the throttle that
   * actually matches the threat.
   */
  keyFrom?: (req: NextRequest, body: unknown) => string | null;
}

/**
 * Fixed-window counter backed by the database, so the limit holds across
 * server instances rather than only within one process.
 */
async function enforceRateLimit(key: string, rl: RateLimit): Promise<void> {
  const now = new Date();
  const fullKey = `${rl.bucket}:${key}`;

  const existing = await db.rateLimitBucket.findUnique({ where: { key: fullKey } });

  if (!existing || existing.expiresAt <= now) {
    await db.rateLimitBucket.upsert({
      where: { key: fullKey },
      create: { key: fullKey, count: 1, expiresAt: new Date(now.getTime() + rl.windowSec * 1000) },
      update: { count: 1, expiresAt: new Date(now.getTime() + rl.windowSec * 1000) },
    });
    return;
  }

  if (existing.count >= rl.limit) {
    throw rateLimited(
      `Rate limit exceeded. Try again in ${Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000)}s.`
    );
  }

  await db.rateLimitBucket.update({
    where: { key: fullKey },
    data: { count: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

/** Parses and validates a JSON body, throwing a 422 with field details on failure. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw validation("Request body must be valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw validation("Validation failed", {
      issues: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return result.data;
}

/** Parses and validates the query string. */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw validation("Invalid query parameters", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

export function withUser<P = Record<string, string>>(
  handler: (ctx: UserCtx<P>) => Promise<unknown>,
  options?: { rateLimit?: RateLimit }
) {
  return async (req: NextRequest, args?: NextRouteArgs<P>): Promise<NextResponse> => {
    try {
      const principal = await getInternalPrincipal();
      if (!principal) throw unauthenticated();

      if (options?.rateLimit) {
        await enforceRateLimit(principal.userId, options.rateLimit);
      }

      const params = ((await args?.params) ?? {}) as P;
      const context = await requestContext();

      return ok(
        await handler({
          req,
          params,
          principal,
          tdb: tenantDb(principal.organizationId),
          organizationId: principal.organizationId,
          context,
        })
      );
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function withSupplier<P = Record<string, string>>(
  handler: (ctx: SupplierCtx<P>) => Promise<unknown>,
  options?: { rateLimit?: RateLimit }
) {
  return async (req: NextRequest, args?: NextRouteArgs<P>): Promise<NextResponse> => {
    try {
      const principal = await getSupplierPrincipal();
      if (!principal) throw unauthenticated();

      if (options?.rateLimit) {
        await enforceRateLimit(principal.supplierUserId, options.rateLimit);
      }

      const params = ((await args?.params) ?? {}) as P;
      const context = await requestContext();

      return ok(
        await handler({
          req,
          params,
          principal,
          organizationId: principal.organizationId,
          vendorId: principal.vendorId,
          context,
        })
      );
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function withPublic<P = Record<string, string>>(
  handler: (ctx: PublicCtx<P>) => Promise<unknown>,
  options?: { rateLimit?: RateLimit }
) {
  return async (req: NextRequest, args?: NextRouteArgs<P>): Promise<NextResponse> => {
    try {
      const context = await requestContext();

      if (options?.rateLimit) {
        let key = context.ipAddress ?? "unknown";
        if (options.rateLimit.keyFrom) {
          // Read the body once and hand the parsed copy to the handler, so the
          // stream is not consumed twice.
          const cloned = req.clone();
          let body: unknown = null;
          try { body = await cloned.json(); } catch { body = null; }
          key = options.rateLimit.keyFrom(req, body) ?? key;
        }
        await enforceRateLimit(key, options.rateLimit);
      }

      const params = ((await args?.params) ?? {}) as P;
      return ok(await handler({ req, params, context }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}
