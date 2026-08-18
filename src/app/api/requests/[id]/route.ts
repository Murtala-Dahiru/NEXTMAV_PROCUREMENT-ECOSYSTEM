// /api/requests/[id] — read and edit one purchase request.
import { updateRequestSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/request-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);

export const PATCH = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.update({ principal, context }, params.id, await parseBody(req, updateRequestSchema))
);
