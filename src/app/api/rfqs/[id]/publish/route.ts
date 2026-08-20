// /api/rfqs/[id]/publish — issue the RFQ to its suppliers (§10).
//
// Transactional: validation, the status move and the invitations commit together
// or not at all. Notifications are sent after the commit, never inside it.
import { publishRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { note } = await parseBody(req, publishRfqSchema);
  return service.publish({ principal, context }, params.id, note);
});
