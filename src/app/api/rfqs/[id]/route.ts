// /api/rfqs/[id] — RFQ detail: the document, its suppliers, its readable bids,
// its clarifications, its approval state and what may be done to it next.
import { updateRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);

export const PATCH = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.update({ principal, context }, params.id, await parseBody(req, updateRfqSchema))
);
