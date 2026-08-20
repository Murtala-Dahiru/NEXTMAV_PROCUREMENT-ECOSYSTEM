// NextMav Procure — supplier sign-in.
//
// Its own screen, its own endpoint, its own cookie. See src/server/session.ts for
// why the supplier and employee realms never share a code path.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getSupplierPrincipal } from "@/server/session";
import { SupplierSignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Supplier sign in — NextMav Procure",
};

export const dynamic = "force-dynamic";

export default async function SupplierLoginPage() {
  const principal = await getSupplierPrincipal();
  if (principal) redirect("/supplier");

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight text-foreground">Supplier Portal</p>
            <p className="text-xs text-muted-foreground">NextMav Procure</p>
          </div>
        </div>

        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Respond to invitations, submit quotations and follow their outcome.
        </p>

        <div className="mt-6">
          <SupplierSignInForm />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Your buying organization issues portal access. If you cannot sign in, ask your procurement contact to check
          that your account is active.
        </p>
      </div>
    </div>
  );
}
