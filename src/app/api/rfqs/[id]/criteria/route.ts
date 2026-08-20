// /api/rfqs/[id]/criteria — define what the bids will be judged on (§27).
//
// Refused once any bid has been scored: the yardstick is fixed before the numbers
// arrive, or it is not a yardstick.
import { rfqCriteriaSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const PUT = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.setCriteria({ principal, context }, params.id, await parseBody(req, rfqCriteriaSchema))
);
