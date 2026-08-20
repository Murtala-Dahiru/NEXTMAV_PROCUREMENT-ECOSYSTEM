// /api/rfqs/[id]/line-items — replace the RFQ's line items while it is a draft.
import { rfqLineItemsSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const PUT = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.setLineItems({ principal, context }, params.id, await parseBody(req, rfqLineItemsSchema))
);
