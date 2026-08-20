// /api/rfqs/[id]/evaluators — appoint the evaluation panel (§29).
import { rfqEvaluatorsSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const PUT = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.setEvaluators({ principal, context }, params.id, await parseBody(req, rfqEvaluatorsSchema))
);
