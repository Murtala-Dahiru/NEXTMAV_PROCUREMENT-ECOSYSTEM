// /api/rfqs/[id]/award — award the RFQ.
//
// Either enacts an already-approved recommendation, or raises one and runs it
// through approval. Where an award workflow exists the caller does not get to skip
// it; where none is configured the award completes and the audit row says so.
import { awardRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/award-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.award({ principal, context }, params.id, await parseBody(req, awardRfqSchema))
);
