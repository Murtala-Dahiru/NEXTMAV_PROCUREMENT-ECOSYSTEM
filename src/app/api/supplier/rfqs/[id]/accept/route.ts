// The supplier confirming they intend to quote.
import { withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const POST = withSupplier<{ id: string }>(async ({ params, principal, context }) =>
  service.acceptInvitation({ principal, context }, params.id)
);
