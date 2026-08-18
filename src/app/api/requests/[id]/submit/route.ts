// /api/requests/[id]/submit — enter the approval workflow.
import { withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.submit({ principal, context }, params.id)
);
