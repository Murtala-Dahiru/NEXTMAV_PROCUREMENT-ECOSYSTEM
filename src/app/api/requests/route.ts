// /api/requests — list and create purchase requests.
import { listQuerySchema, createRequestSchema } from "@/lib/schemas/procurement";
import { parseBody, parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.list({ principal, context }, parseQuery(req, listQuerySchema))
);

export const POST = withUser(async ({ req, principal, context }) =>
  service.create({ principal, context }, await parseBody(req, createRequestSchema))
);
