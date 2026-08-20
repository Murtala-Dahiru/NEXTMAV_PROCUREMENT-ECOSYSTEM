// NextMav Procure — completes a sign-in whose tokens arrived in the URL fragment.
//
// The last resort of the three link shapes handled by /auth/callback. Supabase's
// implicit flow returns the session as `#access_token=…&refresh_token=…`, and a
// fragment is never transmitted to the server — so this step has to happen in the
// browser or not at all. Without it, a user who verified their address correctly
// is told the link was broken.

import type { Metadata } from "next";
import { Suspense } from "react";
import { FinishSignIn } from "./finish-sign-in";

export const metadata: Metadata = {
  title: "Signing you in — NextMav Procure",
};

export const dynamic = "force-dynamic";

export default function AuthFinishPage() {
  return (
    <Suspense fallback={null}>
      <FinishSignIn />
    </Suspense>
  );
}
