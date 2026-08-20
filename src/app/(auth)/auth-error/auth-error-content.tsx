// NextMav Procure — the "this link did not work" screen.
//
// A client component on purpose. Supabase reports a rejected email link by
// appending a fragment to the redirect target:
//
//   /auth/callback#error=access_denied&error_code=otp_expired&error_description=…
//
// A fragment is never sent to the server, so the callback route cannot see it and
// on its own reports only "no code was present" — which would tell a user whose
// link simply expired that it was malformed, and point them at the wrong remedy.
// Browsers carry the fragment across a redirect that specifies none of its own,
// so it is still in `window.location.hash` here, where only client code can read
// it. The server-supplied `?reason=` is the fallback for everything else.

"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

interface Explanation {
  title: string;
  detail: string;
  primary: { href: string; label: string };
}

function explain(reason: string | null | undefined): Explanation {
  switch (reason) {
    case "otp_expired":
    case "expired_token":
      return {
        title: "This link has expired",
        detail:
          "Email links are short-lived for security. Request a new one and it will work straight away.",
        primary: { href: "/forgot-password", label: "Request a new link" },
      };

    case "access_denied":
      return {
        title: "This link has already been used",
        detail:
          "Each link works once. If you still need to get in, request a fresh one or sign in normally.",
        primary: { href: "/login", label: "Go to sign in" },
      };

    case "missing_code":
      return {
        title: "This link is incomplete",
        detail:
          "It may have been cut short by your email client. Try opening it again, or request a new one.",
        primary: { href: "/login", label: "Go to sign in" },
      };

    default:
      return {
        title: "This link could not be used",
        detail:
          "It may have expired, already been used, or been altered in transit. Requesting a new one resolves all three.",
        primary: { href: "/login", label: "Go to sign in" },
      };
  }
}

// The fragment is a browser value that React does not own, so it is read through
// `useSyncExternalStore` rather than copied into state from an effect. That keeps
// the server and first client render agreeing on an empty hash — the server truly
// cannot see one — and then re-renders once with the real value.
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;
const readServerHash = () => "";

export function AuthErrorContent({ serverReason }: { serverReason?: string }) {
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);

  // The fragment is the more specific of the two: the route handler only ever
  // knows that no code arrived, while Supabase says *why* it did not.
  const fromHash = hash
    ? (new URLSearchParams(hash.slice(1)).get("error_code") ??
      new URLSearchParams(hash.slice(1)).get("error"))
    : null;

  const { title, detail, primary } = explain(fromHash ?? serverReason);

  return (
    <>
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-900">
        <TriangleAlert size={22} />
      </div>

      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={primary.href}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
        >
          {primary.label}
        </Link>
        <Link
          href="/signup"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Create a new account
        </Link>
      </div>
    </>
  );
}
