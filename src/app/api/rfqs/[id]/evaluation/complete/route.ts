// /api/rfqs/[id]/evaluation/complete — an evaluator marking their seat finished.
import { withUser } from "@/server/http";
import * as service from "@/server/services/quotation-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.completeMyEvaluation({ principal, context }, params.id)
);
