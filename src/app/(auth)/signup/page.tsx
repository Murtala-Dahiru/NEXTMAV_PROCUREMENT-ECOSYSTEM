// NextMav Procure — Create account.
//
// Reachable without signing in first: this is the entry point for an organization
// that does not exist in the platform yet.

import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";
import { requireEmailVerification } from "@/server/auth-config";

export const metadata: Metadata = {
  title: "Create your account — NextMav Procure",
};

export default function SignUpPage() {
  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">Create your workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your organization on NextMav Procure. You will be its first administrator.
        </p>
      </div>

      {/* Telling the user to watch for an email that this deployment never sends
          is the kind of small lie that costs an afternoon, so the promise is made
          only when the verification path is actually the one that will run. */}
      <SignUpForm requiresVerification={requireEmailVerification()} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
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
