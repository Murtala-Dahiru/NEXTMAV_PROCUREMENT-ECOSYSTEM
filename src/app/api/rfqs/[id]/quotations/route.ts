// /api/rfqs/[id]/quotations — record a quotation received outside the supplier portal.
import { submitQuotationSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import { validation } from "@/server/errors";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const raw = (await req.json()) as { vendorId?: string };
  if (!raw?.vendorId) throw validation("vendorId is required");
  const input = submitQuotationSchema.parse(raw);
  return service.recordQuotation({ principal, context }, params.id, raw.vendorId, input);
});
