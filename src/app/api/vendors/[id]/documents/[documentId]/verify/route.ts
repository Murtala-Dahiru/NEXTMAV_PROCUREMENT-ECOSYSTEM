// /api/vendors/[id]/documents/[documentId]/verify — accept or reject evidence.
import { verifyDocumentSchema } from "@/lib/schemas/procurement";
import { parseBody, withUser } from "@/server/http";
import * as service from "@/server/services/vendor-service";

export const runtime = "nodejs";

export const POST = withUser<{ id: string; documentId: string }>(
  async ({ req, params, principal, context }) =>
    service.verifyDocument(
      { principal, context },
      params.id,
      params.documentId,
      await parseBody(req, verifyDocumentSchema)
    )
);
