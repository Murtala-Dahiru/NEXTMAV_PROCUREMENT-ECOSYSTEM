// /api/purchase-orders/[id]/reject — refuse an order that was sent for approval.
import { cancelSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return service.reject({ principal, context }, params.id, reason);
});
