// POST /api/auth/logout — employee sign-out.

import { withPublic } from "@/server/http";
import { getInternalPrincipal } from "@/server/session";
import { logoutUser } from "@/server/services/auth-service";

export const runtime = "nodejs";

export const POST = withPublic(async ({ context }) => {
  // Resolved rather than required: signing out with an already-dead session should
  // still clear the cookie and return success, not 401.
  const principal = await getInternalPrincipal();
  await logoutUser(
    principal
      ? { userId: principal.userId, organizationId: principal.organizationId, name: principal.name }
      : null,
    context
  );
  return { ok: true };
});
