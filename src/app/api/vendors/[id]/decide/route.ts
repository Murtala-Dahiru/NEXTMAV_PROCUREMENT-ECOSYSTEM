// /api/vendors/[id]/decide — one approver's decision on one onboarding stage.
import { vendorDecisionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.decide({ principal, context }, params.id, await parseBody(req, vendorDecisionSchema))
);
