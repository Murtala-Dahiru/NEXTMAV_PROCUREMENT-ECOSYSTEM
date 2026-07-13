// NextMav Procure — Purchase Requests list view

"use client";

import { useMemo, useState } from "react";
import {
  ClipboardList,
  Download,
  Filter,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, PageHeader, PriorityBadge, StatusBadge } from "@/components/shared";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import { type Priority, type RequestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function RequestsView() {
  const navigate = useStore((s) => s.navigate);
  const selectRequest = useStore((s) => s.selectRequest);
  const requests = useStore((s) => s.requests);
  const users = useStore((s) => s.users);
  const departments = useStore((s) => s.departments);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [deptFilter, setDeptFilter] = useState<string>("ALL");

  const filtered = useMemo(() => {
    return requests
      .filter((r) => {
        if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
        if (priorityFilter !== "ALL" && r.priority !== priorityFilter) return false;
        if (deptFilter !== "ALL" && r.departmentId !== deptFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const matches =
            r.title.toLowerCase().includes(q) ||
            r.requestNumber.toLowerCase().includes(q) ||
            r.businessJustification.toLowerCase().includes(q);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [requests, statusFilter, priorityFilter, deptFilter, search]);

  const statuses: RequestStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED"];
  const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

  const handleRowClick = (id: string) => {
    selectRequest(id);
    navigate("request-detail");
  };

  const hasActiveFilters = statusFilter !== "ALL" || priorityFilter !== "ALL" || deptFilter !== "ALL" || search !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Requests"
        description={`${requests.length} total requests across your organization`}
        actions={
          <>
            <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors">
              <Download size={15} className="text-muted-foreground" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={() => navigate("request-new")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New Request</span>
            </button>
          </>
        }
      />

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, request number, or justification…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[150px] text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All priorities</SelectItem>
              {priorities.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
                setPriorityFilter("ALL");
                setDeptFilter("ALL");
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Filter size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No purchase requests found"
          description={hasActiveFilters
            ? "Try adjusting your filters or search terms."
            : "Create your first purchase request to get started."}
          action={
            <button
              onClick={() => navigate("request-new")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Plus size={15} />
              New Request
            </button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Header row (desktop) */}
          <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-3 border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">Request</div>
            <div className="col-span-2">Requester</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-1">Department</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Updated</div>
            <div className="col-span-1 text-right">Value</div>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((r) => {
              const requester = users.find((u) => u.id === r.requestedById);
              const dept = departments.find((d) => d.id === r.departmentId);
              return (
                <button
                  key={r.id}
                  onClick={() => handleRowClick(r.id)}
                  className="w-full grid grid-cols-1 md:grid-cols-12 gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left items-center group"
                >
                  <div className="md:col-span-4 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {r.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {r.requestNumber} · {r.lineItems.length} line item{r.lineItems.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-2 min-w-0">
                    <Avatar initials={requester?.initials ?? "?"} color={requester?.avatarColor ?? "bg-slate-500"} size="sm" />
                    <span className="text-xs text-foreground truncate hidden md:block">{requester?.name}</span>
                  </div>
                  <div className="md:col-span-1">
                    <PriorityBadge priority={r.priority} />
                  </div>
                  <div className="md:col-span-1">
                    <span className="text-xs text-muted-foreground truncate">{dept?.name ?? "—"}</span>
                  </div>
                  <div className="md:col-span-2">
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="md:col-span-1 text-xs text-muted-foreground">
                    {formatRelativeTime(r.updatedAt)}
                  </div>
                  <div className="md:col-span-1 md:text-right">
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {formatCurrency(r.totalEstimated, r.currency)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
