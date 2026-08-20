// /api/rfqs/dashboard — the sourcing dashboard's counters (§20). Every figure is
// a database aggregate; nothing is derived from a loaded page of results.
import { withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) => {
  await service.expireOverdue(principal.organizationId);
  return service.dashboard({ principal, context });
});
