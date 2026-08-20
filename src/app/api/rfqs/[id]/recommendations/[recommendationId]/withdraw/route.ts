// Withdraws a recommendation that has not yet been approved.
import { cancelSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/award-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; recommendationId: string }>(
  async ({ req, params, principal, context }) => {
    const { reason } = await parseBody(req, cancelSchema);
    return service.withdrawRecommendation(
      { principal, context },
      params.id,
      params.recommendationId,
      reason
    );
  }
);
