// /api/purchase-orders/[id] — PO detail with the ordered/received/invoiced/paid picture.
import { withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);
