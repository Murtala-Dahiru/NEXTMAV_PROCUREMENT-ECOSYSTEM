// NextMav Procure — the supplier's home.
//
// Resolves the supplier principal on the server before a byte is rendered, the
// same gate the buyer's application uses. An anonymous request never sees the
// portal's markup.

import { redirect } from "next/navigation";
import { getSupplierPrincipal } from "@/server/session";
import { PortalChrome } from "./portal-chrome";
import { SupplierHome } from "./supplier-home";
import * as service from "@/server/services/supplier-service";
import { requestContext } from "@/server/audit";

export const dynamic = "force-dynamic";

export default async function SupplierHomePage() {
  const principal = await getSupplierPrincipal();
  if (!principal) redirect("/supplier/login");

  const context = await requestContext();
  const me = await service.me({ principal, context });

  return (
    <PortalChrome
      contactName={me.contact.name}
      companyName={me.vendor.companyName}
      buyerName={me.buyer.name}
    >
      <SupplierHome />
    </PortalChrome>
  );
}
