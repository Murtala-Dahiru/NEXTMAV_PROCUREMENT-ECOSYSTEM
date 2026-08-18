// /api/approvals/queue — approval steps the signed-in user can act on now.
import { withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) =>
  service.myApprovalQueue({ principal, context })
);
