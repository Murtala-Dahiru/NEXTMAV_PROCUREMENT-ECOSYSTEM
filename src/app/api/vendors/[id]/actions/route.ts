// /api/vendors/[id]/actions — the lifecycle verbs: invite, activate, suspend,
// reactivate, deactivate, archive, restore, blacklist, preferred.
//
// One route rather than nine, because the service owns the mapping from verb to
// status and permission. A caller names what it wants done, never what state it
// wants the record left in.
import { vendorActionSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.act({ principal, context }, params.id, await parseBody(req, vendorActionSchema))
);
