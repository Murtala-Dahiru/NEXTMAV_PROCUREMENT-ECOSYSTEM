// /api/supplier/rfqs/[id]/quotation — the supplier's own bid.
//
//   GET  what they have so far, draft or submitted
//   PUT  save work in progress (§15) — invisible to the buyer, allowed to be incomplete
//   POST submit (§16) — validated in full, deadline enforced server-side
import { saveQuotationDraftSchema, submitQuotationSchema } from "@/lib/schemas/procurement";
import { parseBody, withSupplier } from "@/server/http";
import * as service from "@/server/services/supplier-service";

export const runtime = "nodejs";

export const GET = withSupplier<{ id: string }>(async ({ params, principal, context }) =>
  service.getMyQuotation({ principal, context }, params.id)
);

export const PUT = withSupplier<{ id: string }>(async ({ req, params, principal, context }) =>
  service.saveDraft({ principal, context }, params.id, await parseBody(req, saveQuotationDraftSchema))
);

export const POST = withSupplier<{ id: string }>(async ({ req, params, principal, context }) =>
  service.submitQuotation({ principal, context }, params.id, await parseBody(req, submitQuotationSchema))
);
