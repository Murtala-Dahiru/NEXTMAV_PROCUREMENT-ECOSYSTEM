// NextMav Procure — Shared UI primitives
// Reusable building blocks used across all views.

"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, Star, type LucideIcon } from "lucide-react";
import {
  ASSET_STATUS_META,
  CONTRACT_STATUS_META,
  GOODS_RECEIPT_STATUS_META,
  INVOICE_STATUS_META,
  PAYMENT_STATUS_META,
  PRIORITY_META,
  PO_STATUS_META,
  RFQ_STATUS_META,
  STATUS_META,
  VENDOR_STATUS_META,
  type AssetStatus,
  type ContractStatus,
  type GoodsReceiptStatus,
  type InvoiceStatus,
  type PaymentStatus,
  type Priority,
  type PurchaseOrderStatus,
  type RFQStatus,
  type RequestStatus,
  type VendorStatus,
} from "@/lib/types";
import { ratingBg } from "@/lib/format";

export function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function POStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const meta = PO_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function RFQStatusBadge({ status }: { status: RFQStatus }) {
  const meta = RFQ_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function VendorStatusBadge({ status }: { status: VendorStatus }) {
  const meta = VENDOR_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const meta = INVOICE_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const meta = PAYMENT_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const meta = CONTRACT_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const meta = ASSET_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function GoodsReceiptStatusBadge({ status }: { status: GoodsReceiptStatus }) {
  const meta = GOODS_RECEIPT_STATUS_META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.color)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function RatingStars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={size}
            className={cn(
              i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/30"
            )}
          />
        ))}
      </div>
      <span className={cn("text-xs font-medium", ratingBg(rating))}>
        {rating > 0 ? rating.toFixed(1) : "New"}
      </span>
    </div>
  );
}

export function Avatar({
  initials,
  color,
  size = "md",
}: {
  initials: string;
  color: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
    xl: "h-16 w-16 text-base",
  };
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-semibold ring-2 ring-background shrink-0",
        color,
        sizes[size]
      )}
    >
      {initials}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  deltaType = "neutral",
  icon: Icon,
  iconBg,
  hint,
}: {
  label: string;
  value: string | number;
  delta?: string;
  deltaType?: "up" | "down" | "neutral";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconBg: string;
  hint?: string;
}) {
  return (
    <div className="group relative rounded-xl border border-border bg-card p-5 transition-all hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
          {delta && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                  deltaType === "up" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                  deltaType === "down" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                  deltaType === "neutral" && "bg-muted text-muted-foreground"
                )}
              >
                {delta}
              </span>
              {hint && <span className="text-muted-foreground">{hint}</span>}
            </div>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0", iconBg)}>
          <Icon size={18} className="text-foreground/70" />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-16 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={22} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; onClick?: () => void }[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="opacity-50">/</span>}
                {b.onClick ? (
                  <button onClick={b.onClick} className="hover:text-foreground transition-colors">{b.label}</button>
                ) : (
                  <span>{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

// Skeleton loaders for async-feel loading states
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 bg-muted rounded shimmer" />
          <div className="h-6 w-32 bg-muted rounded shimmer" />
        </div>
        <div className="h-10 w-10 bg-muted rounded-lg shimmer" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <div className="h-9 w-9 bg-muted rounded-full shimmer" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-3/4 bg-muted rounded shimmer" />
        <div className="h-2.5 w-1/2 bg-muted rounded shimmer" />
      </div>
      <div className="h-5 w-16 bg-muted rounded-full shimmer" />
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="divide-y divide-border">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}

export function LoadingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// Progress bar component for budgets, compliance, etc.
export function ProgressBar({
  value,
  max = 100,
  color,
  size = "md",
  showLabel = false,
}: {
  value: number;
  max?: number;
  color?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const autoColor = pct > 90 ? "bg-rose-500" : pct > 75 ? "bg-amber-500" : "bg-emerald-500";
  const heights = { sm: "h-1", md: "h-1.5", lg: "h-2.5" };
  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex-1 rounded-full bg-muted overflow-hidden", heights[size])}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", color ?? autoColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0">{pct.toFixed(0)}%</span>
      )}
    </div>
  );
}

// Tag component
export function Tag({ label, color = "default" }: { label: string; color?: "default" | "emerald" | "amber" | "rose" | "sky" | "violet" }) {
  const colors = {
    default: "bg-muted text-muted-foreground border-border",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
    sky: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
    violet: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  };
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium", colors[color])}>
      {label}
    </span>
  );
}

// SLA indicator showing time remaining
export function SlaIndicator({ slaExpiresAt, decided }: { slaExpiresAt: string; decided?: boolean }) {
  if (decided) return null;
  const expires = new Date(slaExpiresAt);
  const now = new Date();
  const hoursLeft = (expires.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursLeft < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded-full">
        ⚠ SLA Breached
      </span>
    );
  }
  if (hoursLeft < 6) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-full">
        ⏰ {hoursLeft.toFixed(0)}h left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
      {hoursLeft.toFixed(0)}h left
    </span>
  );
}

// Bulk action bar
export function BulkActionBar({
  selectedCount,
  actions,
  onClear,
}: {
  selectedCount: number;
  actions: { label: string; icon?: LucideIcon; onClick: () => void; variant?: "default" | "danger" }[];
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky top-16 z-20 -mx-4 sm:-mx-6 lg:-mx-8 mb-4 px-4 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 px-4 py-2.5 flex items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold px-2">
            {selectedCount}
          </span>
          <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
        </div>
        <div className="flex items-center gap-2">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                a.variant === "danger"
                  ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-950/40 dark:text-rose-300"
                  : "bg-card border border-border text-foreground hover:bg-muted"
              )}
            >
              {a.icon && <a.icon size={13} />}
              {a.label}
            </button>
          ))}
          <button
            onClick={onClear}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// Sortable table header button
export function SortableHeader({
  label,
  sortKey,
  currentSort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: string;
  currentSort: { key: string; dir: "asc" | "desc" } | null;
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
}) {
  const isActive = currentSort?.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse",
        align === "center" && "justify-center",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
      <span className="text-[8px]">
        {isActive ? (currentSort.dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

// Pagination component
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-muted/20">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Showing {start}–{end} of {total}</span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value))}
            className="h-7 rounded-md border border-border bg-card px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="text-xs text-muted-foreground px-2">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// Confirmation dialog for destructive actions
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full shrink-0",
            variant === "danger" ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" : "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
          )}>
            <AlertCircle size={20} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium text-white transition-colors",
              variant === "danger" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Stat tile for module dashboards
export function StatTile({
  label,
  value,
  sublabel,
  icon: Icon,
  trend,
  trendType = "neutral",
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  trend?: string;
  trendType?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <Icon size={14} className="text-muted-foreground/60" />
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      {trend && (
        <p className={cn(
          "mt-1.5 text-xs font-medium",
          trendType === "up" && "text-emerald-600 dark:text-emerald-400",
          trendType === "down" && "text-rose-600 dark:text-rose-400",
          trendType === "neutral" && "text-muted-foreground"
        )}>
          {trend}
        </p>
      )}
    </div>
  );
}
