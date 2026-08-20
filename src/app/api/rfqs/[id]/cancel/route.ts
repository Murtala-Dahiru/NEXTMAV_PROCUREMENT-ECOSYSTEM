// /api/rfqs/[id]/cancel — stop a sourcing round. Bids are kept, never deleted.
import { cancelSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return service.cancel({ principal, context }, params.id, reason);
});
