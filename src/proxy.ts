// NextMav Procure — request proxy (Next 16's rename of middleware).
//
// Two jobs, and it is important to be clear about what is *not* one of them.
//
//   1. Refresh the Supabase session. Access tokens are short-lived; without a
//      refresh on the way in, a user who leaves a tab open is signed out mid-task
//      and server components see an expired token. `getUser()` performs that
//      refresh, and the rewritten cookies are copied onto the response.
//
//   2. Redirect obviously-misplaced requests: anonymous callers away from the
//      application, signed-in callers away from the sign-in screen.
//
// What this is NOT is the authorization boundary. It is an optimistic check on a
// cookie, it never consults the database for roles, and Next's own documentation
// warns that a matcher change or a moved Server Function can silently remove
// proxy coverage. Authorization proper lives in `getInternalPrincipal` and the
// `withUser` wrapper, next to the data — this only spares users a pointless
// round trip through a page they cannot use.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { APP_HOME, safeNext } from "@/lib/auth/redirect";

/** Auth screens. A signed-in user has no business on most of these. */
const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/verify-email",
  "/auth-error",
];

/**
 * Reachable regardless of session state.
 *
 * `/` leads the list, and it is the reason this file changed. The root is the
 * public landing page — the product's front door, which an anonymous visitor has
 * to be able to open. Previously the root *was* the application, so every
 * first-time visitor was redirected into a sign-in form before learning what
 * NextMav Procure is. Matching is exact here: `${r}/` for `/` is `//`, which no
 * path starts with, so this entry opens the root and nothing beneath it.
 *
 * `/reset-password` is here for a non-obvious reason: following a recovery link
 * *creates* a session, so by the time the user lands on the page they count as
 * signed in. Treating it as an ordinary auth route would bounce them into the
 * application and make the password impossible to change — the exact flow the
 * link exists to serve.
 */
const ALWAYS_ALLOWED = [
  "/",
  "/auth/callback",
  // Establishes the session in the browser from fragment tokens, so the caller is
  // still anonymous on the way in and must not be bounced to sign-in.
  "/auth/finish",
  "/reset-password",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The supplier portal is a different authentication realm entirely. It has no
  // Supabase session — its pages resolve a supplier principal themselves and
  // redirect to /supplier/login when there is none. Running the employee check
  // over it would bounce every supplier to the wrong sign-in page.
  if (pathname === "/supplier" || pathname.startsWith("/supplier/")) {
    return NextResponse.next({ request });
  }

  // `NextResponse.next` carries the incoming request headers, and Supabase writes
  // any refreshed cookies onto it via the adapter below.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without configuration there is no session to read. Failing open here would be
  // wrong, but so would locking every route: the pages themselves still perform
  // their own checks, so passing through leaves security intact and makes the
  // misconfiguration visible as an error rather than as a redirect loop.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to both: the request copy so anything downstream in this same
        // pass sees the fresh token, and the response so the browser stores it.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Validates the token with Supabase and refreshes it when needed. Must not be
  // removed or reordered above the redirects — a stale token would otherwise be
  // read as "not signed in" and bounce a legitimate user to the sign-in page.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = AUTH_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  const isAlwaysAllowed = ALWAYS_ALLOWED.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  if (isAlwaysAllowed) return response;

  // Anonymous caller heading into the application.
  if (!user && !isAuthRoute) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/login";
    signIn.search = "";
    // Remember where they were going so sign-in can return them there. Filtered
    // here rather than on the way back out, so the parameter is simply absent for
    // a destination that is off-site or does not exist, instead of being carried
    // through the whole sign-in and quietly discarded at the end.
    const intended = safeNext(`${pathname}${request.nextUrl.search}`);
    if (intended !== APP_HOME) signIn.searchParams.set("next", intended);
    return NextResponse.redirect(signIn);
  }

  // Signed-in caller sitting on an auth screen.
  if (user && isAuthRoute) {
    const home = request.nextUrl.clone();
    home.pathname = safeNext(request.nextUrl.searchParams.get("next"));
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  // API routes are excluded deliberately: they authenticate themselves through
  // `withUser`, and a redirect to an HTML sign-in page is a useless answer to a
  // fetch that expected JSON. Static assets are excluded so a redirect cannot
  // swallow the stylesheet on the very page it redirected to.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
