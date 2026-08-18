// /api/bootstrap — the organization's data, shaped for the existing client types.
import { withUser } from "@/server/http";
import * as service from "@/server/services/bootstrap-service";

export const runtime = "nodejs";

export const GET = withUser(async ({ principal, context }) =>
  service.bootstrap({ principal, context })
);
