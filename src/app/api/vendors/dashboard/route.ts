// /api/vendors/dashboard — the vendor management metrics, counted in the database.
import { withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) =>
  service.dashboard({ principal, context })
);
