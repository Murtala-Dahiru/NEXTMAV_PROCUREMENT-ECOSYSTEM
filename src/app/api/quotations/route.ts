// /api/quotations — the buyer's quotation inbox (§24), across every RFQ.
import { listQuerySchema } from "@/lib/schemas/procurement";
import { parseQuery, withUser } from "@/server/http";
import * as service from "@/server/services/quotation-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ req, principal, context }) =>
  service.inbox({ principal, context }, parseQuery(req, listQuerySchema))
);
