// /api/rfqs/[id]/recommendations — the award recommendations raised on this RFQ (§32).
import { createAwardRecommendationSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/award-service";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params, principal, context }) =>
  service.listRecommendations({ principal, context }, params.id)
);

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.createRecommendation(
    { principal, context },
    params.id,
    await parseBody(req, createAwardRecommendationSchema)
  )
);
