// NextMav Procure — Asset Management

"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Cpu,
  HardHat,
  MapPin,
  Package,
  Plus,
  QrCode,
  Search,
  Settings2,
  TrendingDown,
  User,
  Wrench,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { AssetStatusBadge, EmptyState, KpiCard, PageHeader, ProgressBar, SectionCard, Tag } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { ASSET_CATEGORY_LABELS, type AssetCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const categoryIcons: Record<AssetCategory, any> = {
  IT_EQUIPMENT: Cpu,
  FURNITURE: Package,
  VEHICLE: Building2,
  MACHINERY: HardHat,
  TOOL: Settings2,
  BUILDING: Building2,
  OTHER: Package,
};

export function AssetsView() {
  const navigate = useStore((s) => s.navigate);
  const assets = useStore((s) => s.assets);
  const users = useStore((s) => s.users);
  const departments = useStore((s) => s.departments);
  const branches = useStore((s) => s.branches);
  const vendors = useStore((s) => s.vendors);
  const retireAsset = useStore((s) => s.retireAsset);
  const createAsset = useStore((s) => s.createAsset);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: "", category: "IT_EQUIPMENT" as AssetCategory, serialNumber: "", purchaseValue: 0, location: "", notes: "" });

  const filtered = useMemo(() => {
    return assets
      .filter((a) => {
        if (categoryFilter !== "ALL" && a.category !== categoryFilter) return false;
        if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return a.name.toLowerCase().includes(q) || a.assetTag.toLowerCase().includes(q) || (a.serialNumber?.toLowerCase().includes(q) ?? false);
        }
        return true;
      })
      .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
  }, [assets, categoryFilter, statusFilter, search]);

  const totalValue = assets.reduce((s, a) => s + a.currentValue, 0);
  const inUseCount = assets.filter((a) => a.status === "IN_USE" || a.status === "ASSIGNED").length;
  const underRepairCount = assets.filter((a) => a.status === "UNDER_REPAIR").length;
  const totalDepreciation = assets.reduce((s, a) => s + (a.purchaseValue - a.currentValue), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset Management"
        description="Track company assets, assignments, maintenance, depreciation, and transfers."
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Asset
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Assets" value={assets.length} icon={Package} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Current Value" value={formatCompactCurrency(totalValue)} icon={TrendingDown} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="In Use / Assigned" value={inUseCount} icon={User} iconBg="bg-violet-100 dark:bg-violet-950/40" />
        <KpiCard label="Under Repair" value={underRepairCount} icon={Wrench} iconBg="bg-amber-100 dark:bg-amber-950/40" />
      </div>

      {/* Asset Analytics Dashboard */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Category breakdown */}
        <SectionCard title="Assets by Category" description="Distribution across asset types">
          <div className="space-y-2">
            {Object.entries(ASSET_CATEGORY_LABELS).map(([key, label]) => {
              const count = assets.filter((a) => a.category === key).length;
              const value = assets.filter((a) => a.category === key).reduce((s, a) => s + a.currentValue, 0);
              const pct = assets.length > 0 ? (count / assets.length) * 100 : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-foreground font-medium">{label}</span>
                    <span className="text-muted-foreground tabular-nums">{count} · {formatCompactCurrency(value)}</span>
                  </div>
                  <ProgressBar value={pct} size="sm" />
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Warranty alerts */}
        <SectionCard title="Warranty Status" description="Assets with expiring or expired warranties">
          <div className="space-y-2">
            {assets.filter((a) => a.warrantyExpiry).slice(0, 4).map((a) => {
              const expiry = new Date(a.warrantyExpiry!);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
              const isExpired = daysLeft < 0;
              const isExpiring = daysLeft >= 0 && daysLeft < 60;
              return (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                  <div className={cn("flex h-7 w-7 items-center justify-center rounded-md shrink-0", isExpired ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" : isExpiring ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400")}>
                    <Wrench size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">{a.assetTag}</p>
                  </div>
                  <span className={cn("text-[10px] font-medium", isExpired ? "text-rose-600 dark:text-rose-400" : isExpiring ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                    {isExpired ? "Expired" : `${daysLeft}d left`}
                  </span>
                </div>
              );
            })}
            {assets.filter((a) => a.warrantyExpiry).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No warranty data</p>
            )}
          </div>
        </SectionCard>

        {/* Depreciation summary */}
        <SectionCard title="Depreciation Summary" description="Value loss across all assets">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Purchase Value</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{formatCompactCurrency(assets.reduce((s, a) => s + a.purchaseValue, 0))}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Value</p>
                <p className="text-sm font-semibold text-foreground tabular-nums mt-0.5">{formatCompactCurrency(totalValue)}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Total Depreciation</span>
                <span className="text-foreground font-medium tabular-nums">{formatCompactCurrency(totalDepreciation)}</span>
              </div>
              <ProgressBar value={assets.length > 0 ? (totalDepreciation / assets.reduce((s, a) => s + a.purchaseValue, 0)) * 100 : 0} size="md" />
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Maintenance Records</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{assets.reduce((s, a) => s + a.maintenanceHistory.length, 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Transfers</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{assets.reduce((s, a) => s + a.transfers.length, 0)}</p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, asset tag, or serial number…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="IN_USE">In Use</SelectItem>
            <SelectItem value="IN_STORAGE">In Storage</SelectItem>
            <SelectItem value="UNDER_REPAIR">Under Repair</SelectItem>
            <SelectItem value="ASSIGNED">Assigned</SelectItem>
            <SelectItem value="RETIRED">Retired</SelectItem>
            <SelectItem value="LOST">Lost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No assets found" description="Assets are auto-created when goods are received, or add them manually." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const Icon = categoryIcons[a.category] ?? Package;
            const assignee = users.find((u) => u.id === a.assignedToId);
            const dept = departments.find((d) => d.id === a.departmentId);
            const branch = branches.find((b) => b.id === a.branchId);
            const vendor = vendors.find((v) => v.id === a.vendorId);
            const depreciationPct = a.purchaseValue > 0 ? Math.round(((a.purchaseValue - a.currentValue) / a.purchaseValue) * 100) : 0;
            const warrantyExpired = a.warrantyExpiry && new Date(a.warrantyExpiry) < new Date();
            return (
              <div key={a.id} className="group rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shrink-0">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{a.assetTag}</p>
                    </div>
                  </div>
                  <AssetStatusBadge status={a.status} />
                </div>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag label={ASSET_CATEGORY_LABELS[a.category]} color="emerald" />
                    {a.serialNumber && <span className="font-mono">SN: {a.serialNumber.slice(0, 12)}</span>}
                  </div>
                  {assignee && (
                    <div className="flex items-center gap-1.5 text-foreground">
                      <User size={12} className="text-muted-foreground" />
                      <span>{assignee.name}</span>
                    </div>
                  )}
                  {a.location && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin size={12} />
                      <span className="truncate">{a.location}</span>
                    </div>
                  )}
                  {dept && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Building2 size={12} />
                      <span className="truncate">{dept.name}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Purchase Value</span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(a.purchaseValue, a.currency)}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Current Value</span>
                    <span className={cn("text-sm font-semibold tabular-nums", depreciationPct > 50 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{formatCurrency(a.currentValue, a.currency)}</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="text-muted-foreground">Depreciation</span>
                      <span className="text-muted-foreground tabular-nums">{depreciationPct}%</span>
                    </div>
                    <ProgressBar value={depreciationPct} size="sm" />
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {a.maintenanceHistory.length} maintenance record(s)
                  </span>
                  {a.warrantyExpiry && (
                    <span className={cn("font-medium", warrantyExpired ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {warrantyExpired ? "Warranty expired" : `Warranty: ${formatDate(a.warrantyExpiry)}`}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1">
                  <button
                    onClick={() => toast.info("QR Code", { description: `QR code for ${a.assetTag} would display.` })}
                    className="flex-1 inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <QrCode size={11} /> QR
                  </button>
                  {a.status !== "RETIRED" && a.status !== "LOST" && (
                    <button
                      onClick={() => {
                        if (confirm(`Retire ${a.name}?`)) {
                          retireAsset(a.id);
                          toast.info("Asset retired");
                        }
                      }}
                      className="flex-1 inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors"
                    >
                      Retire
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Asset dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Register New Asset</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Manually register an asset. Assets are also auto-created from goods receipts.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Asset Name <span className="text-rose-500">*</span></label>
                <input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="e.g. Dell Laptop Latitude 5540" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Category</label>
                  <select value={assetForm.category} onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value as AssetCategory })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all">
                    {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Serial Number</label>
                  <input value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Purchase Value (₦) <span className="text-rose-500">*</span></label>
                  <input type="number" value={assetForm.purchaseValue || ""} onChange={(e) => setAssetForm({ ...assetForm, purchaseValue: parseFloat(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Location</label>
                  <input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })} placeholder="e.g. Server Room — HQ" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!assetForm.name.trim()) { toast.error("Asset name required"); return; }
                  if (assetForm.purchaseValue <= 0) { toast.error("Purchase value must be greater than zero"); return; }
                  createAsset({
                    assetTag: "",
                    name: assetForm.name.trim(),
                    category: assetForm.category,
                    serialNumber: assetForm.serialNumber || undefined,
                    status: "IN_STORAGE",
                    purchaseDate: new Date().toISOString(),
                    purchaseValue: assetForm.purchaseValue,
                    currency: "NGN",
                    depreciationRate: 20,
                    location: assetForm.location || undefined,
                    notes: assetForm.notes || undefined,
                  } as any);
                  toast.success("Asset registered", { description: `${assetForm.name} has been added to the asset register` });
                  setShowForm(false);
                  setAssetForm({ name: "", category: "IT_EQUIPMENT", serialNumber: "", purchaseValue: 0, location: "", notes: "" });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={14} /> Register Asset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
