// /api/requests/[id]/comments — add a comment to the request thread.
import { commentSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.addComment({ principal, context }, params.id, await parseBody(req, commentSchema))
);
