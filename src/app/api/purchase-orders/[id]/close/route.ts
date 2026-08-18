// /api/purchase-orders/[id]/close — close a fully received order.
import { withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.close({ principal, context }, params.id)
);
