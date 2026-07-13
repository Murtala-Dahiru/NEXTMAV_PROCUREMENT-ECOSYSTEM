// NextMav Procure — Purchase Order detail with printable PO

"use client";

import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  Download,
  Mail,
  MapPin,
  Package,
  Phone,
  Printer,
  Truck,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, PageHeader, POStatusBadge, SectionCard } from "@/components/shared";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { type PurchaseOrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function PoDetailView() {
  const navigate = useStore((s) => s.navigate);
  const poId = useStore((s) => s.selectedPoId);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const vendors = useStore((s) => s.vendors);
  const organization = useStore((s) => s.organization);
  const users = useStore((s) => s.users);
  const updatePOStatus = useStore((s) => s.updatePOStatus);

  const po = purchaseOrders.find((p) => p.id === poId);

  if (!po) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate("purchase-orders")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to purchase orders
        </button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Purchase order not found.</p>
        </div>
      </div>
    );
  }

  const vendor = vendors.find((v) => v.id === po.vendorId);
  const subtotal = po.totalAmount;
  const tax = subtotal * (po.taxRate / 100);
  const total = subtotal + tax;

  const statusOptions: PurchaseOrderStatus[] = ["ISSUED", "ACKNOWLEDGED", "IN_DELIVERY", "RECEIVED", "CLOSED", "CANCELLED"];

  const handleStatusUpdate = (status: PurchaseOrderStatus) => {
    updatePOStatus(po.id, status);
    toast.success("Status updated", { description: `${po.poNumber} is now ${status.toLowerCase().replace("_", " ")}.` });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <button
          onClick={() => navigate("purchase-orders")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft size={14} /> Back to purchase orders
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Print</span>
          </button>
          <button
            onClick={() => toast.info("PDF export", { description: "PDF would be downloaded in production." })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Download PDF</span>
          </button>
          <button
            onClick={() => toast.info("Email sent", { description: `PO emailed to ${vendor?.email}` })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Mail size={14} />
            <span className="hidden sm:inline">Email to Vendor</span>
          </button>
        </div>
      </div>

      {/* PO document */}
      <div className="rounded-xl border border-border bg-card p-8 print:border-0 print:p-0">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between gap-6 pb-6 border-b border-border">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Package size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{organization.name}</p>
                <p className="text-xs text-muted-foreground">{organization.legalName}</p>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground space-y-0.5">
              <p>{organization.country} · {organization.industry}</p>
              <p>Tax ID: {organization.taxId}</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Purchase Order</p>
            <p className="text-2xl font-bold text-foreground font-mono mt-1">{po.poNumber}</p>
            <div className="mt-2 inline-flex items-center">
              <POStatusBadge status={po.status} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Issued: <span className="text-foreground font-medium">{formatDate(po.issuedAt)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Expected delivery: <span className="text-foreground font-medium">{formatDate(po.expectedDelivery)}</span>
            </p>
          </div>
        </div>

        {/* Vendor + ship-to */}
        <div className="grid sm:grid-cols-2 gap-6 py-6 border-b border-border">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Supplier</p>
            {vendor && (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{vendor.companyName}</p>
                <p className="text-xs text-muted-foreground">{vendor.contactPerson}</p>
                <p className="text-xs text-muted-foreground">{vendor.address}</p>
                <div className="pt-1 space-y-0.5">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail size={11} /> {vendor.email}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone size={11} /> {vendor.phone}
                  </p>
                </div>
                <div className="pt-2 mt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">Tax #: {vendor.taxNumber}</p>
                  <p className="text-xs text-muted-foreground">Bank: {vendor.bankName} ({vendor.bankAccount})</p>
                </div>
              </div>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Deliver To</p>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{organization.name}</p>
              <p className="text-xs text-muted-foreground">Headquarters — Lagos</p>
              <p className="text-xs text-muted-foreground">12 Adeola Odeku Street, Victoria Island</p>
              <p className="text-xs text-muted-foreground">Lagos, Nigeria</p>
              <div className="pt-2 mt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Attn: Procurement Department</p>
                <p className="text-xs text-muted-foreground">Reference: {po.poNumber}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="py-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">#</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">Item</th>
                <th className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">Qty</th>
                <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">Unit</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">Unit Cost</th>
                <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((li, i) => (
                <tr key={li.id} className="border-b border-border">
                  <td className="py-3 text-sm text-muted-foreground">{i + 1}</td>
                  <td className="py-3">
                    <p className="text-sm font-medium text-foreground">{li.itemName}</p>
                    {li.description && <p className="text-xs text-muted-foreground mt-0.5">{li.description}</p>}
                  </td>
                  <td className="py-3 text-sm text-center text-foreground tabular-nums">{li.quantity}</td>
                  <td className="py-3 text-xs text-muted-foreground">{li.unit}</td>
                  <td className="py-3 text-sm text-right text-foreground tabular-nums">{formatCurrency(li.estimatedCost, po.currency)}</td>
                  <td className="py-3 text-sm text-right font-medium text-foreground tabular-nums">{formatCurrency(li.quantity * li.estimatedCost, po.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end py-4 border-t border-border">
          <div className="w-full sm:w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground tabular-nums">{formatCurrency(subtotal, po.currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax ({po.taxRate}%)</span>
              <span className="text-foreground tabular-nums">{formatCurrency(tax, po.currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-base font-bold text-foreground tabular-nums">{formatCurrency(total, po.currency)}</span>
            </div>
          </div>
        </div>

        {/* Notes & signatures */}
        {(po.notes || true) && (
          <div className="grid sm:grid-cols-2 gap-6 pt-6 border-t border-border">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Terms & Notes</p>
              <p className="text-xs text-foreground leading-relaxed">
                {po.notes || "Payment terms: Net 30 days from receipt of invoice. Goods must be delivered in full by the expected delivery date. Any discrepancies must be reported within 48 hours of receipt."}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Authorized Signatures</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="h-12 border-b border-border" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Procurement Manager</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(po.issuedAt)}</p>
                </div>
                <div>
                  <div className="h-12 border-b border-border" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Finance Officer</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(po.issuedAt)}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status update (non-print) */}
      <div className="print:hidden">
        <SectionCard title="Update Status" description="Track the lifecycle of this purchase order">
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusUpdate(s)}
                disabled={po.status === s}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
                  po.status === s
                    ? "border-primary bg-primary text-primary-foreground cursor-default"
                    : "border-border bg-card text-foreground hover:bg-muted"
                )}
              >
                {po.status === s && <Check size={13} />}
                {s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")}
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
