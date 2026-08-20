// /api/rfqs/[id]/no-award — the round ran and nothing was good enough (§35).
// Distinct from cancellation: the competition happened, and the bids stay on record.
import { noAwardSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, noAwardSchema);
  return service.noAward({ principal, context }, params.id, reason);
});
