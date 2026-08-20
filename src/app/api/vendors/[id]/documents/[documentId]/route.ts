// /api/vendors/[id]/documents/[documentId] — remove an unverified document.
import { withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const DELETE = withUser<{ id: string; documentId: string }>(
  async ({ params, principal, context }) =>
    service.removeDocument({ principal, context }, params.id, params.documentId)
);
