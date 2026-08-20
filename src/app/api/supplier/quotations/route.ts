// /api/supplier/quotations — this supplier's submission history.
import { listQuerySchema } from "@/lib/schemas/procurement";
import { parseQuery, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier(async ({ req, principal, context }) =>
  service.myQuotations({ principal, context }, parseQuery(req, listQuerySchema))
);
