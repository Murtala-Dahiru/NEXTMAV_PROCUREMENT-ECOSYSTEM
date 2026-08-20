// NextMav Procure — the supplier's invitation list.
//
// Everything here comes from /api/supplier/*, which ranges only over this
// supplier's own invitations and quotations. There is no client-side filter
// keeping other suppliers' tenders out of view — they were never fetched.

"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SupplierDashboard {
  invitations: {
    total: number;
    open: number;
    closingSoon: number;
    awaitingResponse: number;
    responded: number;
    declined: number;
  };
  quotations: { drafts: number; submitted: number; won: number; unsuccessful: number };
  awards: number;
}

interface InvitationRow {
  rfqId: string;
  rfqNumber: string;
  title: string;
  buyerName: string;
  status: string;
  currency: string;
  deadline: string;
  lineItemCount: number;
  invitationStatus: string;
  isOpen: boolean;
  secondsRemaining: number;
  myQuotation: {
    id: string;
    status: string;
    totalAmount: number;
    currency: string;
    revision: number;
    submittedAt: string | null;
  } | null;
}

const FILTERS = [
  { key: "open", label: "Open now", status: "OPEN" },
  { key: "all", label: "All", status: "ALL" },
  { key: "todo", label: "Awaiting my response", status: "INVITED,VIEWED,ACCEPTED" },
  { key: "quoted", label: "Quoted", status: "QUOTED" },
  { key: "declined", label: "Declined", status: "DECLINED" },
];

export function SupplierHome() {
  const [filter, setFilter] = useState("open");
  const status = FILTERS.find((f) => f.key === filter)?.status ?? "ALL";

  const fetchDashboard = useCallback(() => api.get<SupplierDashboard>("/api/supplier/dashboard"), []);
  const dashboard = useServerData(fetchDashboard, "Could not load your summary.");

  const fetchList = useCallback(
    () => api.get<{ items: InvitationRow[]; total: number }>("/api/supplier/rfqs", { status, pageSize: 50 }),
    [status]
  );
  const list = useServerData(fetchList, "Could not load your invitations.");

  const d = dashboard.data;
  const rows = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests for quotation you have been invited to, and the quotations you have submitted.
        </p>
      </div>

      {d && d.invitations.closingSoon > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {d.invitations.closingSoon} invitation{d.invitations.closingSoon === 1 ? "" : "s"} closing within three days
              </p>
              <p className="mt-0.5 text-muted-foreground">
                A quotation submitted after the deadline is refused by the system, not merely discouraged.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open invitations" value={d ? d.invitations.open : "—"} icon={Inbox} tone="emerald" />
        <Stat label="Awaiting your response" value={d ? d.invitations.awaitingResponse : "—"} icon={Clock} tone="amber" />
        <Stat label="Quotations submitted" value={d ? d.quotations.submitted : "—"} icon={Send} tone="sky" />
        <Stat label="Awards won" value={d ? d.quotations.won : "—"} icon={CheckCircle2} tone="emerald" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.loading && !list.data ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <FileText size={28} className="mx-auto text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">Nothing here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter === "open"
              ? "You have no open invitations right now. New ones appear here as soon as a buyer publishes an RFQ to you."
              : "No invitations match this filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <InvitationCard key={r.rfqId} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function InvitationCard({ row }: { row: InvitationRow }) {
  const days = Math.floor(row.secondsRemaining / 86400);
  const hours = Math.floor(row.secondsRemaining / 3600);
  const urgent = row.isOpen && row.secondsRemaining < 2 * 86400;

  return (
    <Link
      href={`/supplier/rfqs/${row.rfqId}`}
      className="group block rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-foreground/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{row.rfqNumber}</span>
            <InvitationBadge status={row.invitationStatus} />
            {!row.isOpen && (
              <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Closed
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-base font-semibold text-foreground transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
            {row.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.buyerName} · {row.lineItemCount} line item{row.lineItemCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {row.myQuotation && row.myQuotation.status !== "DRAFT" ? (
            <>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(row.myQuotation.totalAmount, row.myQuotation.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                Your quotation{row.myQuotation.revision > 1 ? ` · rev ${row.myQuotation.revision}` : ""}
              </p>
            </>
          ) : row.myQuotation?.status === "DRAFT" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Draft in progress
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs">
        <span className={cn("flex items-center gap-1.5", urgent ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
          <Clock size={12} />
          {row.isOpen
            ? days >= 2
              ? `${days} days left · closes ${formatDate(row.deadline)}`
              : `${hours} hours left · closes ${formatDate(row.deadline)}`
            : `Closed ${formatDate(row.deadline)}`}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
          Open <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function InvitationBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; cls: string }> = {
    INVITED: { label: "New invitation", cls: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" },
    VIEWED: { label: "Opened", cls: "border-border bg-muted text-muted-foreground" },
    ACCEPTED: { label: "Accepted", cls: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300" },
    QUOTED: { label: "Quoted", cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" },
    DECLINED: { label: "Declined", cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" },
    NO_RESPONSE: { label: "No response", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" },
  };
  const m = meta[status] ?? meta.INVITED;
  return <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", m.cls)}>{m.label}</span>;
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "emerald" | "amber" | "sky";
}) {
  const colors = {
    emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    sky: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  } as const;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        </div>
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colors[tone])}>
          <Icon size={15} />
        </div>
      </div>
    </div>
  );
}
