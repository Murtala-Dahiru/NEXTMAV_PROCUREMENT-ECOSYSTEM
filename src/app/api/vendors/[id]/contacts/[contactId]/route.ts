// /api/vendors/[id]/contacts/[contactId] — edit or remove one contact.
import { updateVendorContactSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const PATCH = withUser<{ id: string; contactId: string }>(
  async ({ req, params, principal, context }) =>
    service.updateContact(
      { principal, context },
      params.id,
      params.contactId,
      await parseBody(req, updateVendorContactSchema)
    )
);

export const DELETE = withUser<{ id: string; contactId: string }>(
  async ({ params, principal, context }) =>
    service.removeContact({ principal, context }, params.id, params.contactId)
);
