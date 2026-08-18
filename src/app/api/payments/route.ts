// /api/payments — list and raise payments.
import { listQuerySchema, createPaymentSchema } from "@/lib/schemas/procurement";
import { parseBody, parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/payment-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.list({ principal, context }, parseQuery(req, listQuerySchema))
);

export const POST = withUser(async ({ req, principal, context }) =>
  service.create({ principal, context }, await parseBody(req, createPaymentSchema))
);
