// NextMav Procure — Supabase environment resolution.
//
// Only the two browser-safe values live here. The secret key is deliberately
// absent: this module is imported by client components, so anything it reads is
// compiled into the bundle that ships to the browser. `admin.ts` reads the
// secret key itself, behind `server-only`.

/**
 * Reads a required public variable.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced by its literal name — Next
 * inlines these at build time by static substitution, so `process.env[name]`
 * with a computed key silently yields undefined in the browser bundle.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in the Supabase project values.`
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/**
 * The origin Supabase sends users back to, for verification and recovery links.
 *
 * Supabase rejects a `redirectTo` that is not on the project's allow-list, so
 * this value must match one of the entries configured in the dashboard. It is
 * read from configuration rather than from the request's Host header on purpose:
 * a Host header is attacker-controlled, and using it to build an email link is
 * how host-header poisoning turns a password reset into an account takeover.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // Vercel sets this automatically on preview deployments, where the generated
  // hostname is not known ahead of time and cannot be hard-coded.
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}
