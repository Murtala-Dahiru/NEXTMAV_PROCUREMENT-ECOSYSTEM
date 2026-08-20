// /api/rfqs/[id]/evaluation — the evaluation result, scoped to what the caller is
// entitled to see (§30): their own scores, plus the panel's if they chair it.
import { withUser } from "@/server/http";
import * as service from "@/server/services/quotation-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.evaluationSummary({ principal, context }, params.id)
);
