// NextMav Procure — Sign in.

import Link from "next/link";
import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in — NextMav Procure",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; signedOut?: string; created?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to your organization&apos;s workspace
        </p>
      </div>

      <SignInForm
        next={params.next}
        notice={
          params.reset
            ? "Your password has been updated. Sign in with your new password."
            : params.created
              ? "Your account is ready. Sign in to enter your workspace."
              : params.signedOut
                ? "You have been signed out."
                : undefined
        }
      />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to NextMav Procure?{" "}
        <Link
          href="/signup"
          className="font-medium text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}
