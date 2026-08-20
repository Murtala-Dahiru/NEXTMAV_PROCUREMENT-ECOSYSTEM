// /api/vendors/[id]/documents — supplier paperwork.
import { vendorDocumentSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.addDocument({ principal, context }, params.id, await parseBody(req, vendorDocumentSchema))
);
