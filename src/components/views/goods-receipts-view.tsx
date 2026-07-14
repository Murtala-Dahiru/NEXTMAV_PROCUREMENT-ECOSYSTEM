// NextMav Procure — Goods Receiving

"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Package,
  Plus,
  Search,
  Truck,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, GoodsReceiptStatusBadge, KpiCard, PageHeader, SectionCard } from "@/components/shared";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function GoodsReceiptsView() {
  const navigate = useStore((s) => s.navigate);
  const goodsReceipts = useStore((s) => s.goodsReceipts);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const vendors = useStore((s) => s.vendors);
  const users = useStore((s) => s.users);
  const createGoodsReceipt = useStore((s) => s.createGoodsReceipt);

  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState<string | null>(null); // poId
  const [receivedQtys, setReceivedQtys] = useState<Record<string, number>>({});

  const filtered = useMemo(() => {
    return goodsReceipts
      .filter((gr) => {
        if (!search) return true;
        const q = search.toLowerCase();
        const vendor = vendors.find((v) => v.id === gr.vendorId);
        return gr.receiptNumber.toLowerCase().includes(q) || vendor?.companyName.toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());
  }, [goodsReceipts, vendors, search]);

  // POs that can receive goods (issued/acknowledged/in_delivery but not fully received)
  const receivablePOs = purchaseOrders.filter((p) => p.status === "ISSUED" || p.status === "ACKNOWLEDGED" || p.status === "IN_DELIVERY");

  const pendingDeliveries = receivablePOs.length;
  const partialReceipts = goodsReceipts.filter((g) => g.status === "PARTIAL").length;
  const completedReceipts = goodsReceipts.filter((g) => g.status === "RECEIVED").length;

  const handleCreateReceipt = (poId: string) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) return;
    const items = po.lineItems.map((li) => ({
      lineItemId: li.id,
      itemName: li.itemName,
      orderedQty: li.quantity,
      receivedQty: receivedQtys[li.id] ?? li.quantity,
      unit: li.unit,
      condition: "GOOD" as const,
    }));
    createGoodsReceipt({ poId, vendorId: po.vendorId, items });
    toast.success("Goods receipt created", { description: `Receipt generated for ${po.poNumber}` });
    setShowCreate(null);
    setReceivedQtys({});
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goods Receiving"
        description="Receive, inspect, and track incoming deliveries against purchase orders."
        actions={
          receivablePOs.length > 0 && (
            <button
              onClick={() => setShowCreate(receivablePOs[0].id)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Plus size={15} /> New Receipt
            </button>
          )
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending Deliveries" value={pendingDeliveries} icon={Truck} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Partial Receipts" value={partialReceipts} icon={Package} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Completed" value={completedReceipts} icon={CheckCircle2} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Total Receipts" value={goodsReceipts.length} icon={ClipboardCheck} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      {/* Receivable POs */}
      {receivablePOs.length > 0 && (
        <SectionCard title="Awaiting Delivery" description={`${receivablePOs.length} purchase orders pending goods receipt`}>
          <div className="space-y-2">
            {receivablePOs.map((po) => {
              const vendor = vendors.find((v) => v.id === po.vendorId);
              return (
                <div key={po.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 shrink-0">
                    <Truck size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground font-mono">{po.poNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{vendor?.companyName} · {po.lineItems.length} item(s) · Expected {formatDate(po.expectedDelivery)}</p>
                  </div>
                  <button
                    onClick={() => setShowCreate(po.id)}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 text-xs font-medium hover:opacity-95 transition-opacity"
                  >
                    <Plus size={12} /> Receive
                  </button>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search receipts…"
          className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No goods receipts" description="Receive deliveries from the awaiting POs above." />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Receipt #</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">PO</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Vendor</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Status</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Items</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Received By</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((gr) => {
                  const po = purchaseOrders.find((p) => p.id === gr.poId);
                  const vendor = vendors.find((v) => v.id === gr.vendorId);
                  const receiver = users.find((u) => u.id === gr.receivedById);
                  return (
                    <tr key={gr.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => { useStore.getState().selectPo(gr.poId); navigate("po-detail"); }}>
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-sm font-medium text-foreground">{gr.receiptNumber}</p>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs font-mono text-muted-foreground">{po?.poNumber ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-semibold shrink-0">
                            {vendor?.companyName.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm text-foreground truncate">{vendor?.companyName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5"><GoodsReceiptStatusBadge status={gr.status} /></td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs text-muted-foreground">{gr.items.length} item(s)</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs text-foreground">{receiver?.name ?? "—"}</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground">{formatDate(gr.receivedDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Create receipt dialog */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreate(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const po = purchaseOrders.find((p) => p.id === showCreate);
              const vendor = vendors.find((v) => v.id === po?.vendorId);
              if (!po) return null;
              return (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Receive Goods</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{po.poNumber} · {vendor?.companyName}</p>
                    </div>
                    <button onClick={() => setShowCreate(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
                  </div>
                  <div className="space-y-3">
                    {po.lineItems.map((li) => (
                      <div key={li.id} className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{li.itemName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Ordered: {li.quantity} {li.unit} · {formatCurrency(li.estimatedCost, po.currency)} each</p>
                          </div>
                          <div className="shrink-0">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase">Received Qty</label>
                            <input
                              type="number"
                              min="0"
                              max={li.quantity}
                              defaultValue={li.quantity}
                              onChange={(e) => setReceivedQtys({ ...receivedQtys, [li.id]: parseFloat(e.target.value) || 0 })}
                              className="mt-0.5 w-20 h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setShowCreate(null)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => handleCreateReceipt(showCreate)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                      <CheckCircle2 size={14} /> Confirm Receipt
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
