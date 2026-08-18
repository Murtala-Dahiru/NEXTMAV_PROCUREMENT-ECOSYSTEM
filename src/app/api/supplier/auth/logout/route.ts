// POST /api/supplier/auth/logout — external supplier sign-out.

import { withPublic } from "@/server/http";
import { getSupplierPrincipal } from "@/server/session";
import { logoutSupplier } from "@/server/services/auth-service";

export const runtime = "nodejs";

export const POST = withPublic(async ({ context }) => {
  const principal = await getSupplierPrincipal();
  await logoutSupplier(
    principal
      ? { supplierUserId: principal.supplierUserId, organizationId: principal.organizationId }
      : null,
    context
  );
  return { ok: true };
});
