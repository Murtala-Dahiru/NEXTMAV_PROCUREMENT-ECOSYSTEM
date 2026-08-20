// /api/supplier/rfqs — the RFQs this supplier was invited to, and nothing else.
import { listQuerySchema } from "@/lib/schemas/procurement";
import { parseQuery, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier(async ({ req, principal, context }) =>
  service.myRfqs({ principal, context }, parseQuery(req, listQuerySchema))
);
