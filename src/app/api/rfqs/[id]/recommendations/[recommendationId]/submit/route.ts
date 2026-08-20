// Sends an award recommendation into the approval chain (§33).
import { withUser } from "@/server/http";
import * as service from "@/server/services/award-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; recommendationId: string }>(
  async ({ params, principal, context }) =>
    service.submitRecommendation({ principal, context }, params.id, params.recommendationId)
);
