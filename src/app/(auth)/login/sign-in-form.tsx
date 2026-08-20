"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { signInAction, resendVerificationAction, type AuthFormState } from "../actions";
import { Field, FormError, FormSuccess, PasswordField, SubmitButton } from "../form-parts";

const EMPTY: AuthFormState = {};

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, formAction] = useActionState(signInAction, EMPTY);

  return (
    <>
      {notice && <FormSuccess>{notice}</FormSuccess>}
      <FormError>{state.error}</FormError>

      {/* An unverified account is the one failure with a route forward, so the
          resend control is offered inline rather than sending the user hunting. */}
      {state.unverifiedEmail && <ResendVerification email={state.unverifiedEmail} />}

      <form action={formAction} className="space-y-4">
        {/* Preserved across a failed attempt so the user returns to where they
            were headed rather than to the dashboard. */}
        {next && <input type="hidden" name="next" value={next} />}

        <Field
          label="Work email"
          name="email"
          type="email"
          icon={Mail}
          required
          autoComplete="username"
          defaultValue={state.values?.email}
          placeholder="you@company.com"
          error={state.fieldErrors?.email}
        />

        <PasswordField
          label="Password"
          name="password"
          required
          autoComplete="current-password"
          error={state.fieldErrors?.password}
          action={
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              Forgot password?
            </Link>
          }
        />

        <SubmitButton pendingLabel="Signing in…" icon={ArrowRight}>
          Sign in to workspace
        </SubmitButton>
      </form>
    </>
  );
}

function ResendVerification({ email }: { email: string }) {
  const [state, formAction] = useActionState(resendVerificationAction, EMPTY);

  if (state.success) return <FormSuccess>{state.success}</FormSuccess>;

  return (
    <form action={formAction} className="-mt-1 mb-4">
      <input type="hidden" name="email" value={email} />
      {state.error && <p className="mb-2 text-xs text-rose-600 dark:text-rose-400">{state.error}</p>}
      <button
        type="submit"
        className="text-xs font-medium text-emerald-600 underline-offset-2 transition-colors hover:underline dark:text-emerald-400"
      >
        Resend the verification email
      </button>
    </form>
  );
}
