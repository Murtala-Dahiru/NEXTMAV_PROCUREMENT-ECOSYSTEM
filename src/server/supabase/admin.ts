// NextMav Procure — Supabase admin client.
//
// Holds the secret key, which bypasses row-level security and can administer any
// account in the project. Three guards keep it where it belongs:
//
//   1. `server-only` — importing this from a client component is a build error,
//      not a runtime surprise discovered after the key has already shipped.
//   2. The key is read from `SUPABASE_SECRET_KEY`, with no NEXT_PUBLIC_ prefix,
//      so Next will not inline it into a browser bundle even by accident.
//   3. Session persistence is disabled, so this client can never pick up or
//      write a user's cookies and be mistaken for one of them.
//
// Use it only for operations the user genuinely cannot perform as themselves:
// provisioning, and compensating deletes when provisioning fails halfway.

import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/env";

type AdminClient = ReturnType<typeof createClient>;

let client: AdminClient | undefined;

export function supabaseAdmin(): AdminClient {
  if (!client) {
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "SUPABASE_SECRET_KEY is not set. It is required for account provisioning."
      );
    }

    client = createClient(supabaseUrl(), key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
