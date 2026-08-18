// /api/invoices/[id] — invoice detail including the 2-way/3-way match result.
import { withUser } from "@/server/http";
import * as service from "@/server/services/invoice-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.getById({ principal, context }, params.id)
);
