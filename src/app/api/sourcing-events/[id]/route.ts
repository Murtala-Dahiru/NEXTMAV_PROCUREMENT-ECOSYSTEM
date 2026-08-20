// /api/sourcing-events/[id] — one event with every RFQ raised under it.
import { updateSourcingEventSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/sourcing-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);

export const PATCH = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.update({ principal, context }, params.id, await parseBody(req, updateSourcingEventSchema))
);
