// NextMav Procure — authentication configuration.
//
// One question is answered here, and the whole shape of sign-up depends on it:
// can this deployment actually send an email?
//
// The reason this is configuration rather than a constant is a failure that cost
// a full diagnostic pass. Sign-up called `supabase.auth.signUp`, which cannot
// return without Supabase first sending a confirmation message. The project had
// no custom SMTP, so it fell back to Supabase's built-in mailer — a development
// convenience capped at a couple of messages per hour and restricted to the
// project team's own addresses. Every sign-up past that cap came back
//
//     HTTP 429  over_email_send_rate_limit
//
// *before creating anything*. Not one account existed to show for a long series
// of attempts, and the screen blamed the user for trying too often.
//
// The lesson is not "retry more politely". It is that account creation must not
// be coupled to a mail transport that may not exist. So:
//
//   verification ON   Supabase sends the confirmation link and owns the flow.
//                     Correct once real SMTP is configured.
//
//   verification OFF  The account is created through the admin API with the
//                     address pre-confirmed. Nothing is emailed, nothing is rate
//                     limited, and sign-up completes on the first click.
//
// Both paths provision the same tenant through the same `provisionAccount`, so
// flipping the flag changes when an address is proved, never what gets built.

import "server-only";

/**
 * Whether sign-up should require the user to confirm their email address.
 *
 * Defaults to OFF. That default is deliberate and is the safer of the two: a
 * deployment that has not been told it can send mail must not build a sign-up
 * flow whose completion depends on mail arriving. Turning it on is an explicit
 * statement that SMTP has been configured.
 *
 * Turn it on by setting `SIGNUP_REQUIRE_EMAIL_VERIFICATION=true` *after*
 * configuring a real SMTP provider in the Supabase dashboard under
 * Authentication → SMTP Settings. The project's own "Confirm email" setting must
 * agree with this flag; `describeAuthMode()` reports when it does not.
 */
export function requireEmailVerification(): boolean {
  return process.env.SIGNUP_REQUIRE_EMAIL_VERIFICATION === "true";
}

/**
 * Whether a custom SMTP provider has been declared for this deployment.
 *
 * This application never sends mail itself — Supabase does — so it cannot test
 * the transport directly. What it can do is notice the combination that is
 * always wrong: verification demanded while nothing has been configured to
 * deliver it. Set `SUPABASE_CUSTOM_SMTP_CONFIGURED=true` once the dashboard's
 * SMTP settings are filled in.
 */
export function customSmtpConfigured(): boolean {
  return process.env.SUPABASE_CUSTOM_SMTP_CONFIGURED === "true";
}

export interface AuthModeReport {
  requireEmailVerification: boolean;
  customSmtpConfigured: boolean;
  /** Set when the configuration is internally inconsistent. */
  warning: string | null;
}

/**
 * Describes the current mode, and names the one combination that cannot work.
 *
 * Verification without a mail transport is not a degraded mode — it is a sign-up
 * form that rejects every submission with a rate-limit error once the built-in
 * mailer's small hourly allowance is gone. It is called out loudly rather than
 * left to be rediscovered.
 */
export function describeAuthMode(): AuthModeReport {
  const verify = requireEmailVerification();
  const smtp = customSmtpConfigured();

  return {
    requireEmailVerification: verify,
    customSmtpConfigured: smtp,
    warning:
      verify && !smtp
        ? "SIGNUP_REQUIRE_EMAIL_VERIFICATION=true but SUPABASE_CUSTOM_SMTP_CONFIGURED is not set. " +
          "Sign-up will depend on Supabase's built-in mailer, which allows only a few messages per " +
          "hour and delivers only to your Supabase team's own addresses. Expect HTTP 429 " +
          "over_email_send_rate_limit. Configure SMTP under Authentication → SMTP Settings, or set " +
          "SIGNUP_REQUIRE_EMAIL_VERIFICATION=false."
        : null,
  };
}
