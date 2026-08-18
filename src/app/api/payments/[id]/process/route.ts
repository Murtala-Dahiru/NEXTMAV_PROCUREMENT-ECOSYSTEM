// /api/payments/[id]/process — move an approved payment into processing.
import { withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.process({ principal, context }, params.id)
);
