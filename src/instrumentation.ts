// NextMav Procure — startup checks.
//
// Next calls `register()` once per server process, before the first request. It
// is the only place a configuration mistake can be reported *before* it turns
// into a user-facing failure, which is exactly what is wanted for the class of
// problem this file exists for: settings that are individually valid, mutually
// contradictory, and silent until someone tries to sign up.
//
// The motivating case is documented in `server/auth-config.ts`. Sign-up required
// an email that the project had no configured way to send, so Supabase's
// built-in mailer answered `429 over_email_send_rate_limit` and every attempt
// failed before creating anything. Nothing in the boot sequence said so.

export async function register() {
  // Only the Node.js runtime can read these; the Edge runtime gets a separate,
  // much smaller environment and would report false alarms.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { describeAuthMode } = await import("./server/auth-config");
  const mode = describeAuthMode();

  if (mode.warning) {
    console.warn(`\n[startup] AUTH CONFIGURATION PROBLEM\n[startup] ${mode.warning}\n`);
    return;
  }

  console.log(
    `[startup] auth: email verification ${
      mode.requireEmailVerification ? "REQUIRED" : "disabled"
    }${
      mode.requireEmailVerification
        ? " (custom SMTP declared)"
        : " — accounts are created pre-confirmed via the admin API, nothing is emailed"
    }`
  );
}
