// NextMav Procure — RFQ detail with quotation comparison

"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  Phone,
  Plus,
  Send,
  Star,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, PageHeader, PriorityBadge, RatingStars, RFQStatusBadge, SectionCard, StatusBadge } from "@/components/shared";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function RfqDetailView() {
  const navigate = useStore((s) => s.navigate);
  const rfqId = useStore((s) => s.selectedRfqId);
  const rfqs = useStore((s) => s.rfqs);
  const vendors = useStore((s) => s.vendors);
  const requests = useStore((s) => s.requests);
  const users = useStore((s) => s.users);
  const selectQuotation = useStore((s) => s.selectQuotation);
  const generatePO = useStore((s) => s.generatePO);

  const [confirmSelect, setConfirmSelect] = useState<string | null>(null);

  const rfq = rfqs.find((r) => r.id === rfqId);

  if (!rfq) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate("rfqs")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to RFQs
        </button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">RFQ not found.</p>
        </div>
      </div>
    );
  }

  const linkedRequest = requests.find((r) => r.id === rfq.requestId);
  const invitedVendors = rfq.invitedVendorIds
    .map((id) => vendors.find((v) => v.id === id))
    .filter(Boolean) as typeof vendors;
  const selectedQuote = rfq.quotations.find((q) => q.id === rfq.selectedQuotationId);

  const handleSelectQuotation = (quotationId: string) => {
    selectQuotation(rfq.id, quotationId);
    setConfirmSelect(null);
    const quote = rfq.quotations.find((q) => q.id === quotationId);
    const vendor = vendors.find((v) => v.id === quote?.vendorId);
    toast.success("Quotation selected", {
      description: `${vendor?.companyName}'s quotation has been selected. You can now generate a Purchase Order.`,
    });
  };

  const handleGeneratePO = async () => {
    if (!selectedQuote) return;
    const vendor = vendors.find((v) => v.id === selectedQuote.vendorId);
    const linkedReq = requests.find((r) => r.id === rfq.requestId);
    const { mutate } = await import("@/lib/api/client");
    const poId = await mutate(() => generatePO({
      requestId: rfq.requestId,
      rfqId: rfq.id,
      quotationId: selectedQuote.id,
      vendorId: selectedQuote.vendorId,
      lineItems: linkedReq?.lineItems ?? [
        {
          id: "li_default",
          itemName: rfq.title,
          description: rfq.description,
          quantity: 1,
          unit: "lot",
          estimatedCost: selectedQuote.totalAmount,
        },
      ],
      notes: `Auto-generated from ${rfq.rfqNumber}. Vendor: ${vendor?.companyName}. Delivery: ${selectedQuote.deliveryDays} days. Payment: ${selectedQuote.paymentTerms}.`,
      expectedDelivery: new Date(Date.now() + selectedQuote.deliveryDays * 86400000).toISOString(),
    }), { success: `Purchase order issued to ${vendor?.companyName}` });
    if (!poId) return;
    useStore.getState().selectPo(poId);
    navigate("po-detail");
  };

  // Compute best per category for highlighting
  const lowestAmount = Math.min(...rfq.quotations.map((q) => q.totalAmount));
  const fastestDelivery = Math.min(...rfq.quotations.map((q) => q.deliveryDays));
  const bestRatedVendor = rfq.quotations
    .map((q) => vendors.find((v) => v.id === q.vendorId))
    .sort((a, b) => (b?.rating ?? 0) - (a?.rating ?? 0))[0];

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("rfqs")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Back to RFQs
      </button>

      <PageHeader
        title={rfq.title}
        description={`${rfq.rfqNumber} · Created ${formatRelativeTime(rfq.createdAt)}`}
        actions={
          <>
            <RFQStatusBadge status={rfq.status} />
            {selectedQuote && (
              <button
                onClick={handleGeneratePO}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={15} />
                Generate Purchase Order
              </button>
            )}
          </>
        }
      />

      {/* Top info */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Description" className="lg:col-span-2">
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{rfq.description}</p>
          {linkedRequest && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">Linked Purchase Request</p>
              <button
                onClick={() => {
                  useStore.getState().selectRequest(linkedRequest.id);
                  navigate("request-detail");
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
              >
                <FileText size={14} className="text-muted-foreground" />
                <span className="font-mono text-xs">{linkedRequest.requestNumber}</span>
                <span className="text-foreground">{linkedRequest.title}</span>
                <StatusBadge status={linkedRequest.status} />
              </button>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Timeline">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1.5"><Calendar size={13} /> Created</dt>
              <dd className="text-foreground">{formatDate(rfq.createdAt)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1.5"><Clock size={13} /> Deadline</dt>
              <dd className="text-foreground font-medium">{formatDate(rfq.deadline)}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1.5"><Users size={13} /> Vendors Invited</dt>
              <dd className="text-foreground">{rfq.invitedVendorIds.length}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground flex items-center gap-1.5"><Send size={13} /> Quotations</dt>
              <dd className="text-foreground font-medium">{rfq.quotations.length}</dd>
            </div>
            {selectedQuote && (
              <div className="pt-3 border-t border-border">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Quotation Selected</p>
                  <p className="text-sm text-foreground mt-0.5">
                    {vendors.find((v) => v.id === selectedQuote.vendorId)?.companyName} · {formatCurrency(selectedQuote.totalAmount)}
                  </p>
                </div>
              </div>
            )}
          </dl>
        </SectionCard>
      </div>

      {/* Quotation Comparison */}
      <SectionCard
        title="Quotation Comparison"
        description={`${rfq.quotations.length} quotation${rfq.quotations.length !== 1 ? "s" : ""} received. Compare and select the best supplier.`}
        bodyClassName="p-0"
      >
        {rfq.quotations.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Clock size={28} className="mx-auto text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-foreground">Awaiting quotations</p>
            <p className="text-xs text-muted-foreground mt-1">
              Vendors have until {formatDate(rfq.deadline)} to respond.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Vendor</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Total Amount</th>
                  <th className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Delivery</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Warranty</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Payment Terms</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Rating</th>
                  <th className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rfq.quotations.map((q) => {
                  const vendor = vendors.find((v) => v.id === q.vendorId);
                  if (!vendor) return null;
                  const isSelected = rfq.selectedQuotationId === q.id;
                  const isLowest = q.totalAmount === lowestAmount;
                  const isFastest = q.deliveryDays === fastestDelivery;
                  const isBestRated = bestRatedVendor?.id === vendor.id;
                  return (
                    <tr
                      key={q.id}
                      className={cn(
                        "hover:bg-muted/30 transition-colors",
                        isSelected && "bg-emerald-50/40 dark:bg-emerald-950/15"
                      )}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold text-xs shrink-0">
                            {vendor.companyName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{vendor.companyName}</p>
                            <p className="text-xs text-muted-foreground truncate">{vendor.contactPerson}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isLowest && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                              <Award size={10} /> LOWEST
                            </span>
                          )}
                          <span className="text-sm font-semibold text-foreground tabular-nums">
                            {formatCurrency(q.totalAmount, q.currency)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isFastest && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded-full">
                              <Truck size={10} /> FASTEST
                            </span>
                          )}
                          <span className="text-sm text-foreground tabular-nums">{q.deliveryDays}d</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-xs text-foreground max-w-[160px]">{q.warranty}</td>
                      <td className="px-3 py-4 text-xs text-foreground">{q.paymentTerms}</td>
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-1.5">
                          {isBestRated && vendor.rating > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-full">
                              <Star size={10} /> BEST
                            </span>
                          )}
                          <RatingStars rating={vendor.rating} size={12} />
                        </div>
                      </td>
                      <td className="px-3 py-4 text-center">
                        {isSelected ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full">
                            <CheckCircle2 size={13} /> Selected
                          </span>
                        ) : rfq.selectedQuotationId ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <button
                            onClick={() => setConfirmSelect(q.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 px-2.5 py-1 rounded-full transition-colors"
                          >
                            <Check size={13} /> Select
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Notes per quotation */}
      {rfq.quotations.length > 0 && (
        <SectionCard title="Vendor Notes" description="Additional context provided by each vendor">
          <div className="space-y-3">
            {rfq.quotations.map((q) => {
              const vendor = vendors.find((v) => v.id === q.vendorId);
              return (
                <div key={q.id} className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-semibold">
                      {vendor?.companyName.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="text-sm font-medium text-foreground">{vendor?.companyName}</p>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(q.createdAt)}</span>
                  </div>
                  <p className="text-sm text-foreground italic">"{q.notes}"</p>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Invited vendors */}
      <SectionCard title="Invited Vendors" description={`${invitedVendors.length} vendors invited to quote`}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {invitedVendors.map((v) => (
            <div
              key={v.id}
              className="rounded-lg border border-border bg-muted/30 p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-semibold">
                  {v.companyName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{v.companyName}</p>
                  <p className="text-xs text-muted-foreground truncate">{v.category}</p>
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><Mail size={11} /> <span className="truncate">{v.email}</span></div>
                <div className="flex items-center gap-1.5"><Phone size={11} /> <span className="truncate">{v.phone}</span></div>
              </div>
              <div className="mt-2 pt-2 border-t border-border">
                {rfq.quotations.find((q) => q.vendorId === v.id) ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={12} /> Quoted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <Clock size={12} /> Awaiting response
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Confirmation dialog */}
      {confirmSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmSelect(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 shrink-0">
                <Award size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Select this quotation?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  You're about to select <strong className="text-foreground">{vendors.find((v) => v.id === rfq.quotations.find((q) => q.id === confirmSelect)?.vendorId)?.companyName}</strong> as the supplier for this RFQ.
                  You can then generate a Purchase Order directly.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmSelect(null)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSelectQuotation(confirmSelect)}
                className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
              >
                Confirm Selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
