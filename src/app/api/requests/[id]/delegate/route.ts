// /api/requests/[id]/delegate — hand an approval step to someone else.
import { delegateApprovalSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.delegate({ principal, context }, params.id, await parseBody(req, delegateApprovalSchema))
);
