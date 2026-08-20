// NextMav Procure — "check your inbox" after sign-up.
//
// This is a waiting state, not a step the user performs here. Verification itself
// happens when they click the link in the email, which lands on /auth/callback.

import Link from "next/link";
import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = {
  title: "Verify your email — NextMav Procure",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <>
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900">
        <MailCheck size={22} />
      </div>

      <h2 className="text-2xl font-semibold tracking-tight">Check your email</h2>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {email ? (
          <>
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{email}</span>. Click it to activate
            your account, then sign in.
          </>
        ) : (
          <>
            We sent you a verification link. Click it to activate your account, then sign in.
          </>
        )}
      </p>

      <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3.5">
        <p className="text-xs font-medium text-foreground">Not seeing it?</p>
        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
          <li>• Check your spam or junk folder.</li>
          <li>• Links expire after 24 hours — request a new one below.</li>
        </ul>
      </div>

      <div className="mt-6">
        <ResendForm defaultEmail={email} />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already verified?{" "}
        <Link
          href="/login"
          className="font-medium text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
