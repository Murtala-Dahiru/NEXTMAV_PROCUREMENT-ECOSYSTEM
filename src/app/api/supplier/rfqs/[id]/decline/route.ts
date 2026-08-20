// The supplier declining, with a reason the buyer can act on.
import { declineInvitationSchema } from "@/lib/schemas/procurement";
import { parseBody, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const POST = withSupplier<{ id: string }>(async ({ req, params, principal, context }) =>
  service.declineInvitation({ principal, context }, params.id, await parseBody(req, declineInvitationSchema))
);
