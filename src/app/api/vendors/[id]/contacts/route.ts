// /api/vendors/[id]/contacts — the people at a supplier.
import { vendorContactSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.addContact({ principal, context }, params.id, await parseBody(req, vendorContactSchema))
);
