// NextMav Procure — Supabase client bound to the request's cookie jar.
//
// This is the client that carries the *user's* session. It authenticates as that
// user, so it is subject to row-level security exactly as the browser would be —
// it is not a back door. Anything needing to bypass RLS goes through `admin.ts`.

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Builds a request-scoped Supabase client.
 *
 * Next 16's `cookies()` is async, and writing to the jar is only permitted in a
 * Server Action or Route Handler. During a Server Component render the write
 * throws, which is why `setAll` swallows that error: the token refresh it was
 * trying to persist has already been performed by `proxy.ts` for this request,
 * so dropping the write here loses nothing. Swallowing it in a Server Action
 * *would* lose the refreshed token, so those call this from a context where the
 * write succeeds.
 */
export async function supabaseServer() {
  const jar = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            jar.set(name, value, options);
          }
        } catch {
          // Server Component render — see above.
        }
      },
    },
  });
}
