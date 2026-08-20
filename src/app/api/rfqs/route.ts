// /api/rfqs — list and create RFQs.
//
// The list sweeps overdue RFQs into EXPIRED before reading. Doing it here rather
// than only in a scheduler means the state is right in a deployment with no cron:
// a buyer opening the directory is the most reliable trigger there is.
import { listQuerySchema, createRfqSchema } from "@/lib/schemas/procurement";
import { parseBody, parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) => {
  await service.expireOverdue(principal.organizationId);
  return service.list({ principal, context }, parseQuery(req, listQuerySchema));
});

export const POST = withUser(async ({ req, principal, context }) =>
  service.create({ principal, context }, await parseBody(req, createRfqSchema))
);
