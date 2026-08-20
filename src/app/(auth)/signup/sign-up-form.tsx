"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Mail, User } from "lucide-react";
import { signUpAction, type AuthFormState } from "../actions";
import { Field, FormError, PasswordField, SubmitButton } from "../form-parts";

const EMPTY: AuthFormState = {};

export function SignUpForm({ requiresVerification }: { requiresVerification: boolean }) {
  const [state, formAction] = useActionState(signUpAction, EMPTY);

  return (
    <>
      <FormError>
        {state.error}
        {/* When the address is already taken, the useful next step is signing in,
            so it is offered here rather than left for the user to find. */}
        {state.fieldErrors?.email === "This email is already registered" && (
          <>
            {" "}
            <Link href="/login" className="font-medium underline underline-offset-2">
              Go to sign in
            </Link>
          </>
        )}
      </FormError>

      <form action={formAction} className="space-y-4">
        <Field
          label="Full name"
          name="fullName"
          icon={User}
          required
          autoComplete="name"
          defaultValue={state.values?.fullName}
          placeholder="Amina Okafor"
          error={state.fieldErrors?.fullName}
        />

        <Field
          label="Organization name"
          name="organizationName"
          icon={Building2}
          required
          autoComplete="organization"
          defaultValue={state.values?.organizationName}
          placeholder="Apex Manufacturing Ltd"
          error={state.fieldErrors?.organizationName}
        />

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
          autoComplete="new-password"
          error={state.fieldErrors?.password}
          hint="At least 12 characters, with an uppercase letter, a lowercase letter and a number."
        />

        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          required
          autoComplete="new-password"
          error={state.fieldErrors?.confirmPassword}
        />

        <SubmitButton pendingLabel="Creating your workspace…" icon={ArrowRight}>
          Create account
        </SubmitButton>
      </form>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        {requiresVerification
          ? "We will email you a link to verify your address before you can sign in."
          : "Your workspace is created immediately and you will be signed straight into it."}
      </p>
    </>
  );
}
