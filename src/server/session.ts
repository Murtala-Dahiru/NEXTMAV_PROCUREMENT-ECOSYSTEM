// NextMav Procure — session management.
//
// Two entirely separate authentication realms:
//
//   INTERNAL  — employees. Sessions issued and held by Supabase Auth.
//   SUPPLIER  — external vendor contacts. Cookie `nextmav.supplier_sid`. Table `SupplierSession`.
//
// They use different mechanisms entirely and different resolver functions. There
// is deliberately no shared "session type" discriminator: a supplier token can
// never be presented to the internal resolver and vice versa, so a bug in one
// realm cannot escalate into the other. See docs/PLATFORM_AUDIT.md §7.
//
// The internal realm delegates credentials, email verification and password
// recovery to Supabase Auth. What this module still owns is the step Supabase
// knows nothing about: turning an authenticated `auth.users.id` into a NextMav
// principal — organization, role and permission scope. Every API route reaches
// authorization through `getInternalPrincipal`, so that mapping is the single
// place tenancy is established.
//
// Supplier tokens remain random 32-byte values stored only as their SHA-256, so a
// dump of the supplier session table does not let the holder impersonate anyone.

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { supabaseServer } from "./supabase/server";

export const SUPPLIER_COOKIE = "nextmav.supplier_sid";

const SUPPLIER_SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Internal (employee) sessions
// ---------------------------------------------------------------------------

export interface InternalPrincipal {
  kind: "INTERNAL";
  sessionId: string;
  userId: string;
  organizationId: string;
  role: import("@prisma/client").UserRole;
  email: string;
  name: string;
  departmentId: string | null;
  branchId: string | null;
  /** JSON-decoded per-user permission overrides, if any. */
  customPermissions: string[] | null;
}

/**
 * Resolves the current employee session, or null. Never throws.
 *
 * Two independent checks have to pass, and both matter:
 *
 *   1. Supabase must vouch for the caller's identity. `getClaims()` verifies the
 *      access token's signature and expiry cryptographically. This project signs
 *      with ES256, an asymmetric algorithm, so verification happens locally
 *      through WebCrypto against a cached JWKS — no network round trip.
 *
 *      It is emphatically not `getSession()`, which decodes the cookie without
 *      verifying anything and would accept a forged token.
 *
 *      The alternative, `getUser()`, asks the Supabase auth server on every call.
 *      That is one extra network round trip *per authenticated request*, and on
 *      this deployment — a pooled database in another region — it roughly doubled
 *      the latency of every API call. What it buys is that an auth user deleted
 *      or banned directly in Supabase loses access instantly rather than when
 *      their access token expires. That window is bounded by the token lifetime
 *      (one hour by default) and applies only to changes made in the Supabase
 *      dashboard: a user deactivated *in NextMav* is still rejected immediately,
 *      by check 2 below, which reads the database on every request.
 *
 *   2. NextMav must recognise that identity as an active member of a tenant.
 *      An auth user with no `User` row, or one whose account was suspended, has
 *      no principal here regardless of how valid their Supabase session is.
 *
 * Memoized per render pass with React's `cache`, so a page that resolves the
 * principal in several components pays for one database read rather than one each.
 */
export const getInternalPrincipal = cache(
  async (): Promise<InternalPrincipal | null> => {
    let authUserId: string;

    try {
      const supabase = await supabaseServer();
      const { data, error } = await supabase.auth.getClaims();
      if (error || !data?.claims?.sub) return null;

      authUserId = data.claims.sub;

      // Belt and braces. Supabase will not issue a session to an unconfirmed
      // address while "Confirm email" is on, so holding a valid token already
      // implies verification; this rejects a token that positively asserts
      // otherwise. Absence is treated as verified on purpose — accounts created
      // through the admin API carry no such claim, and reading absence as
      // "unverified" would lock out every migrated user.
      const metadata = data.claims.user_metadata as
        | { email_verified?: boolean }
        | undefined;
      if (metadata?.email_verified === false) return null;
    } catch {
      // A failure to verify is not an authorization decision, but the only safe
      // answer to "who is this?" when we cannot tell is "nobody".
      return null;
    }

    const user = await db.user.findUnique({ where: { authUserId } });
    if (!user) return null;

    // A suspended or deactivated account must lose access immediately, without
    // waiting for its Supabase session to expire.
    if (user.status !== "ACTIVE") return null;

    let customPermissions: string[] | null = null;
    if (user.customPermissions) {
      try {
        const parsed = JSON.parse(user.customPermissions);
        if (Array.isArray(parsed)) customPermissions = parsed;
      } catch {
        customPermissions = null;
      }
    }

    return {
      kind: "INTERNAL",
      // The Supabase auth id, not a row in a local session table. Audit entries
      // key off `userId`; this field exists so a log line can be tied back to the
      // identity that produced it.
      sessionId: authUserId,
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
      name: user.name,
      departmentId: user.departmentId,
      branchId: user.branchId,
      customPermissions,
    };
  }
);

/**
 * Ends the employee session.
 *
 * `scope: "global"` revokes every refresh token for the account rather than only
 * this browser's. Signing out is the lever a user reaches for when they think
 * someone else has their session, so it should actually evict that someone.
 */
export async function destroyUserSession() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "global" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Supplier sessions
// ---------------------------------------------------------------------------

export async function createSupplierSession(supplierUserId: string, meta: RequestMeta = {}) {
  const token = newToken();
  const expires = new Date(Date.now() + SUPPLIER_SESSION_TTL_MS);

  await db.supplierSession.create({
    data: {
      sessionToken: fingerprint(token),
      supplierUserId,
      expires,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SUPPLIER_COOKIE, token, cookieOptions(expires));
  return { token, expires };
}

export interface SupplierPrincipal {
  kind: "SUPPLIER";
  sessionId: string;
  supplierUserId: string;
  vendorId: string;
  organizationId: string;
  email: string;
  contactName: string;
}

/**
 * Resolves the current supplier session, or null.
 *
 * Note what this deliberately does NOT return: no `role`, no `userId`, no
 * `departmentId`. A supplier principal is structurally incapable of satisfying
 * an internal permission check.
 */
export async function getSupplierPrincipal(): Promise<SupplierPrincipal | null> {
  const jar = await cookies();
  const token = jar.get(SUPPLIER_COOKIE)?.value;
  if (!token) return null;

  const session = await db.supplierSession.findUnique({
    where: { sessionToken: fingerprint(token) },
    include: { supplierUser: true },
  });

  if (!session) return null;
  if (session.expires.getTime() <= Date.now()) {
    await db.supplierSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const su = session.supplierUser;
  if (su.accessStatus !== "ACTIVE") return null;

  return {
    kind: "SUPPLIER",
    sessionId: session.id,
    supplierUserId: su.id,
    vendorId: su.vendorId,
    organizationId: su.organizationId,
    email: su.email,
    contactName: su.contactName,
  };
}

export async function destroySupplierSession() {
  const jar = await cookies();
  const token = jar.get(SUPPLIER_COOKIE)?.value;
  if (token) {
    await db.supplierSession
      .deleteMany({ where: { sessionToken: fingerprint(token) } })
      .catch(() => {});
  }
  jar.delete(SUPPLIER_COOKIE);
}

/** Housekeeping for expired rows in both realms. Safe to call from a cron route. */
export async function pruneExpiredSessions() {
  const now = new Date();
  // Only the supplier realm still keeps session rows. Internal sessions live in
  // Supabase, which expires its own refresh tokens. The `Session` table is left
  // in place because rows written before the cutover are still audit evidence;
  // this sweeps the expired ones so it drains rather than grows.
  const [internal, supplier] = await Promise.all([
    db.session.deleteMany({ where: { expires: { lte: now } } }),
    db.supplierSession.deleteMany({ where: { expires: { lte: now } } }),
  ]);
  return { internal: internal.count, supplier: supplier.count };
}
