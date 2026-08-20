// NextMav Procure — account provisioning.
//
// Supabase Auth knows an email address and a password. It knows nothing about
// tenants, roles or approval authority. This module is the bridge: it turns an
// authenticated `auth.users.id` into a NextMav identity — an Organization, a User
// row that owns it, and the link between the two.
//
// Provisioning happens at sign-up rather than lazily on first request. Doing it
// lazily would mean the first authenticated request of every session had to check
// whether the caller exists yet, and a failure there would surface as a broken
// application rather than as a failed sign-up.

import "server-only";
import { ensureSystemRoles } from "../roles";
import { ensureVendorOnboardingWorkflow } from "../vendor-workflow";
import { ensureRfqApprovalWorkflow, ensureAwardApprovalWorkflow } from "../sourcing-workflow";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { supabaseAdmin } from "../supabase/admin";

/** "Amina Okafor" -> "AO". Falls back to the address when a name has no letters. */
function initialsFrom(name: string, email: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);

  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

/** The seed uses these; matching them keeps new tenants looking like the demo one. */
const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
];

function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export interface ProvisionInput {
  /** Supabase `auth.users.id`. The permanent identity reference. */
  authUserId: string;
  email: string;
  fullName: string;
  organizationName: string;
}

export interface ProvisionedAccount {
  userId: string;
  organizationId: string;
  alreadyExisted: boolean;
}

/**
 * Creates the Organization and its first User, owned by the given auth identity.
 *
 * Idempotent by `authUserId`. A user who double-submits the sign-up form, or
 * whose verification callback fires twice, gets the account they already have
 * rather than a second organization — the unique index on `authUserId` is the
 * backstop if two requests race past the initial read.
 *
 * The new user is SUPER_ADMIN of the organization they just created. That is the
 * only role that makes sense for a tenant of one: someone has to be able to
 * invite the second person, and there is nobody else to grant it.
 */
export async function provisionAccount(input: ProvisionInput): Promise<ProvisionedAccount> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const organizationName = input.organizationName.trim();

  const existing = await db.user.findUnique({
    where: { authUserId: input.authUserId },
    select: { id: true, organizationId: true },
  });

  if (existing) {
    return {
      userId: existing.id,
      organizationId: existing.organizationId,
      alreadyExisted: true,
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          // A tenant with no branding still has to render. The shell reads these
          // and falls back to neutral styling when they are null, so leaving them
          // unset is correct rather than merely tolerated.
          status: "ACTIVE",
        },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          authUserId: input.authUserId,
          email,
          name: fullName,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
          initials: initialsFrom(fullName, email),
          avatarColor: avatarColorFor(input.authUserId),
          // Never populated for Supabase-backed accounts. The credential lives in
          // Supabase; a null here is the assertion that no local hash exists to
          // fall out of sync with it.
          passwordHash: null,
        },
        select: { id: true, organizationId: true },
      });

      // Without this row the settings screen has nothing to render and the
      // notification engine has no channel preferences to consult.
      await tx.notificationPreference.create({ data: { userId: user.id } });

      // A tenant with no roles and no workflows is not usable: permission checks
      // fall back to the built-in defaults for the founder's enum role, but the
      // moment they invite a second person there is nothing to assign, and the
      // first RFQ they try to publish has no approval chain to build. Provisioned
      // here, inside the same transaction, so an organization never exists in
      // that half-configured state.
      // The roles are read once here and handed to all three workflow installers.
      // Left to themselves each would re-read the identical set, and every one of
      // those round trips is paid inside this transaction while the new user waits.
      const roles = await ensureSystemRoles(organization.id, tx);

      await ensureVendorOnboardingWorkflow(organization.id, tx, roles);
      await ensureRfqApprovalWorkflow(organization.id, tx, roles);
      await ensureAwardApprovalWorkflow(organization.id, tx, roles);

      return user;
    }, {
      // Prisma's default interactive-transaction budget is 5s to acquire a
      // connection and 30s to finish. Provisioning is a dozen-odd round trips to
      // a pooled database that may be in another region, and blowing the 30s
      // ceiling is not a slow success — it is a P2028 that fails the sign-up
      // outright, which is exactly what happened before `ensureSystemRoles` was
      // rewritten to write in bulk. The work now fits comfortably; this ceiling
      // exists so a slow link degrades into a slow sign-up rather than a broken
      // one.
      timeout: 60_000,
      maxWait: 15_000,
    });

    return {
      userId: result.id,
      organizationId: result.organizationId,
      alreadyExisted: false,
    };
  } catch (e) {
    // P2002 on authUserId means a concurrent request won the race. That request
    // built a perfectly good account, so adopt it instead of reporting a failure.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await db.user.findUnique({
        where: { authUserId: input.authUserId },
        select: { id: true, organizationId: true },
      });
      if (raced) {
        return {
          userId: raced.id,
          organizationId: raced.organizationId,
          alreadyExisted: true,
        };
      }
    }
    throw e;
  }
}

/**
 * Removes a Supabase auth user that has no NextMav account behind it.
 *
 * Sign-up is two writes to two systems and cannot be one transaction. When the
 * second fails, this undoes the first — otherwise the address is permanently
 * claimed in Supabase by an identity the application cannot see, and the person
 * can neither sign in nor sign up again.
 */
export async function rollbackAuthUser(authUserId: string): Promise<void> {
  try {
    await supabaseAdmin().auth.admin.deleteUser(authUserId);
  } catch (e) {
    // Logged rather than rethrown: the caller is already handling a failure, and
    // masking it with this one would hide what actually went wrong.
    console.error(`[auth] could not roll back orphaned Supabase user ${authUserId}`, e);
  }
}

// ---------------------------------------------------------------------------
// Direct account creation (no email verification)
// ---------------------------------------------------------------------------

/** What `createConfirmedAuthUser` can fail with, in terms the caller can act on. */
export type CreateAuthUserFailure = "email_exists" | "weak_password" | "email_invalid" | "unknown";

export type CreateAuthUserResult =
  | { ok: true; authUserId: string }
  | { ok: false; reason: CreateAuthUserFailure; error: unknown };

/**
 * Creates a Supabase auth user with the address already marked confirmed.
 *
 * This is the deployment path for a project with no mail transport. The ordinary
 * `auth.signUp` cannot return without Supabase first sending a confirmation
 * message, so on a project using the built-in mailer it starts answering
 * `429 over_email_send_rate_limit` after a couple of attempts an hour — and it
 * does so *before* creating the user, which is why a long run of failed sign-ups
 * leaves no trace behind at all. The admin API sends nothing, so it is neither
 * rate limited nor dependent on SMTP existing.
 *
 * `email_confirm: true` is the honest part of the trade and should be read
 * plainly: the address is accepted without being proved. That is a real
 * reduction in assurance, taken knowingly because the alternative is a sign-up
 * form that cannot complete at all. Configuring SMTP and setting
 * `SIGNUP_REQUIRE_EMAIL_VERIFICATION=true` moves the flow back onto `signUp`,
 * where the address is proved before the account can be used.
 *
 * Errors are classified rather than thrown so the caller can distinguish the one
 * case the sign-up form must speak to directly — an address already registered —
 * from failures where it must not say anything specific.
 */
export async function createConfirmedAuthUser(input: {
  email: string;
  password: string;
  fullName: string;
  organizationName: string;
}): Promise<CreateAuthUserResult> {
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    // The same metadata `signUp` would have carried, so `/auth/callback` and
    // `/auth/finish` can still complete provisioning for an account created here
    // if the second write ever fails.
    user_metadata: {
      full_name: input.fullName,
      organization_name: input.organizationName,
    },
  });

  if (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = error.message?.toLowerCase() ?? "";

    // GoTrue reports a duplicate as `email_exists`; older builds only say so in
    // the message, so both are checked.
    if (code === "email_exists" || message.includes("already been registered")) {
      return { ok: false, reason: "email_exists", error };
    }
    if (code === "weak_password") return { ok: false, reason: "weak_password", error };
    if (code === "email_address_invalid") return { ok: false, reason: "email_invalid", error };

    return { ok: false, reason: "unknown", error };
  }

  if (!data.user) {
    return { ok: false, reason: "unknown", error: new Error("admin.createUser returned no user") };
  }

  return { ok: true, authUserId: data.user.id };
}
