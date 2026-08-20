// /api/rfqs/[id]/quotations — record a quotation received outside the portal.
//
// Same service call the supplier portal makes, so a bid keyed in from an email is
// governed by exactly the same rules as one the supplier typed themselves.
import { submitQuotationSchema } from "@/lib/schemas/procurement";
import { withUser } from "@/server/http";
import { validation } from "@/server/errors";
import * as service from "@/server/services/quotation-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, params, principal, context }) => {
  const raw = (await req.json().catch(() => null)) as { vendorId?: string } | null;
  if (!raw?.vendorId) throw validation("vendorId is required");

  const parsed = submitQuotationSchema.safeParse(raw);
  if (!parsed.success) {
    throw validation("Validation failed", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  return service.recordQuotation({ principal, context }, params.id, raw.vendorId, parsed.data);
});
