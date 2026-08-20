// /api/supplier/dashboard — the supplier's own counters. Every figure ranges only
// over their own invitations and their own quotations.
import { withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier(async ({ principal, context }) =>
  service.dashboard({ principal, context })
);
