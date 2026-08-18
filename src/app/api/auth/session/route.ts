// GET /api/auth/session — resolves the current employee session.
//
// The client bootstraps from this instead of trusting a locally persisted
// `isAuthed` flag. It returns the user's effective permissions so the UI can
// render the right affordances — those permissions are a *hint* for rendering;
// the server re-checks every one of them on the actual mutation.

import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getInternalPrincipal } from "@/server/session";
import { effectivePermissions } from "@/server/permissions";

export const runtime = "nodejs";

export async function GET() {
  const principal = await getInternalPrincipal();
  if (!principal) {
    return NextResponse.json({ authenticated: false, user: null, organization: null });
  }

  const [organization, permissions] = await Promise.all([
    db.organization.findUnique({
      where: { id: principal.organizationId },
      select: {
        id: true,
        name: true,
        legalName: true,
        currency: true,
        country: true,
        logoUrl: true,
        brandPrimaryColor: true,
        brandAccentColor: true,
        fiscalYearStartMonth: true,
      },
    }),
    effectivePermissions(principal),
  ]);

  return NextResponse.json({
    authenticated: true,
    user: {
      id: principal.userId,
      name: principal.name,
      email: principal.email,
      role: principal.role,
      departmentId: principal.departmentId,
      branchId: principal.branchId,
    },
    organization,
    permissions,
  });
}
