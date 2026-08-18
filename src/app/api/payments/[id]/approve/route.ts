// /api/payments/[id]/approve — finance gate. Enforces separation of duties.
import { withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.approve({ principal, context }, params.id)
);
