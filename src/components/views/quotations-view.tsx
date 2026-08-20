// NextMav Procure — the quotation inbox (§24).
//
// Every bid the organization has received, across every RFQ, in one place. It is
// the screen a buyer opens to answer "what came in today?" without walking each
// tender.
//
// Drafts are absent by design. A supplier's unfinished quotation is their own
// workspace and is not a response — §15 and §11 both turn on that, and putting it
// in the buyer's inbox would leak work in progress.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Loader2, Lock, Search, TriangleAlert, X } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  EmptyState,
  PageHeader,
  Pagination,
  QuotationStatusBadge,
  SectionCard,
  SkeletonList,
  SortableHeader,
} from "@/components/shared";
import { api } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import type { Page, QuotationInboxRow } from "@/lib/sourcing";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FILTERS = [
  { key: "live", label: "In contention", status: "SUBMITTED,RECEIVED,UNDER_EVALUATION" },
  { key: "all", label: "All", status: "ALL" },
  { key: "selected", label: "Awarded", status: "SELECTED" },
  { key: "rejected", label: "Unsuccessful", status: "REJECTED" },
  { key: "history", label: "Withdrawn & superseded", status: "WITHDRAWN,SUPERSEDED,EXPIRED" },
];

export function QuotationsView() {
  const navigate = useStore((s) => s.navigate);
  const selectRfq = useStore((s) => s.selectRfq);

  const [filter, setFilter] = useState("live");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "submittedAt",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // A real effect, because the cleanup matters: `useMemo` never calls the function
  // it returns, so a timer created there is never cleared. setState happens inside
  // the timeout callback rather than in the effect body, which is what makes this
  // a subscription to a timer rather than a cascading render.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const status = FILTERS.find((f) => f.key === filter)?.status ?? "ALL";

  const fetchInbox = useCallback(
    () =>
      api.get<Page<QuotationInboxRow>>("/api/quotations", {
        page,
        pageSize,
        status,
        search: debounced || undefined,
        sort: sort.key,
        dir: sort.dir,
      }),
    [page, pageSize, status, debounced, sort.key, sort.dir]
  );
  const inbox = useServerData(fetchInbox, "Could not load quotations.");

  const onSort = (key: string) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(1);
  };

  const rows = inbox.data?.items ?? [];
  const total = rows.reduce((s, r) => (r.sealed ? s : s + r.totalAmount), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotation Inbox"
        description="Every bid received across every RFQ. Supplier drafts are not shown — an unfinished quotation is not a response."
        actions={
          <button
            onClick={() => navigate("rfqs")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Back to sourcing
          </button>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
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

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by supplier, quotation number or RFQ…"
              className="h-9 w-full rounded-lg border border-input bg-card pl-10 pr-9 text-sm placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
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
              setSort({ key: k, dir: "desc" });
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-[180px] text-sm">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submittedAt">Most recent</SelectItem>
              <SelectItem value="totalAmount">Value</SelectItem>
              <SelectItem value="deliveryDays">Delivery time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {inbox.error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {inbox.error}
        </div>
      )}

      <SectionCard
        title="Received quotations"
        description={
          inbox.data
            ? `${inbox.data.total} on this filter${total > 0 ? ` · ${formatCurrency(total)} on this page` : ""}`
            : "Loading…"
        }
        action={inbox.loading ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : undefined}
        bodyClassName="p-0"
      >
        {inbox.loading && !inbox.data ? (
          <div className="p-5">
            <SkeletonList count={6} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No quotations here"
            description={
              debounced
                ? "Nothing matches that search."
                : "Bids appear here as soon as suppliers submit them through the portal, or when a buyer records one that arrived by email."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Supplier
                    </th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      RFQ
                    </th>
                    <th className="px-3 py-3 text-right">
                      <SortableHeader label="Total" sortKey="totalAmount" currentSort={sort} onSort={onSort} align="right" />
                    </th>
                    <th className="px-3 py-3 text-center">
                      <SortableHeader label="Delivery" sortKey="deliveryDays" currentSort={sort} onSort={onSort} align="center" />
                    </th>
                    <th className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Valid until
                    </th>
                    <th className="px-3 py-3 text-left">
                      <SortableHeader label="Submitted" sortKey="submittedAt" currentSort={sort} onSort={onSort} />
                    </th>
                    <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((q) => (
                    <tr
                      key={q.id}
                      onClick={() => {
                        selectRfq(q.rfq.id);
                        navigate("rfq-detail");
                      }}
                      className="cursor-pointer transition-colors hover:bg-muted/30"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-[10px] font-semibold text-white">
                            {q.vendor.companyName.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{q.vendor.companyName}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              {q.quotationNumber ?? "—"}
                              {q.revision > 1 && ` · rev ${q.revision}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[240px] px-3 py-3.5">
                        <p className="truncate text-sm text-foreground">{q.rfq.title}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{q.rfq.rfqNumber}</p>
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        {q.sealed ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock size={11} /> Sealed
                          </span>
                        ) : (
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(q.totalAmount, q.currency)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-center text-sm tabular-nums text-foreground">
                        {q.sealed ? "—" : `${q.deliveryDays}d`}
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        {q.validUntil ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs",
                              q.isExpired ? "font-medium text-rose-600 dark:text-rose-400" : "text-foreground"
                            )}
                          >
                            {q.isExpired && <TriangleAlert size={11} />}
                            {q.isExpired ? "Expired" : formatDate(q.validUntil)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">
                        {q.submittedAt ? formatRelativeTime(q.submittedAt) : "—"}
                      </td>
                      <td className="px-3 py-3.5">
                        <QuotationStatusBadge status={q.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={inbox.data?.total ?? 0}
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
