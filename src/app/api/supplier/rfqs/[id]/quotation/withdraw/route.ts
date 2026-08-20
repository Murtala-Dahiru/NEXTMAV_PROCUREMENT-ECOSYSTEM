// Withdrawing a submitted bid, permitted only while the RFQ is still open.
import { withdrawQuotationSchema } from "@/lib/schemas/procurement";
import { parseBody, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const POST = withSupplier<{ id: string }>(async ({ req, params, principal, context }) =>
  service.withdrawQuotation({ principal, context }, params.id, await parseBody(req, withdrawQuotationSchema))
);
