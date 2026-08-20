// /api/rfqs/[id]/clarifications/[clarificationId] — answer a supplier's question.
//
// The visibility choice is the important one: PRIVATE goes back to the asker,
// ALL_SUPPLIERS turns the answer into a notice every bidder sees, which is what a
// change to a requirement demands (§19).
import { answerClarificationSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/rfq-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; clarificationId: string }>(
  async ({ req, params, principal, context }) =>
    service.answerClarification(
      { principal, context },
      params.id,
      params.clarificationId,
      await parseBody(req, answerClarificationSchema)
    )
);
