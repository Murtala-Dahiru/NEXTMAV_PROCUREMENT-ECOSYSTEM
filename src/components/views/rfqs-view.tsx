// NextMav Procure — RFQ list view

"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Clock,
  FileText,
  Plus,
  Search,
  Send,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, RFQStatusBadge, SectionCard } from "@/components/shared";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RfqsView() {
  const navigate = useStore((s) => s.navigate);
  const selectRfq = useStore((s) => s.selectRfq);
  const rfqs = useStore((s) => s.rfqs);
  const vendors = useStore((s) => s.vendors);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return rfqs
      .filter((r) => {
        if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          if (!r.title.toLowerCase().includes(q) && !r.rfqNumber.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rfqs, statusFilter, search]);

  const waiting = rfqs.filter((r) => r.status === "WAITING").length;
  const received = rfqs.filter((r) => r.status === "RECEIVED").length;
  const closed = rfqs.filter((r) => r.status === "CLOSED").length;
  const totalQuotations = rfqs.reduce((s, r) => s + r.quotations.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request for Quotations"
        description="Issue RFQs to vendors, collect quotations, and compare bids side-by-side."
        actions={
          <button
            onClick={() => navigate("rfq-new")}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New RFQ</span>
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Waiting" value={waiting} icon={Clock} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Received" value={received} icon={FileText} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Closed" value={closed} icon={FileText} iconBg="bg-muted" />
        <KpiCard label="Total Quotations" value={totalQuotations} icon={Users} iconBg="bg-sky-100 dark:bg-sky-950/40" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search RFQs…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="WAITING">Waiting</SelectItem>
            <SelectItem value="RECEIVED">Received</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No RFQs yet"
          description="Create an RFQ to invite vendors to submit quotations."
          action={
            <button
              onClick={() => navigate("rfq-new")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
            >
              <Plus size={15} /> New RFQ
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((rfq) => {
            const invitedVendors = rfq.invitedVendorIds
              .map((id) => vendors.find((v) => v.id === id))
              .filter(Boolean);
            const lowestQuote = rfq.quotations.length > 0
              ? Math.min(...rfq.quotations.map((q) => q.totalAmount))
              : null;
            return (
              <button
                key={rfq.id}
                onClick={() => {
                  selectRfq(rfq.id);
                  navigate("rfq-detail");
                }}
                className="group text-left rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{rfq.rfqNumber}</span>
                      <RFQStatusBadge status={rfq.status} />
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-foreground truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {rfq.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{rfq.description}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 pt-4 border-t border-border">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendors</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      {invitedVendors.length}
                      <span className="text-xs text-muted-foreground font-normal ml-1">invited</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Quotes</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      {rfq.quotations.length}
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-normal ml-1">received</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Lowest</p>
                    <p className="text-sm font-semibold text-foreground mt-0.5 tabular-nums">
                      {lowestQuote !== null ? formatCurrency(lowestQuote) : "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Deadline: {formatDate(rfq.deadline)}</span>
                  <span className="flex items-center gap-0.5 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    View details <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
