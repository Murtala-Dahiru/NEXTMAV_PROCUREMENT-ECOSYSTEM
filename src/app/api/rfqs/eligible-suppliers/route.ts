// /api/rfqs/eligible-suppliers — the suppliers this organization may invite.
//
// Eligibility is applied in the query, not offered as a filter: a blacklisted or
// suspended supplier is absent from the result, full stop (Rule 5).
import { eligibleSupplierQuerySchema } from "@/lib/schemas/procurement";
import { parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.eligibleSuppliers({ principal, context }, parseQuery(req, eligibleSupplierQuerySchema))
);
