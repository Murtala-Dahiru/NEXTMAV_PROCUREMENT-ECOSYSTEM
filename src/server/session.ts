// NextMav Procure — session management.
//
// Two entirely separate authentication realms:
//
//   INTERNAL  — employees. Cookie `nextmav.sid`.   Table `Session`.
//   SUPPLIER  — external vendor contacts. Cookie `nextmav.supplier_sid`. Table `SupplierSession`.
//
// They use different cookies, different tables and different resolver functions.
// There is deliberately no shared "session type" discriminator: a supplier token
// can never be presented to the internal resolver and vice versa, so a bug in one
// realm cannot escalate into the other. See docs/PLATFORM_AUDIT.md §7.
//
// Tokens are random 32-byte values. Only their SHA-256 is stored, so a dump of the
// session table does not let the holder impersonate anyone.

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

export const INTERNAL_COOKIE = "nextmav.sid";
export const SUPPLIER_COOKIE = "nextmav.supplier_sid";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
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

export async function createUserSession(userId: string, meta: RequestMeta = {}) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await db.session.create({
    data: {
      sessionToken: fingerprint(token),
      userId,
      expires,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const jar = await cookies();
  jar.set(INTERNAL_COOKIE, token, cookieOptions(expires));
  return { token, expires };
}

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

/** Resolves the current employee session, or null. Never throws. */
export async function getInternalPrincipal(): Promise<InternalPrincipal | null> {
  const jar = await cookies();
  const token = jar.get(INTERNAL_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { sessionToken: fingerprint(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expires.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const user = session.user;
  // A suspended or deactivated account must lose access immediately, without
  // waiting for its session to expire.
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
    sessionId: session.id,
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

export async function destroyUserSession() {
  const jar = await cookies();
  const token = jar.get(INTERNAL_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { sessionToken: fingerprint(token) } }).catch(() => {});
  }
  jar.delete(INTERNAL_COOKIE);
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
  const [internal, supplier] = await Promise.all([
    db.session.deleteMany({ where: { expires: { lte: now } } }),
    db.supplierSession.deleteMany({ where: { expires: { lte: now } } }),
  ]);
  return { internal: internal.count, supplier: supplier.count };
}
