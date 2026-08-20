// /api/rfqs/[id]/suppliers — add suppliers to the invitation list.
import { inviteSuppliersSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.inviteSuppliers({ principal, context }, params.id, await parseBody(req, inviteSuppliersSchema))
);
