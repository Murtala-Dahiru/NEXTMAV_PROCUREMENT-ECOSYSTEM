// /api/purchase-orders/[id]/approve — authorise the spend before the order is issued.
//
// Separation of duties applies: the service refuses an approval from whoever
// raised the order.
import { z } from "zod";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

const bodySchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { comment } = await parseBody(req, bodySchema);
  return service.approve({ principal, context }, params.id, comment);
});
