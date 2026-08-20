// GET /auth/callback — the landing point for every Supabase email link.
//
// Both the verification link and the password-recovery link arrive here carrying
// a one-time `code`. Exchanging it is what turns the click into a real session;
// until that happens the user is still anonymous no matter what the link said.
//
// This route is also the safety net for provisioning. If sign-up created the
// Supabase auth user but died before writing the NextMav rows, the account would
// otherwise be permanently unusable — the address is taken, but no tenant exists.
// The sign-up metadata rides along on the auth user, so the account can be
// completed here instead.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/supabase/server";
import { provisionAccount } from "@/server/services/account-service";
import { safeNext } from "@/lib/auth/redirect";

export const runtime = "nodejs";
// The exchange writes session cookies, so this response must never be cached.
export const dynamic = "force-dynamic";

function failure(request: NextRequest, reason: string) {
  const url = new URL("/auth-error", request.url);
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

// Supabase's OTP types, as they appear in a `token_hash` link.
const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));

  // Supabase reports a rejected link by query string rather than by status code.
  // An expired verification or recovery link arrives here, not as an error page.
  const errorCode = searchParams.get("error_code") ?? searchParams.get("error");
  if (errorCode) {
    return failure(request, errorCode);
  }

  const supabase = await supabaseServer();

  // Supabase can deliver a confirmed identity in three different shapes, and which
  // one arrives depends on how the link was produced — not on anything we control
  // at this end. Handling only the first is the difference between a verification
  // that works and one that silently dumps the user on an error page having
  // already marked their address confirmed.
  //
  //   1. `?code=`        PKCE. What a sign-up initiated through our server client
  //                      produces, and the common case.
  //   2. `?token_hash=`  What Supabase's own recommended server-side email
  //                      template emits ({{ .TokenHash }}).
  //   3. `#access_token` Implicit flow, used by admin-generated and older links.
  //                      A fragment never reaches the server, so it is handled by
  //                      the client page below.
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");

  let user: { id: string; email?: string; user_metadata?: unknown } | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      // The overwhelmingly common cause is a link already used or aged out; both
      // are indistinguishable here and both need the same remedy.
      return failure(request, error?.code ?? "invalid_link");
    }
    user = data.user;
  } else if (tokenHash && otpType && OTP_TYPES.has(otpType)) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: otpType as "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email",
      token_hash: tokenHash,
    });
    if (error || !data.user) {
      return failure(request, error?.code ?? "invalid_link");
    }
    user = data.user;
  } else {
    // Nothing readable in the query string. The tokens may still be present in the
    // fragment, which only the browser can see, so hand off rather than fail.
    const finish = new URL("/auth/finish", request.url);
    finish.searchParams.set("next", next);
    return NextResponse.redirect(finish);
  }

  await completeProvisioning(user);

  return NextResponse.redirect(new URL(next, request.url));
}

/**
 * Completes account provisioning if sign-up did not manage to.
 *
 * Idempotent, so the normal path — where the account already exists — costs one
 * indexed read. Failures are logged rather than thrown: someone following a
 * recovery link already has an account, and refusing them over a provisioning
 * hiccup would lock them out of the very screen that fixes it.
 */
async function completeProvisioning(user: {
  id: string;
  email?: string;
  user_metadata?: unknown;
}) {
  const metadata = user.user_metadata as
    | { full_name?: string; organization_name?: string }
    | undefined;

  if (!metadata?.organization_name || !user.email) return;

  try {
    await provisionAccount({
      authUserId: user.id,
      email: user.email,
      fullName: metadata.full_name?.trim() || user.email,
      organizationName: metadata.organization_name,
    });
  } catch (e) {
    console.error("[auth] provisioning during callback failed", e);
  }
}
