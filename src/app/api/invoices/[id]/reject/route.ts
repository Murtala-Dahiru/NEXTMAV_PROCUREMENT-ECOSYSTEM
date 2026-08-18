// /api/invoices/[id]/reject — reject an invoice with a reason.
import { rejectSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/invoice-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, rejectSchema);
  return service.reject({ principal, context }, params.id, reason);
});
