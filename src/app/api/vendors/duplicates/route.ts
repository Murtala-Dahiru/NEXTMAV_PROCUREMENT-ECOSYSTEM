// /api/vendors/duplicates — near-matches for a vendor about to be created.
//
// Read-only and deliberately separate from the create call: the form asks this
// while the user is still typing, so the warning arrives before the mistake.
import { duplicateCheckSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser(async ({ req, principal, context }) =>
  service.findDuplicates({ principal, context }, await parseBody(req, duplicateCheckSchema))
);
