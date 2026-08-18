// /api/purchase-orders — list and create purchase orders.
import { listQuerySchema, createPoSchema } from "@/lib/schemas/procurement";
import { parseBody, parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.list({ principal, context }, parseQuery(req, listQuerySchema))
);

export const POST = withUser(async ({ req, principal, context }) =>
  service.create({ principal, context }, await parseBody(req, createPoSchema))
);
