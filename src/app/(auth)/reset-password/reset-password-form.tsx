"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { resetPasswordAction, type AuthFormState } from "../actions";
import { FormError, PasswordField, SubmitButton } from "../form-parts";

const EMPTY: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, EMPTY);

  return (
    <>
      <FormError>{state.error}</FormError>

      <form action={formAction} className="space-y-4">
        <PasswordField
          label="New password"
          name="password"
          required
          autoComplete="new-password"
          error={state.fieldErrors?.password}
          hint="At least 12 characters, with an uppercase letter, a lowercase letter and a number."
        />

        <PasswordField
          label="Confirm new password"
          name="confirmPassword"
          required
          autoComplete="new-password"
          error={state.fieldErrors?.confirmPassword}
        />

        <SubmitButton pendingLabel="Updating password…" icon={Check}>
          Update password
        </SubmitButton>
      </form>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        You will be signed out everywhere and asked to sign in with your new password.
      </p>
    </>
  );
}
