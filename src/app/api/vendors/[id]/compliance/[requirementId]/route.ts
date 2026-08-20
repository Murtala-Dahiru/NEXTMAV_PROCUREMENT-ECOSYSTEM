// /api/vendors/[id]/compliance/[requirementId] — edit or drop one requirement.
import { updateComplianceRequirementSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const PATCH = withUser<{ id: string; requirementId: string }>(
  async ({ req, params, principal, context }) =>
    service.updateRequirement(
      { principal, context },
      params.id,
      params.requirementId,
      await parseBody(req, updateComplianceRequirementSchema)
    )
);

export const DELETE = withUser<{ id: string; requirementId: string }>(
  async ({ params, principal, context }) =>
    service.removeRequirement({ principal, context }, params.id, params.requirementId)
);
