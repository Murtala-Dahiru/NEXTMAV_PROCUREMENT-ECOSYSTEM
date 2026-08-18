// /api/requests/[id]/decide — approve, reject or request changes.
import { requestDecisionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.decide({ principal, context }, params.id, await parseBody(req, requestDecisionSchema))
);
