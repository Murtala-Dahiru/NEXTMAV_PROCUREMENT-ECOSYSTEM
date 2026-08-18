// NextMav Procure — authentication service.
//
// Both realms share one rule: the caller learns only "those credentials did not
// work". Never "no such account", never "wrong password", never "your account is
// suspended" — each of those is an account-enumeration oracle. The reason is
// recorded server-side in the audit log where an administrator can see it.

import { db } from "../db";
import { AppError, unauthenticated } from "../errors";
import { hashPassword, needsRehash, verifyPassword } from "../password";
import { recordActivity, recordAudit, type RequestContext } from "../audit";
import {
  createSupplierSession,
  createUserSession,
  destroySupplierSession,
  destroyUserSession,
} from "../session";

const GENERIC_FAILURE = "Incorrect email or password";

// ---------------------------------------------------------------------------
// Internal users
// ---------------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  context: RequestContext
) {
  const normalised = email.trim().toLowerCase();

  // Not `findUnique` — email is unique per organization, not globally, and this
  // login form is org-agnostic. Where one address exists in several tenants the
  // active account wins; a genuine multi-org login picker is a P3 concern.
  const candidates = await db.user.findMany({
    where: { email: normalised },
    orderBy: { createdAt: "asc" },
  });

  const user = candidates.find((u) => u.status === "ACTIVE") ?? candidates[0] ?? null;

  // Always run the verification so the response time does not reveal whether the
  // address exists. `verifyPassword` burns equivalent work when the hash is null.
  const passwordOk = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordOk) {
    if (user) {
      await recordAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "auth.login_failed",
        resource: "User",
        resourceId: user.id,
        after: { reason: "bad_password" },
        context,
      });
    }
    throw unauthenticated(GENERIC_FAILURE);
  }

  if (user.status !== "ACTIVE") {
    await recordAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "auth.login_denied",
      resource: "User",
      resourceId: user.id,
      after: { reason: `status_${user.status.toLowerCase()}` },
      context,
    });
    // Correct credentials but an unusable account still yields the generic message.
    throw unauthenticated(GENERIC_FAILURE);
  }

  // Transparently upgrade hashes created under weaker parameters.
  if (needsRehash(user.passwordHash)) {
    await db.user
      .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      .catch(() => {});
  }

  await createUserSession(user.id, context);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "auth.login",
    resource: "User",
    resourceId: user.id,
    context,
  });
  await recordActivity({
    organizationId: user.organizationId,
    userId: user.id,
    eventType: "USER_LOGIN",
    description: `${user.name} signed in`,
    context,
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
}

export async function logoutUser(
  principal: { userId: string; organizationId: string; name: string } | null,
  context: RequestContext
) {
  if (principal) {
    await recordAudit({
      organizationId: principal.organizationId,
      userId: principal.userId,
      action: "auth.logout",
      resource: "User",
      resourceId: principal.userId,
      context,
    });
    await recordActivity({
      organizationId: principal.organizationId,
      userId: principal.userId,
      eventType: "USER_LOGOUT",
      description: `${principal.name} signed out`,
      context,
    });
  }
  await destroyUserSession();
}

export async function changeOwnPassword(
  userId: string,
  organizationId: string,
  currentPassword: string,
  newPassword: string,
  context: RequestContext
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthenticated();

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await recordAudit({
      organizationId,
      userId,
      action: "auth.password_change_failed",
      resource: "User",
      resourceId: userId,
      context,
    });
    throw new AppError("VALIDATION", "Current password is incorrect");
  }

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Every other session for this user dies, so a password change actually evicts
  // an attacker who already had one.
  await db.session.deleteMany({ where: { userId } });
  await createUserSession(userId, context);

  await recordAudit({
    organizationId,
    userId,
    action: "auth.password_changed",
    resource: "User",
    resourceId: userId,
    context,
  });
}

// ---------------------------------------------------------------------------
// Supplier users
// ---------------------------------------------------------------------------

export async function loginSupplier(
  email: string,
  password: string,
  context: RequestContext
) {
  const normalised = email.trim().toLowerCase();

  const candidates = await db.supplierUser.findMany({
    where: { email: normalised },
    include: { vendor: true },
    orderBy: { createdAt: "asc" },
  });

  const su = candidates.find((s) => s.accessStatus === "ACTIVE") ?? candidates[0] ?? null;
  const passwordOk = await verifyPassword(password, su?.passwordHash);

  if (!su || !passwordOk || su.accessStatus !== "ACTIVE") {
    if (su) {
      await recordAudit({
        organizationId: su.organizationId,
        supplierUserId: su.id,
        action: "supplier_auth.login_failed",
        resource: "SupplierUser",
        resourceId: su.id,
        after: { reason: !passwordOk ? "bad_password" : `status_${su.accessStatus.toLowerCase()}` },
        context,
      });
    }
    throw unauthenticated(GENERIC_FAILURE);
  }

  // A supplier whose vendor record was blacklisted or archived loses portal access
  // immediately — the vendor status is the authority, not the portal user row.
  if (su.vendor.status === "BLACKLISTED" || su.vendor.status === "ARCHIVED") {
    await recordAudit({
      organizationId: su.organizationId,
      supplierUserId: su.id,
      action: "supplier_auth.login_denied",
      resource: "SupplierUser",
      resourceId: su.id,
      after: { reason: `vendor_${su.vendor.status.toLowerCase()}` },
      context,
    });
    throw unauthenticated(GENERIC_FAILURE);
  }

  await createSupplierSession(su.id, context);
  await db.supplierUser.update({ where: { id: su.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    organizationId: su.organizationId,
    supplierUserId: su.id,
    action: "supplier_auth.login",
    resource: "SupplierUser",
    resourceId: su.id,
    context,
  });
  await db.supplierActivity.create({
    data: {
      vendorId: su.vendorId,
      type: "MESSAGE_RECEIVED",
      description: `${su.contactName} signed in to the supplier portal`,
    },
  });

  return {
    id: su.id,
    contactName: su.contactName,
    email: su.email,
    vendorId: su.vendorId,
    vendorName: su.vendor.companyName,
  };
}

export async function logoutSupplier(
  principal: { supplierUserId: string; organizationId: string } | null,
  context: RequestContext
) {
  if (principal) {
    await recordAudit({
      organizationId: principal.organizationId,
      supplierUserId: principal.supplierUserId,
      action: "supplier_auth.logout",
      resource: "SupplierUser",
      resourceId: principal.supplierUserId,
      context,
    });
  }
  await destroySupplierSession();
}

/** Sets the initial password for an invited supplier contact. */
export async function activateSupplierAccount(
  token: string,
  password: string,
  context: RequestContext
) {
  const su = await db.supplierUser.findUnique({ where: { inviteToken: token } });

  if (!su || !su.inviteExpiresAt || su.inviteExpiresAt.getTime() < Date.now()) {
    throw new AppError("VALIDATION", "This invitation link is invalid or has expired");
  }
  if (su.accessStatus === "REVOKED" || su.accessStatus === "SUSPENDED") {
    throw new AppError("VALIDATION", "This invitation is no longer available");
  }

  await db.supplierUser.update({
    where: { id: su.id },
    data: {
      passwordHash: await hashPassword(password),
      accessStatus: "ACTIVE",
      inviteToken: null,
      inviteExpiresAt: null,
    },
  });

  await recordAudit({
    organizationId: su.organizationId,
    supplierUserId: su.id,
    action: "supplier_auth.activated",
    resource: "SupplierUser",
    resourceId: su.id,
    context,
  });

  await createSupplierSession(su.id, context);
  return { id: su.id, email: su.email, vendorId: su.vendorId };
}
