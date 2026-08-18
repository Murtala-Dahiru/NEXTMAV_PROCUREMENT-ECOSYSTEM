// /api/purchase-orders/[id]/outstanding — the receiving worksheet for a PO.
import { withUser } from "@/server/http";
import * as service from "@/server/services/receiving-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.outstandingForPo({ principal, context }, params.id)
);
