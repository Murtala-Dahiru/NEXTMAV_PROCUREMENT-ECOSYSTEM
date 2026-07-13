// NextMav Procure — Approvals queue view

"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Filter,
  Inbox,
  Search,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, KpiCard, PageHeader, PriorityBadge, SectionCard, StatusBadge } from "@/components/shared";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { ROLE_LABELS, type ApprovalStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function ApprovalsView() {
  const navigate = useStore((s) => s.navigate);
  const selectRequest = useStore((s) => s.selectRequest);
  const requests = useStore((s) => s.requests);
  const users = useStore((s) => s.users);
  const departments = useStore((s) => s.departments);
  const currentUser = useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
  const approveRequest = useStore((s) => s.approveRequest);

  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [search, setSearch] = useState("");

  // Pending approvals: items where there's a PENDING step assigned to current user (or super admin sees all)
  const pendingForMe = useMemo(() => {
    return requests
      .filter((r) => {
        if (r.status !== "SUBMITTED" && r.status !== "UNDER_REVIEW") return false;
        const pending = r.approvals.find((a) => a.decision === "PENDING");
        if (!pending) return false;
        // Current user is the approver, OR super admin/finance/procurement can see all pending at their stage
        if (pending.approverId === currentUser.id) return true;
        if (currentUser.role === "SUPER_ADMIN") return true;
        // For demo: if user has the role that matches the pending stage, show it
        if (pending.stage === "FINANCE" && currentUser.role === "FINANCE_OFFICER") return true;
        if (pending.stage === "PROCUREMENT" && currentUser.role === "PROCUREMENT_MANAGER") return true;
        if (pending.stage === "DEPARTMENT_MANAGER" && currentUser.role === "DEPARTMENT_MANAGER") return true;
        return false;
      })
      .filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return r.title.toLowerCase().includes(q) || r.requestNumber.toLowerCase().includes(q);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [requests, currentUser, search]);

  // History: approvals the user has acted on
  const myHistory = useMemo(() => {
    return requests
      .flatMap((r) =>
        r.approvals
          .filter((a) => a.approverId === currentUser.id && a.decision !== "PENDING")
          .map((a) => ({ ...a, request: r }))
      )
      .sort((a, b) => new Date(b.decidedAt ?? b.createdAt).getTime() - new Date(a.decidedAt ?? a.createdAt).getTime());
  }, [requests, currentUser]);

  const pendingCount = pendingForMe.length;
  const completedToday = myHistory.filter((a) => {
    if (!a.decidedAt) return false;
    const decided = new Date(a.decidedAt);
    const today = new Date();
    return decided.toDateString() === today.toDateString();
  }).length;
  const totalApproved = myHistory.filter((a) => a.decision === "APPROVED").length;
  const totalRejected = myHistory.filter((a) => a.decision === "REJECTED").length;

  const stageLabel = (stage: ApprovalStage) =>
    stage === "DEPARTMENT_MANAGER" ? "Department Manager" : stage.charAt(0) + stage.slice(1).toLowerCase();

  const handleQuickApprove = (requestId: string, decision: "APPROVED" | "REJECTED") => {
    approveRequest(requestId, decision, "");
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected", {
      description: `Request has been ${decision.toLowerCase()}.`,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Review and act on purchase requests awaiting your decision."
      />

      {/* KPI strip */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending for You" value={pendingCount} icon={Clock} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Decided Today" value={completedToday} icon={CheckCircle2} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Total Approved" value={totalApproved} icon={Check} iconBg="bg-teal-100 dark:bg-teal-950/40" />
        <KpiCard label="Total Rejected" value={totalRejected} icon={X} iconBg="bg-rose-100 dark:bg-rose-950/40" />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setTab("pending")}
          className={cn(
            "relative px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
            tab === "pending" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Pending ({pendingCount})
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "relative px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
            tab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          History ({myHistory.length})
        </button>
      </div>

      {tab === "pending" && (
        <>
          {/* Search */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pending approvals…"
              className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
          </div>

          {pendingForMe.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No pending approvals"
              description="You're all caught up. New requests awaiting your decision will appear here."
            />
          ) : (
            <div className="space-y-3">
              {pendingForMe.map((r) => {
                const pending = r.approvals.find((a) => a.decision === "PENDING")!;
                const approver = users.find((u) => u.id === pending.approverId);
                const requester = users.find((u) => u.id === r.requestedById);
                const dept = departments.find((d) => d.id === r.departmentId);
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] transition-all"
                  >
                    <div className="flex flex-col lg:flex-row gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => {
                              selectRequest(r.id);
                              navigate("request-detail");
                            }}
                            className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {r.requestNumber}
                          </button>
                          <StatusBadge status={r.status} />
                          <PriorityBadge priority={r.priority} />
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
                            Awaiting {stageLabel(pending.stage)} approval
                          </span>
                        </div>
                        <h3
                          className="mt-2 text-base font-semibold text-foreground cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                          onClick={() => {
                            selectRequest(r.id);
                            navigate("request-detail");
                          }}
                        >
                          {r.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{r.businessJustification}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Avatar initials={requester?.initials ?? "?"} color={requester?.avatarColor ?? "bg-slate-500"} size="sm" />
                            <span>{requester?.name}</span>
                          </div>
                          <span>·</span>
                          <span>{dept?.name ?? "No department"}</span>
                          <span>·</span>
                          <span>{r.lineItems.length} item{r.lineItems.length !== 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>Needed by {formatDate(r.neededByDate)}</span>
                        </div>
                      </div>
                      <div className="lg:w-64 shrink-0 lg:border-l lg:border-border lg:pl-5 flex flex-col justify-between gap-3">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total Estimated</p>
                          <p className="text-2xl font-semibold tabular-nums text-foreground">
                            {formatCurrency(r.totalEstimated, r.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Submitted {formatRelativeTime(r.submittedAt ?? r.createdAt)}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleQuickApprove(r.id, "REJECTED")}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 transition-colors"
                          >
                            <X size={14} /> Reject
                          </button>
                          <button
                            onClick={() => handleQuickApprove(r.id, "APPROVED")}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                          >
                            <Check size={14} /> Approve
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            selectRequest(r.id);
                            navigate("request-detail");
                          }}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
                        >
                          View full details →
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          {myHistory.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No approval history yet"
              description="Requests you've approved or rejected will appear here."
            />
          ) : (
            <SectionCard bodyClassName="p-0">
              <div className="divide-y divide-border">
                {myHistory.map((a) => {
                  const requester = users.find((u) => u.id === a.request.requestedById);
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        selectRequest(a.request.id);
                        navigate("request-detail");
                      }}
                      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full shrink-0",
                          a.decision === "APPROVED" && "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
                          a.decision === "REJECTED" && "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
                          a.decision === "CHANGES_REQUESTED" && "bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
                        )}
                      >
                        {a.decision === "APPROVED" ? <Check size={15} /> : <X size={15} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{a.request.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.request.requestNumber} · {requester?.name} · {stageLabel(a.stage)}
                        </p>
                      </div>
                      {a.comment && (
                        <p className="hidden lg:block text-xs text-muted-foreground italic truncate max-w-xs">
                          "{a.comment}"
                        </p>
                      )}
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {formatCurrency(a.request.totalEstimated, a.request.currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatRelativeTime(a.decidedAt ?? a.createdAt)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
