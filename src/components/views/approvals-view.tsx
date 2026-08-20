// NextMav Procure — Approvals queue view

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Filter,
  Inbox,
  Loader2,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  Avatar,
  EmptyState,
  KpiCard,
  PageHeader,
  PriorityBadge,
  SectionCard,
  StatusBadge,
  VendorComplianceBadge,
  VendorStatusBadge,
} from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import type { Vendor } from "@/lib/types";
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
        description="Everything awaiting your decision — purchase requests and supplier onboarding."
      />

      {/* Vendor onboarding runs on the same approval engine as requests, so the
          people who review suppliers find that work in the same place. */}
      <VendorApprovalQueue />

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

// ---------------------------------------------------------------------------
// Vendor onboarding approvals
// ---------------------------------------------------------------------------

interface VendorQueueItem {
  id: string;
  stage: string;
  sequence: number;
  slaExpiresAt?: string;
  waitingSince: string;
  vendor: Vendor;
}

/**
 * Supplier onboarding awaiting this user.
 *
 * Fetched from /api/vendors/approvals/queue, which returns only steps that are
 * genuinely actionable — the caller is the assigned approver and no earlier stage
 * is still outstanding. Nothing is shown here that the server would refuse.
 */
function VendorApprovalQueue() {
  const navigate = useStore((s) => s.navigate);
  const selectVendor = useStore((s) => s.selectVendor);
  const decideVendor = useStore((s) => s.decideVendor);

  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<VendorQueueItem | null>(null);
  const [reason, setReason] = useState("");

  const fetcher = useCallback(() => api.get<VendorQueueItem[]>("/api/vendors/approvals/queue"), []);
  const { data: items, reload: load } = useServerData(fetcher);

  // Nothing to decide, or the queue has not answered yet — this section simply
  // is not part of the page. An empty "no vendor approvals" card would be noise
  // on a screen that is mostly about purchase requests.
  if (!items || items.length === 0) return null;

  const decide = async (item: VendorQueueItem, decision: "APPROVED" | "REJECTED", comment?: string) => {
    setBusy(item.id);
    const ok = await mutate(
      () => decideVendor(item.vendor.id, item.id, decision, comment),
      {
        success:
          decision === "APPROVED"
            ? `${item.vendor.companyName} cleared this stage`
            : `${item.vendor.companyName} rejected`,
      }
    );
    setBusy(null);
    setRejecting(null);
    setReason("");
    if (ok !== null) await load();
  };

  return (
    <>
      <SectionCard
        title="Supplier onboarding awaiting you"
        description="Approving clears your stage; the supplier moves on to the next reviewer or becomes approved."
      >
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <button
                onClick={() => {
                  selectVendor(item.vendor.id);
                  navigate("vendor-detail");
                }}
                className="flex min-w-0 items-center gap-3 text-left"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white">
                  {item.vendor.companyName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.vendor.companyName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.stage.replace(/_/g, " ").toLowerCase()} · waiting{" "}
                    {formatRelativeTime(item.waitingSince)}
                    {item.slaExpiresAt ? ` · due ${formatRelativeTime(item.slaExpiresAt)}` : ""}
                  </p>
                </div>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <VendorComplianceBadge state={item.vendor.complianceState} />
                <VendorStatusBadge status={item.vendor.status} />
                <button
                  onClick={() => void decide(item, "APPROVED")}
                  disabled={busy === item.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === item.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Approve
                </button>
                <button
                  onClick={() => {
                    setRejecting(item);
                    setReason("");
                  }}
                  disabled={busy === item.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <X size={13} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">
              Reject {rejecting.vendor.companyName}?
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The reason is shown to whoever put this supplier forward, and the approval history is
              kept so a later resubmission can be read against it.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this supplier not being approved?"
              className="mt-4 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setRejecting(null)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void decide(rejecting, "REJECTED", reason)}
                disabled={reason.trim().length === 0 || busy !== null}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy !== null && <Loader2 size={14} className="animate-spin" />}
                Reject supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
