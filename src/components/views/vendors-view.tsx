// NextMav Procure — Vendor Directory
//
// The previous version of this screen held the whole supplier master in the
// browser and filtered it with `array.filter`. That is fine for the twelve
// vendors the mock shipped with and unusable at the scale this platform is meant
// for, so search, filtering, sorting and paging now happen in Postgres and this
// component asks for one page at a time.
//
// The metrics strip is counted by the database too — §31: a dashboard that
// derives its figures from whatever the client happens to be holding is telling
// you about your browser, not about your organization.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  Loader2,
  PauseCircle,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Star,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  SectionCard,
  SkeletonList,
  SortableHeader,
  VendorComplianceBadge,
  VendorRiskBadge,
  VendorStatusBadge,
} from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCompactCurrency, formatDate } from "@/lib/format";
import type { Vendor } from "@/lib/types";
import type { VendorDuplicate } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VendorPage {
  items: Vendor[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface VendorMetrics {
  total: number;
  active: number;
  preferred: number;
  onboarding: number;
  pendingApproval: number;
  suspended: number;
  underReview: number;
  nonCompliant: number;
  expiringDocuments: number;
  expiredDocuments: number;
  highRisk: number;
  riskReviewDue: number;
}

type Filters = {
  search: string;
  status: string;
  compliance: string;
  risk: string;
  categoryId: string;
  preferred: string;
  expiringWithinDays: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "ALL",
  compliance: "ALL",
  risk: "ALL",
  categoryId: "ALL",
  preferred: "ALL",
  expiringWithinDays: "",
};

export function VendorsView() {
  const navigate = useStore((s) => s.navigate);
  const selectVendor = useStore((s) => s.selectVendor);
  const hasPermission = useStore((s) => s.hasPermission);
  const canCreate = hasPermission("vendors.create");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "companyName",
    dir: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // The search box types faster than the database answers. Debouncing keeps one
  // request in flight per pause rather than one per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // One memo per distinct request. `useServerData` re-fetches when this identity
  // changes and ignores a response that arrives after a newer one was asked for.
  const fetcher = useCallback(
    () =>
      Promise.all([
        api.get<VendorPage>("/api/vendors", {
          page,
          pageSize,
          sort: sort.key,
          dir: sort.dir,
          search: debouncedSearch || undefined,
          status: filters.status,
          compliance: filters.compliance,
          risk: filters.risk,
          categoryId: filters.categoryId,
          preferred: filters.preferred === "ALL" ? undefined : filters.preferred,
          expiringWithinDays: filters.expiringWithinDays || undefined,
        }),
        api.get<VendorMetrics>("/api/vendors/dashboard"),
      ]).then(([items, metrics]) => ({ items, metrics })),
    [page, pageSize, sort, debouncedSearch, filters]
  );

  const { data: loaded, error, loading, reload: load } = useServerData(
    fetcher,
    "Could not load the vendor directory."
  );
  const data = loaded?.items ?? null;
  const metrics = loaded?.metrics ?? null;

  /**
   * Changing what is being asked for returns to page one in the same update.
   *
   * Doing this in an effect instead would render page 4 of the new filter first
   * and correct itself afterwards, which shows the user an empty table for a
   * frame.
   */
  const applyFilters = useCallback((next: Filters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const activeFilterCount = useMemo(
    () =>
      (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter(
        (k) => k !== "search" && filters[k] !== EMPTY_FILTERS[k]
      ).length,
    [filters]
  );

  const openVendor = (v: Vendor) => {
    selectVendor(v.id);
    navigate("vendor-detail");
  };

  const onSort = (key: string) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Your supplier master: onboarding, compliance, risk and performance in one place."
        actions={
          canCreate ? (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">Add Vendor</span>
            </button>
          ) : undefined
        }
      />

      {/* Metrics. Each tile is a filter — clicking one narrows the list below. */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Total Vendors"
          value={metrics?.total}
          icon={Users}
          iconBg="bg-sky-100 dark:bg-sky-950/40"
          onClick={() => applyFilters({ ...EMPTY_FILTERS, search: filters.search })}
        />
        <MetricTile
          label="Active"
          value={metrics?.active}
          icon={CheckCircle2}
          iconBg="bg-emerald-100 dark:bg-emerald-950/40"
          onClick={() => applyFilters({ ...EMPTY_FILTERS, status: "ACTIVE" })}
        />
        <MetricTile
          label="Awaiting Approval"
          value={metrics?.pendingApproval}
          icon={ClipboardCheck}
          iconBg="bg-amber-100 dark:bg-amber-950/40"
          onClick={() => applyFilters({ ...EMPTY_FILTERS, status: "PENDING_APPROVAL" })}
        />
        <MetricTile
          label="Compliance Issues"
          value={
            metrics ? metrics.nonCompliant + metrics.expiredDocuments : undefined
          }
          icon={ShieldAlert}
          iconBg="bg-rose-100 dark:bg-rose-950/40"
          onClick={() =>
            applyFilters({ ...EMPTY_FILTERS, compliance: "NON_COMPLIANT,EXPIRED,PARTIALLY_COMPLIANT" })
          }
        />
      </div>

      {metrics && (metrics.expiringDocuments > 0 || metrics.suspended > 0 || metrics.highRisk > 0) && (
        <div className="flex flex-wrap gap-2">
          {metrics.expiringDocuments > 0 && (
            <AlertChip
              icon={TriangleAlert}
              tone="amber"
              label={`${metrics.expiringDocuments} vendor${metrics.expiringDocuments === 1 ? "" : "s"} with documents expiring in 30 days`}
              onClick={() => applyFilters({ ...EMPTY_FILTERS, expiringWithinDays: "30" })}
            />
          )}
          {metrics.suspended > 0 && (
            <AlertChip
              icon={PauseCircle}
              tone="amber"
              label={`${metrics.suspended} suspended`}
              onClick={() => applyFilters({ ...EMPTY_FILTERS, status: "SUSPENDED" })}
            />
          )}
          {metrics.highRisk > 0 && (
            <AlertChip
              icon={AlertTriangle}
              tone="rose"
              label={`${metrics.highRisk} high or critical risk`}
              onClick={() => applyFilters({ ...EMPTY_FILTERS, risk: "HIGH,CRITICAL" })}
            />
          )}
        </div>
      )}

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search name, vendor code, tax ID, registration number, contact…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-9 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
          {filters.search && (
            <button
              onClick={() => setFilters({ ...filters, search: "" })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
              activeFilterCount > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-border bg-card hover:bg-muted"
            )}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={() => applyFilters({ ...EMPTY_FILTERS, search: filters.search })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Lifecycle status"
            value={filters.status}
            onChange={(status) => applyFilters({ ...filters, status })}
            options={[
              ["ALL", "All statuses"],
              ["PROSPECTIVE", "Prospective"],
              ["INVITED", "Invited"],
              ["ONBOARDING", "Onboarding"],
              ["UNDER_REVIEW", "Under review"],
              ["PENDING_APPROVAL", "Pending approval"],
              ["APPROVED", "Approved"],
              ["ACTIVE", "Active"],
              ["REJECTED", "Rejected"],
              ["SUSPENDED", "Suspended"],
              ["INACTIVE", "Inactive"],
              ["ARCHIVED", "Archived"],
              ["BLACKLISTED", "Blacklisted"],
            ]}
          />
          <FilterSelect
            label="Compliance"
            value={filters.compliance}
            onChange={(compliance) => applyFilters({ ...filters, compliance })}
            options={[
              ["ALL", "Any compliance state"],
              ["COMPLIANT", "Compliant"],
              ["PARTIALLY_COMPLIANT", "Partially compliant"],
              ["NON_COMPLIANT", "Non-compliant"],
              ["EXPIRED", "Expired"],
              ["UNDER_REVIEW", "Under review"],
              ["IN_PROGRESS", "In progress"],
              ["NOT_STARTED", "Not started"],
            ]}
          />
          <FilterSelect
            label="Risk"
            value={filters.risk}
            onChange={(risk) => applyFilters({ ...filters, risk })}
            options={[
              ["ALL", "Any risk level"],
              ["UNRATED", "Unrated"],
              ["LOW", "Low"],
              ["MEDIUM", "Medium"],
              ["HIGH", "High"],
              ["CRITICAL", "Critical"],
            ]}
          />
          <FilterSelect
            label="Preferred"
            value={filters.preferred}
            onChange={(preferred) => applyFilters({ ...filters, preferred })}
            options={[
              ["ALL", "Preferred or not"],
              ["true", "Preferred only"],
              ["false", "Not preferred"],
            ]}
          />
        </div>
      )}

      {/* Results */}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/20">
          <TriangleAlert size={22} className="mx-auto text-rose-500" />
          <p className="mt-3 text-sm font-medium text-foreground">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-95"
          >
            Try again
          </button>
        </div>
      ) : loading && !data ? (
        <SkeletonList count={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={
            activeFilterCount > 0 || debouncedSearch
              ? "No vendors match these filters"
              : "No vendors yet"
          }
          description={
            activeFilterCount > 0 || debouncedSearch
              ? "Try widening the search or clearing the filters."
              : "Add your first supplier to start onboarding them: record who they are, collect their compliance documents, and route them for approval."
          }
          action={
            activeFilterCount > 0 || debouncedSearch ? (
              <button
                onClick={() => applyFilters(EMPTY_FILTERS)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                <RotateCcw size={14} /> Clear filters
              </button>
            ) : canCreate ? (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
              >
                <Plus size={15} /> Add Vendor
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loading && (
            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Updating…
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left">
                    <SortableHeader label="Vendor" sortKey="companyName" currentSort={sort} onSort={onSort} />
                  </th>
                  <th className="px-3 py-2.5 text-left hidden lg:table-cell">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Categories
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <SortableHeader label="Status" sortKey="status" currentSort={sort} onSort={onSort} />
                  </th>
                  <th className="px-3 py-2.5 text-left hidden md:table-cell">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Compliance
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left hidden xl:table-cell">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Risk
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left hidden xl:table-cell">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Primary contact
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right hidden sm:table-cell">
                    <SortableHeader label="Spend" sortKey="totalValue" currentSort={sort} onSort={onSort} align="right" />
                  </th>
                  <th className="px-5 py-2.5 text-right hidden lg:table-cell">
                    <SortableHeader label="Updated" sortKey="updatedAt" currentSort={sort} onSort={onSort} align="right" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => {
                  const primary = v.contacts?.find((c) => c.isPrimary) ?? v.contacts?.[0];
                  return (
                    <tr
                      key={v.id}
                      onClick={() => openVendor(v)}
                      className="border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white">
                            {v.companyName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="truncate font-medium text-foreground">{v.companyName}</p>
                              {v.isPreferred && (
                                <Star size={12} className="shrink-0 fill-violet-500 text-violet-500" aria-label="Preferred supplier" />
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {v.code ? `${v.code} · ` : ""}
                              {v.legalName || v.email || v.country || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden lg:table-cell">
                        <CategoryCell vendor={v} />
                      </td>
                      <td className="px-3 py-3">
                        <VendorStatusBadge status={v.status} />
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        <VendorComplianceBadge state={v.complianceState} />
                      </td>
                      <td className="px-3 py-3 hidden xl:table-cell">
                        <VendorRiskBadge level={v.riskLevel} />
                      </td>
                      <td className="px-3 py-3 hidden xl:table-cell">
                        {primary ? (
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">{primary.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{primary.email ?? primary.phone ?? "—"}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No contact</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right hidden sm:table-cell">
                        <p className="text-sm font-medium tabular-nums text-foreground">
                          {v.totalValue > 0 ? formatCompactCurrency(v.totalValue, v.preferredCurrency) : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {v.totalOrders > 0 ? `${v.totalOrders} orders` : "No orders"}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-muted-foreground hidden lg:table-cell">
                        {formatDate(v.updatedAt ?? v.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data?.page ?? 1}
            pageSize={data?.pageSize ?? pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </div>
      )}

      {showForm && (
        <AddVendorDialog
          onClose={() => setShowForm(false)}
          onCreated={(id) => {
            setShowForm(false);
            void load();
            selectVendor(id);
            navigate("vendor-detail");
          }}
        />
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon,
  iconBg,
  onClick,
}: {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="text-left">
      <KpiCard label={label} value={value ?? "—"} icon={icon} iconBg={iconBg} />
    </button>
  );
}

function AlertChip({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  tone: "amber" | "rose";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        tone === "amber" &&
          "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
        tone === "rose" &&
          "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1.5 h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CategoryCell({ vendor }: { vendor: Vendor }) {
  const names = (vendor.categories ?? []).map((c) => c.categoryName);
  if (names.length === 0) {
    return <span className="text-xs text-muted-foreground">{vendor.category || "—"}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {names.slice(0, 2).map((n) => (
        <span
          key={n}
          className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          {n}
        </span>
      ))}
      {names.length > 2 && (
        <span className="text-[11px] text-muted-foreground">+{names.length - 2}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add vendor
// ---------------------------------------------------------------------------

/**
 * Creating a supplier.
 *
 * The form asks the server for near-matches as the identifying fields lose
 * focus, so a duplicate is caught while the user is still typing rather than
 * after the record exists. A high-confidence match is refused by the server
 * outright; the confirmation checkbox below is what an authorised user ticks to
 * say they have looked and these really are two different companies.
 */
function AddVendorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createVendor = useStore((s) => s.createVendor);
  const checkVendorDuplicates = useStore((s) => s.checkVendorDuplicates);

  const [form, setForm] = useState({
    companyName: "",
    legalName: "",
    vendorType: "SUPPLIER",
    email: "",
    phone: "",
    website: "",
    address: "",
    city: "",
    country: "",
    taxNumber: "",
    registrationNumber: "",
    category: "",
    paymentTerms: "NET_30",
    preferredCurrency: "NGN",
    description: "",
  });
  const [duplicates, setDuplicates] = useState<VendorDuplicate[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const runDuplicateCheck = async () => {
    if (form.companyName.trim().length < 3 && !form.taxNumber && !form.registrationNumber) return;
    setChecking(true);
    try {
      const found = await checkVendorDuplicates({
        companyName: form.companyName.trim() || undefined,
        legalName: form.legalName.trim() || undefined,
        taxNumber: form.taxNumber.trim() || undefined,
        registrationNumber: form.registrationNumber.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      setDuplicates(found);
    } catch {
      // A failed pre-check must not block the form; the server checks again on
      // create, which is the check that actually counts.
      setDuplicates([]);
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setFieldErrors({});
    if (form.companyName.trim().length < 2) {
      setFieldErrors({ companyName: "Company name is required" });
      return;
    }
    setSaving(true);
    const result = await mutate(
      () =>
        createVendor({
          ...form,
          acknowledgeDuplicates: acknowledged,
        }),
      {
        success: `${form.companyName.trim()} added to the directory`,
        onError: (e) => {
          if (e.isValidation) setFieldErrors(e.fieldErrors);
          if (e.isConflict) {
            const found = (e.details as { duplicates?: VendorDuplicate[] })?.duplicates;
            if (found?.length) setDuplicates(found);
          }
        },
      }
    );
    setSaving(false);
    if (result) onCreated(result.id);
  };

  const highConfidence = duplicates.filter((d) => d.confidence === "HIGH");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Add Vendor</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A new supplier starts as prospective. Add their compliance requirements and documents,
              then submit them for approval.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-6">
          {duplicates.length > 0 && (
            <div
              className={cn(
                "rounded-lg border p-4",
                highConfidence.length > 0
                  ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
                  : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
              )}
            >
              <div className="flex items-start gap-2.5">
                <TriangleAlert
                  size={16}
                  className={cn(
                    "mt-0.5 shrink-0",
                    highConfidence.length > 0 ? "text-rose-500" : "text-amber-500"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {duplicates.length === 1
                      ? "A vendor in your directory may already be this company"
                      : `${duplicates.length} vendors in your directory may already be this company`}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {duplicates.map((d) => (
                      <li key={d.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{d.companyName}</span>
                        {" — "}
                        {d.reason}
                        <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
                          {d.confidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {highConfidence.length > 0 && (
                    <label className="mt-3 flex items-start gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        I have reviewed these and this is a different company. Create it as a separate
                        vendor.
                      </span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          <Fieldset title="Identity">
            <Field
              label="Company name"
              required
              className="sm:col-span-2"
              error={fieldErrors.companyName}
              value={form.companyName}
              onChange={(v) => setForm({ ...form, companyName: v })}
              onBlur={runDuplicateCheck}
              placeholder="The name you refer to them by"
            />
            <Field
              label="Registered legal name"
              className="sm:col-span-2"
              value={form.legalName}
              onChange={(v) => setForm({ ...form, legalName: v })}
              onBlur={runDuplicateCheck}
              placeholder="As it appears on contracts and invoices"
            />
            <div>
              <label className="text-sm font-medium text-foreground">Vendor type</label>
              <Select
                value={form.vendorType}
                onValueChange={(vendorType) => setForm({ ...form, vendorType })}
              >
                <SelectTrigger className="mt-1.5 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUPPLIER">Supplier</SelectItem>
                  <SelectItem value="MANUFACTURER">Manufacturer</SelectItem>
                  <SelectItem value="DISTRIBUTOR">Distributor</SelectItem>
                  <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                  <SelectItem value="SERVICE_PROVIDER">Service provider</SelectItem>
                  <SelectItem value="CONSULTANT">Consultant</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field
              label="Primary category"
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              placeholder="e.g. IT Equipment"
            />
          </Fieldset>

          <Fieldset title="Registration">
            <Field
              label="Tax identification number"
              value={form.taxNumber}
              onChange={(v) => setForm({ ...form, taxNumber: v })}
              onBlur={runDuplicateCheck}
              hint="Checked against existing vendors"
            />
            <Field
              label="Company registration number"
              value={form.registrationNumber}
              onChange={(v) => setForm({ ...form, registrationNumber: v })}
              onBlur={runDuplicateCheck}
              hint="Checked against existing vendors"
            />
          </Fieldset>

          <Fieldset title="Contact">
            <Field
              label="Email"
              type="email"
              error={fieldErrors.email}
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              onBlur={runDuplicateCheck}
            />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field
              label="Website"
              className="sm:col-span-2"
              value={form.website}
              onChange={(v) => setForm({ ...form, website: v })}
            />
            <Field
              label="Address"
              className="sm:col-span-2"
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
            />
            <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
          </Fieldset>

          <Fieldset title="Commercial terms">
            <Field
              label="Payment terms"
              value={form.paymentTerms}
              onChange={(v) => setForm({ ...form, paymentTerms: v })}
              placeholder="NET_30"
            />
            <Field
              label="Currency"
              value={form.preferredCurrency}
              onChange={(v) => setForm({ ...form, preferredCurrency: v })}
              placeholder="NGN"
            />
          </Fieldset>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {checking ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Checking for duplicates…
              </span>
            ) : (
              "Bank details and compliance can be added on the vendor's profile."
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || (highConfidence.length > 0 && !acknowledged)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Add Vendor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
  error,
  required,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={cn(
          "mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm placeholder:text-muted-foreground transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring",
          error ? "border-rose-400" : "border-input"
        )}
      />
      {error ? (
        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
