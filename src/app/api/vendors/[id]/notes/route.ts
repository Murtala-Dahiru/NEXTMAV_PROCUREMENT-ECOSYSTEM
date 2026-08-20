// /api/vendors/[id]/notes — internal commentary. Never reachable from the
// supplier realm: this route is wrapped in withUser, which requires an employee
// session, and VendorNote is not projected into any supplier response.
import { vendorNoteSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.addNote({ principal, context }, params.id, await parseBody(req, vendorNoteSchema))
);
