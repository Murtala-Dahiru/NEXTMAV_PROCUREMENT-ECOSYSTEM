// /api/payments/[id]/cancel — cancel a payment that has not completed.
import { cancelSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const { reason } = await parseBody(req, cancelSchema);
  return service.cancel({ principal, context }, params.id, reason);
});
