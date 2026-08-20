"use client";

import { useActionState } from "react";
import { Mail, Send } from "lucide-react";
import { resendVerificationAction, type AuthFormState } from "../actions";
import { Field, FormError, FormSuccess, SubmitButton } from "../form-parts";

const EMPTY: AuthFormState = {};

export function ResendForm({ defaultEmail }: { defaultEmail?: string }) {
  const [state, formAction] = useActionState(resendVerificationAction, EMPTY);

  return (
    <>
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <form action={formAction} className="space-y-3">
        {/* Editable rather than hidden: someone who mistyped their address on
            sign-up would otherwise have no way to correct it except signing up
            again, which the duplicate-address check would then block. */}
        <Field
          label="Email address"
          name="email"
          type="email"
          icon={Mail}
          required
          autoComplete="username"
          defaultValue={defaultEmail}
          placeholder="you@company.com"
        />

        <SubmitButton pendingLabel="Sending…" icon={Send}>
          Resend verification email
        </SubmitButton>
      </form>
    </>
  );
}
