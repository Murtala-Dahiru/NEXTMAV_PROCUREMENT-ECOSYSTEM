// /api/payments/[id] — payment detail.
import { withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);
