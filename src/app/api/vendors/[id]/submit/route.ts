// /api/vendors/[id]/submit — send a vendor into its onboarding approval.
import { withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.submitForReview({ principal, context }, params.id)
);
