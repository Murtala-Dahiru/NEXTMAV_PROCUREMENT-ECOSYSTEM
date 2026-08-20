// NextMav Procure — the authenticated application.
//
// Lives at /dashboard rather than at / so that / can be the public landing page.
// That split is the whole point: an anonymous visitor must be able to reach the
// product's front door without being bounced into a sign-in form, and the only
// way to guarantee that is for the application itself to occupy a path that is
// unambiguously private.
//
// This is the second of the two gates in front of the platform, and the one that
// actually counts. The proxy already turned anonymous requests away, but that was
// an optimistic cookie check; this resolves the real principal — Supabase-verified
// identity, active NextMav user, live tenant — before a single byte of the shell
// is rendered.

import { redirect } from "next/navigation";
import { getInternalPrincipal } from "@/server/session";
import { AppClient } from "../app-client";

// The principal is read per request, so this route can never be prerendered into
// a static shell that outlives the session it was rendered for.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = await getInternalPrincipal();

  if (!principal) {
    redirect("/login");
  }

  return <AppClient />;
}
