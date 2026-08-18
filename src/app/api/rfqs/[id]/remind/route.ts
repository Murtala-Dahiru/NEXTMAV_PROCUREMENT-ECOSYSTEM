// /api/rfqs/[id]/remind — chase suppliers who have not yet quoted.
import { withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.sendReminder({ principal, context }, params.id)
);
