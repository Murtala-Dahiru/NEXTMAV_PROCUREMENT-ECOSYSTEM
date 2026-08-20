// /api/rfqs/[id]/allow-revision — the authorized revision mechanism of Rule 4.
//
// Without this, a submitted quotation is final. With it, one named supplier may
// replace theirs, and the reason is on the record.
import { allowRevisionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.allowRevision({ principal, context }, params.id, await parseBody(req, allowRevisionSchema))
);
