// NextMav Procure — choose a new password.
//
// Reached only by following a recovery link, which /auth/callback exchanges for a
// session before redirecting here. That session is what authorises the change, so
// its absence is checked on the server: rendering the form to someone without one
// would collect a new password and then fail at the last step.

import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { supabaseServer } from "@/server/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password — NextMav Procure",
};

// The recovery session arrives as a cookie set moments earlier by the callback,
// so this must never be served from the static shell.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return (
      <>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900">
          <TriangleAlert size={22} />
        </div>

        <h2 className="text-2xl font-semibold tracking-tight">This link is no longer valid</h2>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Password reset links can only be used once, and they expire after a short time. Request
          a fresh link and it will work straight away.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/forgot-password"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
          >
            Request a new reset link
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Back to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">Choose a new password</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Setting a new password for{" "}
          <span className="font-medium text-foreground">{data.user.email}</span>.
        </p>
      </div>

      <ResetPasswordForm />
    </>
  );
}
