// NextMav Procure — one RFQ, as the supplier sees it.

import { redirect } from "next/navigation";
import { getSupplierPrincipal } from "@/server/session";
import { requestContext } from "@/server/audit";
import * as service from "@/server/services/supplier-service";
import { PortalChrome } from "../../portal-chrome";
import { SupplierRfqView } from "./supplier-rfq-view";

export const dynamic = "force-dynamic";

export default async function SupplierRfqPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getSupplierPrincipal();
  if (!principal) redirect("/supplier/login");

  const { id } = await params;
  const context = await requestContext();
  const me = await service.me({ principal, context });

  return (
    <PortalChrome
      contactName={me.contact.name}
      companyName={me.vendor.companyName}
      buyerName={me.buyer.name}
    >
      <SupplierRfqView rfqId={id} />
    </PortalChrome>
  );
}
