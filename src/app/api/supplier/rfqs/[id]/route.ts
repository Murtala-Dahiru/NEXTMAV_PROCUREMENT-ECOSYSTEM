// /api/supplier/rfqs/[id] — one RFQ, redacted for supplier eyes, and the point at
// which the buyer's "viewed" counter becomes true.
//
// The lookup goes through this supplier's invitation, so an id belonging to a
// tender they were not invited to — or to another tenant entirely — 404s.
import { withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier<{ id: string }>(async ({ params, principal, context }) =>
  service.getRfq({ principal, context }, params.id)
);
