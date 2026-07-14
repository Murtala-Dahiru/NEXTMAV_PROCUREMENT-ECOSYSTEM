// NextMav Procure — Purchase Orders list

"use client";

import { useMemo, useState } from "react";
import {
  Download,
  Package,
  Plus,
  Search,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, KpiCard, PageHeader, POStatusBadge, SectionCard } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { type PurchaseOrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PurchaseOrdersView() {
  const navigate = useStore((s) => s.navigate);
  const selectPo = useStore((s) => s.selectPo);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const vendors = useStore((s) => s.vendors);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return purchaseOrders
      .filter((po) => {
        if (statusFilter !== "ALL" && po.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const vendor = vendors.find((v) => v.id === po.vendorId);
          const matches =
            po.poNumber.toLowerCase().includes(q) ||
            (vendor?.companyName.toLowerCase().includes(q) ?? false) ||
            (po.notes?.toLowerCase().includes(q) ?? false);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }, [purchaseOrders, vendors, statusFilter, search]);

  const totalValue = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
  const issued = purchaseOrders.filter((p) => p.status === "ISSUED" || p.status === "ACKNOWLEDGED").length;
  const inDelivery = purchaseOrders.filter((p) => p.status === "IN_DELIVERY").length;
  const received = purchaseOrders.filter((p) => p.status === "RECEIVED" || p.status === "CLOSED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description={`${purchaseOrders.length} POs issued · ${formatCompactCurrency(totalValue)} total value`}
        actions={
          <button
            onClick={() => navigate("rfqs")}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Generate from RFQ</span>
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total POs" value={purchaseOrders.length} icon={Package} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Issued" value={issued} icon={Package} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="In Delivery" value={inDelivery} icon={Package} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Received" value={received} icon={Package} iconBg="bg-teal-100 dark:bg-teal-950/40" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO number, vendor, or notes…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ISSUED">Issued</SelectItem>
            <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
            <SelectItem value="IN_DELIVERY">In Delivery</SelectItem>
            <SelectItem value="RECEIVED">Received</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No purchase orders found"
          description="Purchase orders are generated automatically when you select a quotation from an RFQ."
        />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">PO Number</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Vendor</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Status</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Total</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Issued</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Expected</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((po) => {
                  const vendor = vendors.find((v) => v.id === po.vendorId);
                  return (
                    <tr
                      key={po.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => {
                        selectPo(po.id);
                        navigate("po-detail");
                      }}
                    >
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-sm font-medium text-foreground">{po.poNumber}</p>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-semibold shrink-0">
                            {vendor?.companyName.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm text-foreground truncate">{vendor?.companyName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5"><POStatusBadge status={po.status} /></td>
                      <td className="px-3 py-3.5 text-right">
                        <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(po.totalAmount, po.currency)}</p>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">{formatDate(po.issuedAt)}</td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">{formatDate(po.expectedDelivery)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            selectPo(po.id);
                            navigate("po-detail");
                          }}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                        >
                          View →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
