// /api/invoices/[id]/approve — finance approval for payment.
import { withUser } from "@/server/http";
import * as service from "@/server/services/invoice-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const body = (await req.json().catch(() => ({}))) as { note?: string };
  return service.approve({ principal, context }, params.id, body?.note);
});
