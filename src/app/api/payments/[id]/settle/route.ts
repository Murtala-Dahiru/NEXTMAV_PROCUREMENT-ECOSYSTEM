// /api/payments/[id]/settle — record the real-world outcome of a payment.
import { settlePaymentSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.settle({ principal, context }, params.id, await parseBody(req, settlePaymentSchema))
);
