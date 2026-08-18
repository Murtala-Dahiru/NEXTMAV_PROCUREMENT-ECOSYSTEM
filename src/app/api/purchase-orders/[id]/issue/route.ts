// /api/purchase-orders/[id]/issue — issue a draft PO to the supplier.
import { withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.issue({ principal, context }, params.id)
);
