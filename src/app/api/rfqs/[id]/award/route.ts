// /api/rfqs/[id]/award — select the winning quotation.
import { awardRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.award({ principal, context }, params.id, await parseBody(req, awardRfqSchema))
);
