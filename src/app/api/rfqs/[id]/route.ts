// /api/rfqs/[id] — RFQ detail including the quotation comparison matrix.
import { withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);
