// /api/rfqs/[id]/quotations/[quotationId]/evaluate — score one bid.
//
// Scores are written against the caller's own panel seat, so two evaluators never
// overwrite each other (Rule 9), and re-scoring keeps the previous value (§28).
import { evaluateQuotationSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/quotation-service";

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
