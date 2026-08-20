// NextMav Procure — authentication Server Actions.
//
// Every credential the platform handles passes through this file. Server Actions
// run only on the server, so a password is read from the request body and handed
// straight to Supabase without ever existing in client-side application code.
//
// Two rules govern what comes back out:
//
//   Never return a provider error verbatim. Supabase messages are written for
//   developers ("Invalid login credentials", "AuthApiError: ..."), and some of
//   them distinguish cases we deliberately refuse to distinguish for the caller.
//
//   Never confirm or deny that an address has an account, except where the brief
//   requires it (sign-up, so the user is told to sign in instead) or where the
//   user has already proved control of the address (an unverified sign-in).

"use server";

import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { requestContext } from "@/server/audit";
import { supabaseServer } from "@/server/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { APP_HOME, safeNext } from "@/lib/auth/redirect";
import { db } from "@/server/db";
import { recordActivity, recordAudit } from "@/server/audit";
import { getInternalPrincipal } from "@/server/session";
import { loginUser, EMAIL_UNVERIFIED } from "@/server/services/auth-service";
import {
  createConfirmedAuthUser,
  provisionAccount,
  rollbackAuthUser,
} from "@/server/services/account-service";
import {
  customSmtpConfigured,
  describeAuthMode,
  requireEmailVerification,
} from "@/server/auth-config";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
} from "@/lib/schemas/auth";

// ---------------------------------------------------------------------------
// Action result shape
// ---------------------------------------------------------------------------

export interface AuthFormState {
  /** Message shown in the form-level alert. */
  error?: string;
  /** Per-field validation messages, keyed by input name. */
  fieldErrors?: Record<string, string>;
  /** Message shown in the form-level success state. */
  success?: string;
  /**
   * Set when sign-in failed only because the address is unverified, so the form
   * can offer to resend the verification email rather than just refusing.
   */
  unverifiedEmail?: string;
  /**
   * The non-secret values the user just submitted, echoed back so the form can
   * repopulate itself.
   *
   * Without this, a rejected submission returns an empty form and the user
   * retypes their name, organization and address to fix a password typo. React
   * remounts these inputs when the action state changes, so a `defaultValue` is
   * the only thing that survives — the browser's own restore does not apply.
   *
   * Passwords are deliberately never echoed: they would then sit in the server's
   * response payload and in the client-side state tree for the rest of the page's
   * life, which is exactly where a credential should not be.
   */
  values?: { fullName?: string; organizationName?: string; email?: string };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    organizationName: formData.get("organizationName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  // Echoed on every failure path below, so a rejected attempt returns the form
  // as the user left it rather than blank.
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    organizationName: String(formData.get("organizationName") ?? ""),
    email: String(formData.get("email") ?? ""),
  };

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  const { fullName, organizationName, email, password } = parsed.data;

  // Which of the two paths runs is a deployment decision, not a per-request one.
  // See `server/auth-config.ts` for why account creation is decoupled from mail.
  const authUserId = requireEmailVerification()
    ? await beginVerifiedSignUp({ fullName, organizationName, email, password })
    : await beginDirectSignUp({ fullName, organizationName, email, password });

  // A string is an id to provision; an object is a failure to report as-is.
  if (typeof authUserId !== "string") {
    return { ...authUserId, values };
  }

  try {
    await provisionAccount({ authUserId, email, fullName, organizationName });
  } catch (e) {
    // The auth user exists but has no tenant behind it. Leaving it would claim
    // the address forever, so it is removed and the user can try again cleanly.
    console.error("[auth] provisioning failed after signUp", e);
    await rollbackAuthUser(authUserId);
    return { error: "We could not finish setting up your workspace. Please try again.", values };
  }

  if (requireEmailVerification()) {
    // No session yet: Supabase withholds one until the address is confirmed.
    redirect(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  // Nothing is left to prove, so the user is signed in rather than being made to
  // retype the credentials they chose one field ago. This runs on the
  // request-scoped client, whose cookie adapter writes the session — a Server
  // Action is one of the two places where that write is permitted.
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The account is real and complete; only the convenience sign-in failed. Send
    // them to sign in manually rather than implying the sign-up did not work.
    console.error("[auth] post-signup sign-in failed", error);
    redirect("/login?created=1");
  }

  redirect(APP_HOME);
}

interface SignUpInput {
  fullName: string;
  organizationName: string;
  email: string;
  password: string;
}

/**
 * Sign-up through Supabase's own mailer, with the address confirmed by link.
 *
 * Returns the new auth user's id, or the form state describing why it failed.
 */
async function beginVerifiedSignUp(input: SignUpInput): Promise<string | AuthFormState> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // Where Supabase sends the user after they click the verification link.
      // Must be present in the project's redirect allow-list or Supabase refuses.
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(APP_HOME)}`,
      // Carried on the auth user so the callback can still provision the account
      // if the sign-up request itself died between the two writes.
      data: { full_name: input.fullName, organization_name: input.organizationName },
    },
  });

  if (error) {
    // Always logged with the provider's own code and status. The previous version
    // returned from the rate-limit branch *before* reaching any logging, so the
    // one failure that was actually happening left no server-side trace at all —
    // which is how it stayed undiagnosed through a long run of attempts.
    console.error(
      `[auth] signUp failed — status=${error.status} code=${error.code} message=${error.message}`
    );

    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      const mode = describeAuthMode();
      if (mode.warning) console.error(`[auth] ${mode.warning}`);

      // Deliberately not "too many attempts". An exhausted quota is a property of
      // the mail transport, not of how often this person clicked, and saying
      // otherwise sends them away to retry something that cannot succeed. Naming
      // the real constraint is what makes it fixable.
      return {
        error:
          "We could not send your verification email — the mail service is over its sending limit. " +
          "This is a server configuration problem, not something you did. Please contact your administrator.",
      };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: "Choose a stronger password." } };
    }
    if (error.code === "email_address_invalid") {
      return { fieldErrors: { email: "That email address was rejected as invalid." } };
    }
    return { error: "We could not create your account. Please try again." };
  }

  // Supabase does not error on a duplicate address — it returns a decoy user with
  // no identities, so an attacker cannot enumerate accounts through this form.
  // The brief asks for an explicit message here, and the cost is acceptable: the
  // address owner is emailed either way, so the fact is already disclosed to them.
  if (!data.user || (data.user.identities?.length ?? 0) === 0) {
    return {
      error: "An account with this email already exists. Sign in instead.",
      fieldErrors: { email: "This email is already registered" },
    };
  }

  return data.user.id;
}

/**
 * Sign-up on a deployment with no mail transport.
 *
 * Creates the auth user through the admin API with the address pre-confirmed.
 * Nothing is sent, so nothing can be rate limited, and the account exists after
 * exactly one click.
 */
async function beginDirectSignUp(input: SignUpInput): Promise<string | AuthFormState> {
  const result = await createConfirmedAuthUser(input);

  if (result.ok) return result.authUserId;

  switch (result.reason) {
    case "email_exists":
      return {
        error: "An account with this email already exists. Sign in instead.",
        fieldErrors: { email: "This email is already registered" },
      };
    case "weak_password":
      return { fieldErrors: { password: "Choose a stronger password." } };
    case "email_invalid":
      return { fieldErrors: { email: "That email address was rejected as invalid." } };
    default:
      console.error("[auth] admin.createUser failed", result.error);
      return { error: "We could not create your account. Please try again." };
  }
}

/**
 * Provisions the tenant for whoever is currently authenticated.
 *
 * Called from `/auth/finish`, where the session was established in the browser
 * from fragment tokens and the server therefore never ran the provisioning step
 * that `/auth/callback` performs for the other link shapes.
 *
 * Takes no arguments on purpose: the identity comes from the session cookie, so
 * a caller cannot ask for an account to be created for somebody else.
 */
export async function completeProvisioningAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { ok: false, message: "Your session could not be confirmed. Try the link again." };
  }

  const metadata = data.user.user_metadata as
    | { full_name?: string; organization_name?: string }
    | undefined;

  // No sign-up metadata means this identity was not created by our sign-up form —
  // a recovery link, for instance. There is nothing to provision, and saying so
  // is correct rather than an error.
  if (!metadata?.organization_name || !data.user.email) {
    return { ok: true, message: "" };
  }

  try {
    await provisionAccount({
      authUserId: data.user.id,
      email: data.user.email,
      fullName: metadata.full_name?.trim() || data.user.email,
      organizationName: metadata.organization_name,
    });
    return { ok: true, message: "" };
  } catch (e) {
    console.error("[auth] provisioning from /auth/finish failed", e);
    return {
      ok: false,
      message: "Please try signing in — if the problem persists, contact your administrator.",
    };
  }
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // Only the address is echoed. Re-typing an email address after a password typo
  // is the most common friction on a sign-in form.
  const values = { email: String(formData.get("email") ?? "") };

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  }

  const next = safeNext(formData.get("next") as string | null);

  try {
    await loginUser(parsed.data.email, parsed.data.password, await requestContext());
  } catch (e) {
    if (e instanceof AppError) {
      const details = e.details as { reason?: string; email?: string } | undefined;
      if (details?.reason === EMAIL_UNVERIFIED) {
        return { error: e.message, unverifiedEmail: details.email, values };
      }
      return { error: e.message, values };
    }
    console.error("[auth] signIn failed", e);
    return { error: "Something went wrong signing you in. Please try again.", values };
  }

  redirect(next);
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const principal = await getInternalPrincipal();

  if (principal) {
    const context = await requestContext();
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

  const supabase = await supabaseServer();
  // Global scope: signing out is what a user reaches for when they believe a
  // session has been stolen, so it revokes every refresh token, not just this
  // browser's.
  await supabase.auth.signOut({ scope: "global" }).catch(() => {});

  redirect("/login");
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function resendVerificationAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter the email address you signed up with." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(APP_HOME)}`,
    },
  });

  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit")) {
    return { error: "A link was sent recently. Wait a minute before requesting another." };
  }

  // Any other outcome reports success. Whether the address has a pending sign-up
  // is not something this form should reveal.
  return { success: "If that address needs verifying, a new link is on its way." };
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export async function forgotPasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Password recovery is email, all the way down — there is no other channel by
  // which a stranger can prove they own an address. So on a deployment with no
  // mail transport this cannot work, and the one thing it must not do is say it
  // did. The usual reassuring "a link is on its way" is deliberate
  // anti-enumeration language everywhere except here, where it would be a plain
  // lie that costs the user an hour of refreshing an empty inbox.
  //
  // Saying so reveals nothing about any account: it is a property of the
  // deployment, identical for an address that exists and one that does not.
  if (!customSmtpConfigured()) {
    console.error(
      "[auth] password recovery requested but SUPABASE_CUSTOM_SMTP_CONFIGURED is not set — " +
        "Supabase's built-in mailer cannot deliver recovery links reliably (a few per hour, " +
        "team addresses only). Configure SMTP under Authentication → SMTP Settings."
    );
    return {
      error:
        "Password recovery is unavailable on this deployment because no email service is configured. " +
        "Please contact your administrator to have your password reset.",
    };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });

  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit")) {
    return { error: "Too many reset requests. Wait a few minutes and try again." };
  }

  if (error) {
    // Logged with the provider's own code, not surfaced: telling the caller that
    // this particular address failed would confirm which addresses exist.
    console.error(
      `[auth] resetPasswordForEmail failed — status=${error.status} code=${error.code} message=${error.message}`
    );
  }

  return {
    success:
      "If an account exists for that address, a password reset link is on its way. Check your inbox and spam folder.",
  };
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const supabase = await supabaseServer();

  // The recovery link established a session when `/auth/callback` exchanged its
  // code. No session here means the link was never followed, has already been
  // used, or has expired — all of which must fail rather than silently doing
  // nothing, so the user knows to request a fresh one.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return {
      error:
        "This password reset link is invalid or has expired. Request a new one to continue.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    if (error.code === "same_password") {
      return {
        fieldErrors: { password: "Choose a password you have not used before." },
      };
    }
    if (error.code === "weak_password") {
      return { fieldErrors: { password: "Choose a stronger password." } };
    }
    console.error("[auth] password update failed", error);
    return { error: "We could not update your password. Request a new reset link and try again." };
  }

  const appUser = await db.user.findUnique({
    where: { authUserId: userData.user.id },
    select: { id: true, organizationId: true },
  });

  if (appUser) {
    await recordAudit({
      organizationId: appUser.organizationId,
      userId: appUser.id,
      action: "auth.password_reset",
      resource: "User",
      resourceId: appUser.id,
      context: await requestContext(),
    });
  }

  // The recovery session is deliberately not kept. Ending it means the new
  // password has to be used at least once, which proves it was recorded as the
  // user intended before they rely on it.
  await supabase.auth.signOut({ scope: "global" }).catch(() => {});

  redirect("/login?reset=1");
}
