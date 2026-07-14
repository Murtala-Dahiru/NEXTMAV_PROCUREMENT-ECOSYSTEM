// NextMav Procure — Contract Management

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  Plus,
  Search,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ContractStatusBadge, EmptyState, KpiCard, PageHeader, SectionCard, Tag } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ContractsView() {
  const navigate = useStore((s) => s.navigate);
  const contracts = useStore((s) => s.contracts);
  const vendors = useStore((s) => s.vendors);
  const users = useStore((s) => s.users);
  const renewContract = useStore((s) => s.renewContract);
  const terminateContract = useStore((s) => s.terminateContract);
  const createContract = useStore((s) => s.createContract);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [ctrForm, setCtrForm] = useState({
    title: "",
    vendorId: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    value: 0,
    autoRenew: true,
    renewalNoticeDays: 60,
    slaTerms: "",
    description: "",
  });

  const filtered = useMemo(() => {
    return contracts
      .filter((c) => {
        if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const vendor = vendors.find((v) => v.id === c.vendorId);
          return c.title.toLowerCase().includes(q) || c.contractNumber.toLowerCase().includes(q) || vendor?.companyName.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [contracts, vendors, statusFilter, search]);

  const totalValue = contracts.reduce((s, c) => s + c.value, 0);
  const activeValue = contracts.filter((c) => c.status === "ACTIVE").reduce((s, c) => s + c.value, 0);
  const expiringCount = contracts.filter((c) => c.status === "EXPIRING" || (c.status === "ACTIVE" && new Date(c.endDate) < new Date(Date.now() + 30 * 86400000))).length;
  const expiredCount = contracts.filter((c) => c.status === "EXPIRED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Management"
        description="Track contracts, renewals, SLAs, and expiry dates across all vendor relationships."
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Contract
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Contracts" value={contracts.length} icon={FileText} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Active Value" value={formatCompactCurrency(activeValue)} icon={FileText} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Expiring (30d)" value={expiringCount} delta="Renewal needed" deltaType={expiringCount > 0 ? "down" : "neutral"} icon={Calendar} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Expired" value={expiredCount} icon={XCircle} iconBg="bg-rose-100 dark:bg-rose-950/40" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, contract number, or vendor…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="EXPIRING">Expiring</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
            <SelectItem value="TERMINATED">Terminated</SelectItem>
            <SelectItem value="RENEWED">Renewed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts found" description="Create contracts to track vendor agreements and renewals." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((c) => {
            const vendor = vendors.find((v) => v.id === c.vendorId);
            const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
            const isExpiringSoon = c.status === "ACTIVE" && daysLeft < 30 && daysLeft >= 0;
            const isExpired = c.status === "EXPIRED" || daysLeft < 0;
            return (
              <div key={c.id} className="rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{c.contractNumber}</span>
                      <ContractStatusBadge status={c.status} />
                      {c.autoRenew && <Tag label="Auto-renew" color="emerald" />}
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-foreground">{c.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Vendor</p>
                    <p className="text-foreground font-medium truncate mt-0.5">{vendor?.companyName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Value</p>
                    <p className="text-foreground font-medium mt-0.5 tabular-nums">{formatCurrency(c.value, c.currency)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Start Date</p>
                    <p className="text-foreground mt-0.5">{formatDate(c.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">End Date</p>
                    <p className={cn("mt-0.5", isExpired ? "text-rose-600 dark:text-rose-400 font-medium" : isExpiringSoon ? "text-amber-600 dark:text-amber-400 font-medium" : "text-foreground")}>
                      {formatDate(c.endDate)}
                      {isExpired && " (expired)"}
                      {isExpiringSoon && ` (${daysLeft}d left)`}
                    </p>
                  </div>
                </div>

                {c.slaTerms && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">SLA Terms</p>
                    <p className="text-xs text-foreground line-clamp-2">{c.slaTerms}</p>
                  </div>
                )}

                {c.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {c.tags.map((t) => <Tag key={t} label={t} />)}
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{c.versions.length} version(s)</span>
                  <div className="flex items-center gap-1">
                    {(c.status === "EXPIRED" || c.status === "EXPIRING") && (
                      <button
                        onClick={() => {
                          const newEnd = new Date(Date.now() + 365 * 86400000).toISOString();
                          renewContract(c.id, newEnd);
                          toast.success("Contract renewed", { description: `${c.title} renewed for 1 year` });
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-950/60 transition-colors"
                      >
                        <RefreshCw size={11} /> Renew
                      </button>
                    )}
                    {c.status === "ACTIVE" && (
                      <button
                        onClick={() => {
                          if (confirm(`Terminate ${c.title}?`)) {
                            terminateContract(c.id);
                            toast.info("Contract terminated");
                          }
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 px-2 text-xs font-medium hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                      >
                        <XCircle size={11} /> Terminate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Contract dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Create New Contract</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Register a vendor contract with SLA terms and renewal tracking.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Contract Title <span className="text-rose-500">*</span></label>
                <input value={ctrForm.title} onChange={(e) => setCtrForm({ ...ctrForm, title: e.target.value })} placeholder="e.g. Annual IT Support Contract" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Vendor <span className="text-rose-500">*</span></label>
                <select value={ctrForm.vendorId} onChange={(e) => setCtrForm({ ...ctrForm, vendorId: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all">
                  <option value="">Select vendor…</option>
                  {vendors.filter((v) => v.status !== "BLACKLISTED").map((v) => <option key={v.id} value={v.id}>{v.companyName}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Start Date <span className="text-rose-500">*</span></label>
                  <input type="date" value={ctrForm.startDate} onChange={(e) => setCtrForm({ ...ctrForm, startDate: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">End Date <span className="text-rose-500">*</span></label>
                  <input type="date" value={ctrForm.endDate} onChange={(e) => setCtrForm({ ...ctrForm, endDate: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Contract Value (₦) <span className="text-rose-500">*</span></label>
                  <input type="number" value={ctrForm.value || ""} onChange={(e) => setCtrForm({ ...ctrForm, value: parseFloat(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Renewal Notice (days)</label>
                  <input type="number" value={ctrForm.renewalNoticeDays} onChange={(e) => setCtrForm({ ...ctrForm, renewalNoticeDays: parseInt(e.target.value) || 60 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">SLA Terms</label>
                <textarea value={ctrForm.slaTerms} onChange={(e) => setCtrForm({ ...ctrForm, slaTerms: e.target.value })} rows={2} placeholder="e.g. 4-hour response time, quarterly maintenance…" className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description</label>
                <textarea value={ctrForm.description} onChange={(e) => setCtrForm({ ...ctrForm, description: e.target.value })} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ctrForm.autoRenew} onChange={(e) => setCtrForm({ ...ctrForm, autoRenew: e.target.checked })} className="h-4 w-4 rounded border-border" />
                <span className="text-foreground">Auto-renew at end date</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!ctrForm.title.trim()) { toast.error("Contract title required"); return; }
                  if (!ctrForm.vendorId) { toast.error("Vendor required"); return; }
                  if (!ctrForm.endDate) { toast.error("End date required"); return; }
                  if (ctrForm.value <= 0) { toast.error("Contract value must be greater than zero"); return; }
                  createContract({
                    title: ctrForm.title.trim(),
                    vendorId: ctrForm.vendorId,
                    status: "ACTIVE",
                    startDate: new Date(ctrForm.startDate).toISOString(),
                    endDate: new Date(ctrForm.endDate).toISOString(),
                    value: ctrForm.value,
                    currency: "NGN",
                    autoRenew: ctrForm.autoRenew,
                    renewalNoticeDays: ctrForm.renewalNoticeDays,
                    slaTerms: ctrForm.slaTerms || undefined,
                    description: ctrForm.description || undefined,
                  } as any);
                  toast.success("Contract created", { description: `${ctrForm.title} has been registered` });
                  setShowForm(false);
                  setCtrForm({ title: "", vendorId: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", value: 0, autoRenew: true, renewalNoticeDays: 60, slaTerms: "", description: "" });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={14} /> Create Contract
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
