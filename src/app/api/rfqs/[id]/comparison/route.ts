// /api/rfqs/[id]/comparison — the side-by-side matrix (§25) and its normalised
// per-line view (§26). Refuses to answer for a sealed RFQ before the deadline.
import { withUser } from "@/server/http";
import * as service from "@/server/services/quotation-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.comparison({ principal, context }, params.id)
);
