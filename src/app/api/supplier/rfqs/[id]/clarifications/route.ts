// /api/supplier/rfqs/[id]/clarifications — this supplier's own questions, plus any
// notice the buyer published to all bidders. Never another supplier's thread.
import { askClarificationSchema } from "@/lib/schemas/procurement";
import { parseBody, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier<{ id: string }>(async ({ params, principal, context }) =>
  service.listClarifications({ principal, context }, params.id)
);

export const POST = withSupplier<{ id: string }>(async ({ req, params, principal, context }) =>
  service.askClarification({ principal, context }, params.id, await parseBody(req, askClarificationSchema))
);
