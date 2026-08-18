// POST /api/auth/login — employee sign-in.

import { loginSchema } from "@/lib/schemas/auth";
import { parseBody, withPublic } from "@/server/http";
import { loginUser } from "@/server/services/auth-service";

export const runtime = "nodejs";

export const POST = withPublic(
  async ({ req, context }) => {
    const { email, password } = await parseBody(req, loginSchema);
    const user = await loginUser(email, password, context);
    return { user };
  },
  // Credential-stuffing protection, throttled per account rather than per IP —
  // an office sharing one public address must not lock itself out, and an
  // attacker spreading attempts across addresses should still be stopped.
  {
    rateLimit: {
      bucket: "auth:login",
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
