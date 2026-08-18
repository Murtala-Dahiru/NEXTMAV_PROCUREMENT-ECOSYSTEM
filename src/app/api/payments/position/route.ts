// /api/payments/position — accounts-payable position from live data.
import { withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) =>
  service.payablesPosition({ principal, context })
);
