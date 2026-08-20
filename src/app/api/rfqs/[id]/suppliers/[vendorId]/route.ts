// /api/rfqs/[id]/suppliers/[vendorId] — remove a supplier from a draft RFQ.
import { withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const DELETE = withUser<{ id: string; vendorId: string }>(
  async ({ params, principal, context }) =>
    service.removeInvitation({ principal, context }, params.id, params.vendorId)
);
