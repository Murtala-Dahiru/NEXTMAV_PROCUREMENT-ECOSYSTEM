// NextMav Procure — a Supabase email link that could not be used.
//
// Reached from /auth/callback. The reason code is never shown raw: it is mapped
// to an explanation and, more importantly, to the action that resolves it. The
// mapping lives in the client component because the most accurate reason arrives
// in the URL fragment, which the server cannot see — see auth-error-content.tsx.

import type { Metadata } from "next";
import { AuthErrorContent } from "./auth-error-content";

export const metadata: Metadata = {
  title: "Link problem — NextMav Procure",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return <AuthErrorContent serverReason={reason} />;
}
