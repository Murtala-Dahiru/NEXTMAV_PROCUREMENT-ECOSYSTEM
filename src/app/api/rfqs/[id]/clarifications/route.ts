// /api/rfqs/[id]/clarifications — the buyer's view of the question thread, and
// the endpoint for issuing a notice to every invited supplier.
import { issueNoticeSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.listClarifications({ principal, context }, params.id)
);

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.issueNotice({ principal, context }, params.id, await parseBody(req, issueNoticeSchema))
);
