// POST /api/supplier/auth/login — external supplier sign-in.
//
// A separate endpoint, cookie and session table from the employee login. See
// src/server/session.ts for why the two realms never share a code path.

import { supplierLoginSchema } from "@/lib/schemas/auth";
import { parseBody, withPublic } from "@/server/http";
import { loginSupplier } from "@/server/services/auth-service";

export const runtime = "nodejs";

export const POST = withPublic(
  async ({ req, context }) => {
    const { email, password } = await parseBody(req, supplierLoginSchema);
    const supplier = await loginSupplier(email, password, context);
    return { supplier };
  },
  // Credential-stuffing protection, throttled per account rather than per IP —
  // an office sharing one public address must not lock itself out, and an
  // attacker spreading attempts across addresses should still be stopped.
  {
    rateLimit: {
      bucket: "supplier-auth:login",
      limit: 10,
      windowSec: 300,
      keyFrom: (_req, body) => {
        const email = (body as { email?: unknown } | null)?.email;
        return typeof email === "string" && email.trim()
          ? email.trim().toLowerCase()
          : null;
      },
    },
  }
);
