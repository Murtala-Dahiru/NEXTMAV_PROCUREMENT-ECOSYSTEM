// /api/vendors/[id]/compliance — the obligations this organization places on
// this supplier.
import { complianceRequirementSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.addRequirement(
    { principal, context },
    params.id,
    await parseBody(req, complianceRequirementSchema)
  )
);
