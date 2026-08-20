// /api/rfqs/[id]/decide — approve or reject an RFQ for publication.
import { rfqDecisionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.decideApproval({ principal, context }, params.id, await parseBody(req, rfqDecisionSchema))
);
