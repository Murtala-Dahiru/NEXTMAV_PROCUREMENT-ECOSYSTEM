// NextMav Procure — Supabase client for the browser.
//
// Used only where the browser genuinely needs the auth session: reacting to
// sign-out in another tab, and reading the recovery session on the reset-password
// screen. All credential submission goes through Server Actions instead, so a
// password never travels through client-side application code.

"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

type Client = ReturnType<typeof createBrowserClient>;

let client: Client | undefined;

/**
 * Returns the singleton browser client.
 *
 * A new client per call would register a new `onAuthStateChange` listener and a
 * second token-refresh timer each time a component mounted, which shows up as
 * duplicated refreshes and occasional races over the same cookie.
 */
export function supabaseBrowser(): Client {
  client ??= createBrowserClient(supabaseUrl(), supabasePublishableKey());
  return client;
}
