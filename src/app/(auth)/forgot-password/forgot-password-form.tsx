"use client";

import { useActionState } from "react";
import { Mail, Send } from "lucide-react";
import { forgotPasswordAction, type AuthFormState } from "../actions";
import { Field, FormError, FormSuccess, SubmitButton } from "../form-parts";

const EMPTY: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, EMPTY);

  // On success the form is replaced rather than kept alongside a banner. Leaving
  // it in place invites a second submission, which only trips the rate limit.
  if (state.success) {
    return <FormSuccess>{state.success}</FormSuccess>;
  }

  return (
    <>
      <FormError>{state.error}</FormError>

      <form action={formAction} className="space-y-4">
        <Field
          label="Email address"
          name="email"
          type="email"
          icon={Mail}
          required
          autoComplete="username"
          placeholder="you@company.com"
          error={state.fieldErrors?.email}
        />

        <SubmitButton pendingLabel="Sending link…" icon={Send}>
          Send reset link
        </SubmitButton>
      </form>
    </>
  );
}
