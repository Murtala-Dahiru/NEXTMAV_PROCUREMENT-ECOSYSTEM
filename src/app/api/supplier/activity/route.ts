// /api/supplier/activity — this supplier's own activity feed.
import { withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier(async ({ principal, context }) =>
  service.myActivity({ principal, context })
);
