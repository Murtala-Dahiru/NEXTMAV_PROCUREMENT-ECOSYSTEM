// /api/invoices — list and record invoices.
import { listQuerySchema, createInvoiceSchema } from "@/lib/schemas/procurement";
import { parseBody, parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/invoice-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.list({ principal, context }, parseQuery(req, listQuerySchema))
);

export const POST = withUser(async ({ req, principal, context }) =>
  service.create({ principal, context }, await parseBody(req, createInvoiceSchema))
);
