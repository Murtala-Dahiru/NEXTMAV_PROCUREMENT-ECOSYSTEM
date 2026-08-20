// /api/vendors/approvals/queue — vendor approvals awaiting this user.
import { withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) =>
  service.myApprovalQueue({ principal, context })
);
