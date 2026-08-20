// /api/vendors/[id]/risk — record a dated, attributed risk assessment.
import { vendorRiskSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.assessRisk({ principal, context }, params.id, await parseBody(req, vendorRiskSchema))
);
