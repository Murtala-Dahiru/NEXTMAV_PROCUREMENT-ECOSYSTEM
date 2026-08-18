// /api/purchase-orders/[id]/revise — raise a new PO version.
import { revisePoSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.revise({ principal, context }, params.id, await parseBody(req, revisePoSchema))
);
