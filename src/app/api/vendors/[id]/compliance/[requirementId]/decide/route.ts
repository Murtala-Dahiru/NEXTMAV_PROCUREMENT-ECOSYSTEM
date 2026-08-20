// /api/vendors/[id]/compliance/[requirementId]/decide — verify, reject, put
// under review, or waive one compliance requirement.
import { complianceDecisionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; requirementId: string }>(
  async ({ req, params, principal, context }) =>
    service.decideRequirement(
      { principal, context },
      params.id,
      params.requirementId,
      await parseBody(req, complianceDecisionSchema)
    )
);
