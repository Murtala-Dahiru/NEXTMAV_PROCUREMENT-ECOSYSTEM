// /api/goods-receipts/[id] — receipt detail.
import { withUser } from "@/server/http";
import * as service from "@/server/services/receiving-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);
