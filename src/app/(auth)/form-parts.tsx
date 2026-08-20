// NextMav Procure — shared building blocks for the authentication forms.
//
// These exist so the five auth screens cannot drift apart in the details that
// users actually notice: where the error sits relative to the field, whether the
// button reports progress, whether a password can be revealed. Each is a thin
// wrapper over a plain input — there is no form abstraction here, because the
// forms differ enough that one would obscure more than it saved.

"use client";

import { Children, useId, useState, type ComponentType } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function FormError({ children }: { children: React.ReactNode }) {
  // `!children` is not enough. Callers pass a message alongside conditional
  // extras — `<FormError>{state.error}{cond && <Link/>}</FormError>` — and that
  // makes `children` an ARRAY, which is truthy even when every element in it is
  // `undefined` or `false`. The result was a bare red alert box with no text in
  // it on a form that had nothing to complain about.
  //
  // `Children.toArray` discards null, undefined and booleans, so what survives is
  // exactly the content that would actually be rendered.
  if (Children.toArray(children).length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function FormSuccess({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
  error?: string;
  /** Rendered to the right of the label — the "Forgot password?" link. */
  action?: React.ReactNode;
  hint?: string;
}

export function Field({
  label,
  name,
  type = "text",
  icon: Icon,
  placeholder,
  autoComplete,
  defaultValue,
  required,
  error,
  action,
  hint,
}: FieldProps) {
  const id = useId();
  const { pending } = useFormStatus();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {action}
      </div>

      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          disabled={pending}
          defaultValue={defaultValue}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={`h-10 w-full rounded-lg border bg-background pr-3 text-sm transition-all placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 disabled:opacity-60 ${
            Icon ? "pl-10" : "pl-3"
          } ${
            error
              ? "border-rose-300 focus:ring-rose-400 dark:border-rose-800"
              : "border-input focus:ring-ring"
          }`}
        />
      </div>

      {error ? (
        <p id={errorId} className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A password field with a reveal toggle.
 *
 * The toggle is a `button type="button"` — without the explicit type it would
 * default to submit and silently post the form on click.
 */
export function PasswordField({
  label,
  name,
  autoComplete,
  placeholder = "••••••••",
  error,
  action,
  hint,
  required,
}: Omit<FieldProps, "type" | "icon" | "defaultValue">) {
  const id = useId();
  const { pending } = useFormStatus();
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {action}
      </div>

      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          disabled={pending}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={`h-10 w-full rounded-lg border bg-background pl-3 pr-10 text-sm transition-all placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 disabled:opacity-60 ${
            error
              ? "border-rose-300 focus:ring-rose-400 dark:border-rose-800"
              : "border-input focus:ring-ring"
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {error ? (
        <p id={errorId} className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * Submit button wired to the parent form's pending state.
 *
 * `useFormStatus` must be read from a component *inside* the form, which is why
 * this is its own component rather than a prop on the page.
 */
export function SubmitButton({
  children,
  pendingLabel,
  icon: Icon,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="group relative h-10 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-all hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
    >
      {pending ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          {pendingLabel}
        </span>
      ) : (
        <span className="flex items-center justify-center gap-2">
          {children}
          {Icon && <Icon size={16} className="transition-transform group-hover:translate-x-0.5" />}
        </span>
      )}
    </button>
  );
}
