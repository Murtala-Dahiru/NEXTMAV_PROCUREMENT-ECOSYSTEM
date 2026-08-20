// /api/vendors/[id]/categories — what this supplier is qualified to supply.
import { vendorCategoriesSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const PUT = withUser<{ id: string }>(async ({ req, params, principal, context }) =>
  service.setCategories({ principal, context }, params.id, await parseBody(req, vendorCategoriesSchema))
);
