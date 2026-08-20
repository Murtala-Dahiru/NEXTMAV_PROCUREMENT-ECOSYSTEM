// /api/supplier/me — who this supplier contact is, and who they are trading with.
import { withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier(async ({ principal, context }) =>
  service.me({ principal, context })
);
