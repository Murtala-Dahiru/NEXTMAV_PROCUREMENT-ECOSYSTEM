// /api/rfqs/[id]/create-po — the sourcing handoff: awarded quotation becomes a PO.
import { withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const body = (await req.json().catch(() => ({}))) as { expectedDelivery?: string; issue?: boolean };
  return service.createFromQuotation({ principal, context }, params.id, {
    expectedDelivery: body?.expectedDelivery,
    issue: body?.issue ?? true,
  });
});
