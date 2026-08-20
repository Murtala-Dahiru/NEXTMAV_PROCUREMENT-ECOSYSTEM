// /api/rfqs/[id]/submit — put a draft RFQ in front of its approvers (§7).
import { withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.submitForApproval({ principal, context }, params.id)
);
