// NextMav Procure — authentication service.
//
// Credentials for the internal realm are held by Supabase Auth. This module is
// what sits either side of it: translating a NextMav sign-in into a Supabase one,
// and translating Supabase's answer back into a NextMav principal and an audit
// trail. The supplier realm below is unchanged and still verifies scrypt hashes
// locally.
//
// Both realms share one rule: the caller learns only "those credentials did not
// work". Never "no such account", never "wrong password", never "your account is
// suspended" — each of those is an account-enumeration oracle. The reason is
// recorded server-side in the audit log where an administrator can see it.
//
// There is one deliberate exception. An unverified account is told so explicitly,
// because the alternative is a user who typed the right password being told it is
// wrong, with no route forward — and the verification email Supabase already sent
// has disclosed the account's existence to that address regardless.

import { db } from "../db";
import { AppError, unauthenticated } from "../errors";
import { hashPassword, verifyPassword } from "../password";
import { recordActivity, recordAudit, type RequestContext } from "../audit";
import {
  createSupplierSession,
  destroySupplierSession,
  destroyUserSession,
} from "../session";
import { supabaseServer } from "../supabase/server";

const GENERIC_FAILURE = "Incorrect email or password";

/** Raised when the password was right but the address has never been verified. */
export const EMAIL_UNVERIFIED = "EMAIL_UNVERIFIED";

// ---------------------------------------------------------------------------
// Internal users
// ---------------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  context: RequestContext
) {
  const normalised = email.trim().toLowerCase();
  const supabase = await supabaseServer();

  // Supabase verifies the credential and, on success, writes the session cookies
  // through the client's cookie adapter. This must therefore be called from a
  // Route Handler or Server Action, where writing cookies is permitted.
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalised,
    password,
  });

  if (error || !data.user) {
    // Supabase distinguishes an unconfirmed address from a bad password. Passing
    // that one distinction through is what lets the sign-in screen offer to
    // resend the verification email instead of stranding the user.
    if (error?.code === "email_not_confirmed") {
      throw new AppError(
        "UNAUTHENTICATED",
        "Your email address has not been verified yet. Check your inbox for the verification link.",
        { reason: EMAIL_UNVERIFIED, email: normalised }
      );
    }
    throw unauthenticated(GENERIC_FAILURE);
  }

  // Everything past this point runs with the Supabase session cookies ALREADY
  // written — `signInWithPassword` persists them through the client's cookie
  // adapter the moment the credential checks out. So any failure from here on has
  // to undo that, or the caller is told "sign-in failed" while holding a perfectly
  // valid session, and the next page load lets them in.
  //
  // That is not hypothetical: a transient P1001 from the database on the lookup
  // below produced exactly that state — an error on the screen, a signed-in
  // session in the jar. The two explicit rejections were already careful to sign
  // out; this makes the *unexpected* failures behave the same way.
  try {
    const user = await db.user.findUnique({ where: { authUserId: data.user.id } });

    // A valid Supabase identity with no NextMav user row means provisioning never
    // completed. The credential is not at fault, but there is no tenant to place
    // this person in, so the session is discarded rather than left half-signed-in.
    if (!user) {
      await supabase.auth.signOut().catch(() => {});
      console.error(
        `[auth] no User row for Supabase auth id ${data.user.id} (${normalised}) — provisioning incomplete`
      );
      throw unauthenticated(GENERIC_FAILURE);
    }

    if (user.status !== "ACTIVE") {
      await supabase.auth.signOut().catch(() => {});
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
  } catch (e) {
    // The two branches above have already signed out and are simply propagating;
    // signing out twice is harmless, and catching everything is the point — the
    // invariant is that no path leaves this function with a live session and a
    // thrown error.
    await supabase.auth.signOut().catch(() => {});
    if (!(e instanceof AppError)) {
      console.error(`[auth] sign-in failed after credential check for ${normalised}`, e);
    }
    throw e;
  }
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

  const supabase = await supabaseServer();

  // Re-authenticate before allowing the change. Holding a live session is not
  // sufficient: an unattended logged-in browser must not be enough for a
  // passer-by to seize the account by resetting its password.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (reauthError) {
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

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    throw new AppError(
      "VALIDATION",
      updateError.message || "That password could not be accepted. Try a different one."
    );
  }

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
  if (
    su.vendor.status === "BLACKLISTED" ||
    su.vendor.status === "ARCHIVED" ||
    su.vendor.status === "SUSPENDED" ||
    su.vendor.status === "INACTIVE"
  ) {
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
