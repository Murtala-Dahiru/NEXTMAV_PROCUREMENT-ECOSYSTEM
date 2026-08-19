// /api/purchase-orders/[id]/submit — send a draft order for approval.
import { withUser } from "@/server/http";
import * as service from "@/server/services/po-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.submitForApproval({ principal, context }, params.id)
);
