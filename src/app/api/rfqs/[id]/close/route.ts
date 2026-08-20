// /api/rfqs/[id]/close — end the response period and open evaluation.
import { closeRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, closeRfqSchema);
  return service.close({ principal, context }, params.id, reason);
});
