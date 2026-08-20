// NextMav Procure — request a password reset link.

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { ForgotPasswordForm } from "./forgot-password-form";
import { customSmtpConfigured } from "@/server/auth-config";

export const metadata: Metadata = {
  title: "Forgot password — NextMav Procure",
};

export default function ForgotPasswordPage() {
  // Recovery is email and nothing else — there is no other way for someone who
  // has lost their password to prove the address is theirs. With no mail
  // transport the form cannot work, so it is not offered. Showing it and failing
  // on submit would waste the one thing a locked-out user does not have: a way in.
  const available = customSmtpConfigured();

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">Reset your password</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {available
            ? "Enter the email address on your account and we will send you a link to choose a new password."
            : "Password recovery needs an email service, and none is configured for this deployment yet."}
        </p>
      </div>

      {available ? (
        <ForgotPasswordForm />
      ) : (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            Ask your administrator to reset your password for you. Once an SMTP provider is
            configured in Supabase, self-service recovery will work from this page with no
            further changes.
          </span>
        </div>
      )}

      <p className="mt-6 text-center text-sm">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </p>
    </>
  );
}
