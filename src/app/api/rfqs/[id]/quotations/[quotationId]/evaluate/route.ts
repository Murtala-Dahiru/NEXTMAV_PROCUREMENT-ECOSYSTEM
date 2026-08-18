// /api/rfqs/[id]/quotations/[quotationId]/evaluate — score a bid.
import { evaluateQuotationSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; quotationId: string }>(
  async ({ req, params, principal, context }) =>
    service.evaluateQuotation(
      { principal, context },
      params.id,
      params.quotationId,
      await parseBody(req, evaluateQuotationSchema)
    )
);
