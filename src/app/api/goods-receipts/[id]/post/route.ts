// /api/goods-receipts/[id]/post — apply a receipt to PO, inventory and assets.
import { withUser } from "@/server/http";
import * as service from "@/server/services/receiving-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.post({ principal, context }, params.id)
);
