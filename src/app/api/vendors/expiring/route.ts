// /api/vendors/expiring — suppliers whose compliance evidence is lapsing.
import { withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) => {
  const raw = req.nextUrl.searchParams.get("withinDays");
  const withinDays = raw ? Math.min(365, Math.max(0, Number(raw) || 0)) : undefined;
  return service.expiringCompliance({ principal, context }, withinDays);
});
