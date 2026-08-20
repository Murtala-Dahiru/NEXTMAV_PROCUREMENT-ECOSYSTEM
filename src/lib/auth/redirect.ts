// NextMav Procure — post-authentication redirect validation.
//
// Lives outside the Server Actions file because a `"use server"` module may only
// export async functions, and this has to be callable synchronously from the
// proxy and from server components too.

/**
 * Where an authenticated user belongs.
 *
 * `/` is deliberately NOT this value. The root is the public landing page, and
 * sending a freshly signed-in user there would show them marketing copy instead
 * of their workspace.
 */
export const APP_HOME = "/dashboard";

/**
 * Destinations a signed-in user may be sent to after authenticating.
 *
 * Deliberately short, because it is the whole truth about this application's
 * private URL surface: the platform is a single-route client shell, and every
 * screen inside it — requests, vendors, settings — is store state rather than a
 * path. So `/settings` is not an under-documented route, it is a 404.
 *
 * That matters here because the proxy records where an anonymous visitor was
 * heading and returns them to it after sign-in. Without this list it would
 * faithfully return them to a page that does not exist, turning a mistyped URL
 * into a 404 *after* a successful sign-in — which reads as a broken login.
 *
 * When real routes are added, add their prefixes here.
 */
const APP_ROUTES = [APP_HOME];

/**
 * Confines a post-authentication redirect to a real page of this application.
 *
 * Two separate jobs, and the first is the security one:
 *
 *   `?next=` reaches us from links we do not control — including the ones
 *   Supabase puts in emails. Without this check, `?next=https://evil.example`
 *   turns the sign-in page into an open redirect, which is exactly what makes a
 *   phishing link look as though it came from us. Rejected forms:
 *     `//evil.example`  protocol-relative, leaves the site.
 *     `/\evil.example`  read as scheme-relative by some browsers.
 *     `https://…`       plainly off-site.
 *
 *   Then, of the paths that are safely on-site, only ones this application
 *   actually serves are allowed through.
 */
export function safeNext(next: string | null | undefined, fallback = APP_HOME): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  if (next.includes("\\")) return fallback;

  // Compare the path alone; a query string is preserved but must not smuggle a
  // different destination past the prefix check.
  const path = next.split(/[?#]/)[0];
  const known = APP_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));

  return known ? next : fallback;
}
