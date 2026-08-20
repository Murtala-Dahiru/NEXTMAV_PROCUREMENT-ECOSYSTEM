// NextMav Procure — sourcing dashboard and RFQ directory.
//
// The previous version of this screen held every RFQ in the browser and filtered
// it with `array.filter`, and its four headline numbers were counted from
// whatever the store happened to be holding. Both are replaced here: search,
// filtering, sorting and paging happen in Postgres, and the metric strip comes
// from /api/rfqs/dashboard, which aggregates across the whole tenant rather than
// across one page of results (§20, §44).
//
// The response columns are the point of this table. A buyer scanning a live
// tender wants to know who has responded and how long is left, and both are
// computed server-side from the invitation rows — there is no counter here that
// can drift from what the suppliers actually did.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Award,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Gavel,
  Inbox,
  Loader2,
  Plus,
  Search,
  Send,
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
  RFQStatusBadge,
  SectionCard,
  SkeletonList,
  SortableHeader,
} from "@/components/shared";
import { api } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import {
  deadlineTone,
  timeRemaining,
  type Page,
  type RfqListRow,
  type SourcingDashboard,
} from "@/lib/sourcing";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Filter tabs, phrased as the questions a buyer actually asks of the list. */
const VIEWS: { key: string; label: string; status: string }[] = [
  { key: "all", label: "All", status: "ALL" },
  { key: "draft", label: "Drafts", status: "DRAFT" },
  { key: "approval", label: "Pending Approval", status: "UNDER_REVIEW" },
  { key: "ready", label: "Ready", status: "APPROVED,READY_TO_PUBLISH" },
  { key: "live", label: "Live", status: "PUBLISHED,RESPONSE_PERIOD" },
  { key: "evaluating", label: "Evaluating", status: "CLOSED,UNDER_EVALUATION,EXPIRED" },
  { key: "decided", label: "Decided", status: "AWARDED,NO_AWARD" },
];

export function RfqsView() {
  const navigate = useStore((s) => s.navigate);
  const selectRfq = useStore((s) => s.selectRfq);
  const hasPermission = useStore((s) => s.hasPermission);

  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("ALL");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Debounced so a keystroke does not become a query. 300ms is the point where
  // the list feels live without the server seeing one request per character.
  // A real effect, because the cleanup matters: `useMemo` never calls the function
  // it returns, so a timer created there is never cleared. setState happens inside
  // the timeout callback rather than in the effect body, which is what makes this
  // a subscription to a timer rather than a cascading render.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const status = VIEWS.find((v) => v.key === view)?.status ?? "ALL";

  const fetchDashboard = useCallback(() => api.get<SourcingDashboard>("/api/rfqs/dashboard"), []);
  const dashboard = useServerData(fetchDashboard, "Could not load the sourcing dashboard.");

  const fetchList = useCallback(
    () =>
      api.get<Page<RfqListRow>>("/api/rfqs", {
        page,
        pageSize,
        status,
        search: debounced || undefined,
        category: category === "ALL" ? undefined : category,
        sort: sort.key,
        dir: sort.dir,
      }),
    [page, pageSize, status, debounced, category, sort.key, sort.dir]
  );
  const list = useServerData(fetchList, "Could not load RFQs.");

  const onSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(1);
  };

  const open = (id: string) => {
    selectRfq(id);
    navigate("rfq-detail");
  };

  const m = dashboard.data;
  const rows = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sourcing"
        description="Turn approved requirements into competitive events: issue RFQs, collect quotations, evaluate and award."
        actions={
          <>
            <button
              onClick={() => navigate("quotations")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Inbox size={15} />
              <span className="hidden sm:inline">Quotation Inbox</span>
            </button>
            {hasPermission("rfqs.create") && (
              <button
                onClick={() => navigate("rfq-new")}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">New RFQ</span>
              </button>
            )}
          </>
        }
      />

      {/* Work waiting on this user, before the general counters. An approval or an
          evaluation sitting unattended is the thing that stalls a tender. */}
      {m && (m.awaitingMe.awardApprovals > 0 || m.awaitingMe.evaluations > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Waiting on you</p>
              <p className="mt-0.5 text-muted-foreground">
                {[
                  m.awaitingMe.evaluations > 0 &&
                    `${m.awaitingMe.evaluations} evaluation${m.awaitingMe.evaluations === 1 ? "" : "s"} to score`,
                  m.awaitingMe.awardApprovals > 0 &&
                    `${m.awaitingMe.awardApprovals} award${m.awaitingMe.awardApprovals === 1 ? "" : "s"} to approve`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label="Live RFQs"
          value={m ? m.rfqs.published : "—"}
          icon={Send}
          iconBg="bg-emerald-100 dark:bg-emerald-950/40"
          hint={m && m.rfqs.closingSoon > 0 ? `${m.rfqs.closingSoon} closing soon` : undefined}
        />
        <KpiCard
          label="Pending Approval"
          value={m ? m.rfqs.pendingApproval : "—"}
          icon={ClipboardList}
          iconBg="bg-violet-100 dark:bg-violet-950/40"
          hint={m && m.rfqs.draft > 0 ? `${m.rfqs.draft} in draft` : undefined}
        />
        <KpiCard
          label="Quotations In"
          value={m ? m.quotations.received : "—"}
          icon={Inbox}
          iconBg="bg-sky-100 dark:bg-sky-950/40"
          hint={m ? formatCompactCurrency(m.quotations.totalValue) : undefined}
        />
        <KpiCard
          label="Under Evaluation"
          value={m ? m.rfqs.underEvaluation + m.rfqs.closed : "—"}
          icon={Gavel}
          iconBg="bg-amber-100 dark:bg-amber-950/40"
        />
        <KpiCard
          label="Awarded"
          value={m ? m.rfqs.awarded : "—"}
          icon={Award}
          iconBg="bg-teal-100 dark:bg-teal-950/40"
          hint={m && m.rfqs.noAward > 0 ? `${m.rfqs.noAward} closed with no award` : undefined}
        />
      </div>

      {/* Supplier engagement across every live tender — §23, at portfolio level. */}
      {m && m.suppliers.invited > 0 && (
        <SectionCard
          title="Supplier engagement"
          description="Across every published RFQ, counted from the invitation records."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <EngagementStat label="Invited" value={m.suppliers.invited} tone="neutral" />
            <EngagementStat label="Viewed" value={m.suppliers.viewed} tone="sky" />
            <EngagementStat label="Responded" value={m.suppliers.responded} tone="emerald" />
            <EngagementStat label="Declined" value={m.suppliers.declined} tone="rose" />
            <EngagementStat label="No response" value={m.suppliers.noResponse} tone="amber" />
          </div>
        </SectionCard>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => {
                setView(v.key);
                setPage(1);
              }}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
                view === v.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by RFQ number, reference or title…"
              className="h-9 w-full rounded-lg border border-input bg-card pl-10 pr-9 text-sm placeholder:text-muted-foreground transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Select
            value={sort.key}
            onValueChange={(k) => {
              setSort({ key: k, dir: k === "rfqNumber" || k === "title" ? "asc" : "desc" });
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-[180px] text-sm">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Newest first</SelectItem>
              <SelectItem value="deadline">Deadline</SelectItem>
              <SelectItem value="publishedAt">Recently published</SelectItem>
              <SelectItem value="rfqNumber">RFQ number</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {list.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {list.error}
        </div>
      )}

      <SectionCard
        title="Request for Quotations"
        description={list.data ? `${list.data.total} matching` : "Loading…"}
        bodyClassName="p-0"
        action={list.loading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : undefined}
      >
        {list.loading && !list.data ? (
          <div className="p-5">
            <SkeletonList count={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={debounced || view !== "all" ? "Nothing matches this view" : "No RFQs yet"}
            description={
              debounced || view !== "all"
                ? "Try a different filter, or clear the search."
                : "Start from an approved purchase request and take the requirement to market."
            }
            action={
              hasPermission("rfqs.create") ? (
                <button
                  onClick={() => navigate("rfq-new")}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
                >
                  <Plus size={15} /> New RFQ
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 text-left">
                      <SortableHeader label="RFQ" sortKey="rfqNumber" currentSort={sort} onSort={onSort} />
                    </th>
                    <th className="px-3 py-3 text-left">
                      <SortableHeader label="Title" sortKey="title" currentSort={sort} onSort={onSort} />
                    </th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Responses
                    </th>
                    <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Lowest
                    </th>
                    <th className="px-3 py-3 text-left">
                      <SortableHeader label="Deadline" sortKey="deadline" currentSort={sort} onSort={onSort} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <RfqRow key={r.id} rfq={r} onOpen={() => open(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={list.data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </>
        )}
      </SectionCard>
    </div>
  );
}

function RfqRow({ rfq, onOpen }: { rfq: RfqListRow; onOpen: () => void }) {
  const tone = deadlineTone(rfq.deadline);
  const remaining = timeRemaining(rfq.deadline);
  const s = rfq.responseSummary;
  const responded = s.invited > 0 ? Math.round((s.responded / s.invited) * 100) : 0;

  return (
    <tr className="cursor-pointer transition-colors hover:bg-muted/30" onClick={onOpen}>
      <td className="px-5 py-3.5 align-top">
        <p className="font-mono text-xs text-foreground">{rfq.rfqNumber}</p>
        {rfq.sourcingEvent && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{rfq.sourcingEvent.eventNumber}</p>
        )}
      </td>
      <td className="max-w-[320px] px-3 py-3.5 align-top">
        <p className="truncate text-sm font-medium text-foreground">{rfq.title}</p>
        <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
          {rfq.categoryRef?.name ?? "Uncategorised"}
          {rfq.request && (
            <>
              <span>·</span>
              <span className="font-mono">{rfq.request.requestNumber}</span>
            </>
          )}
        </p>
      </td>
      <td className="px-3 py-3.5 align-top">
        <RFQStatusBadge status={rfq.status} />
      </td>
      <td className="px-3 py-3.5 align-top">
        {s.invited === 0 ? (
          <p className="text-center text-xs text-muted-foreground">No suppliers</p>
        ) : (
          <div className="min-w-[130px]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {s.responded}/{s.invited}
              </span>
              <span className="text-muted-foreground">{responded}%</span>
            </div>
            {/* Proportions, not a decoration: the bar is the same numbers the
                response monitor on the detail page reports. */}
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="bg-emerald-500" style={{ width: `${(s.responded / s.invited) * 100}%` }} />
              <span className="bg-rose-400" style={{ width: `${(s.declined / s.invited) * 100}%` }} />
              <span className="bg-sky-300" style={{ width: `${(Math.max(0, s.viewed - s.responded) / s.invited) * 100}%` }} />
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-3.5 text-right align-top">
        <span className="text-sm tabular-nums text-foreground">
          {rfq.lowestQuote !== null ? formatCurrency(rfq.lowestQuote, rfq.currency) : "—"}
        </span>
      </td>
      <td className="px-3 py-3.5 align-top">
        <p className="text-xs text-foreground">{formatDate(rfq.deadline)}</p>
        <p
          className={cn(
            "mt-0.5 text-[11px]",
            tone === "urgent" && "font-medium text-rose-600 dark:text-rose-400",
            tone === "soon" && "text-amber-600 dark:text-amber-400",
            tone === "normal" && "text-muted-foreground",
            tone === "past" && "text-muted-foreground"
          )}
        >
          {remaining ?? "Closed"}
        </p>
      </td>
    </tr>
  );
}

function EngagementStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "sky" | "emerald" | "rose" | "amber";
}) {
  const colors = {
    neutral: "text-foreground",
    sky: "text-sky-600 dark:text-sky-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
  } as const;
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", colors[tone])}>{value}</p>
    </div>
  );
}
