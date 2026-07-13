// NextMav Procure — Purchase Request detail view

"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CircleDot,
  Clock,
  DollarSign,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, PageHeader, PriorityBadge, SectionCard, StatusBadge } from "@/components/shared";
import { formatCurrency, formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { ROLE_LABELS, type ApprovalStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function RequestDetailView() {
  const navigate = useStore((s) => s.navigate);
  const requestId = useStore((s) => s.selectedRequestId);
  const requests = useStore((s) => s.requests);
  const users = useStore((s) => s.users);
  const departments = useStore((s) => s.departments);
  const currentUser = useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
  const approveRequest = useStore((s) => s.approveRequest);
  const submitRequest = useStore((s) => s.submitRequest);
  const cancelRequest = useStore((s) => s.cancelRequest);

  const [comment, setComment] = useState("");
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | "CHANGES_REQUESTED">("APPROVED");

  const req = requests.find((r) => r.id === requestId);

  if (!req) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate("requests")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back to requests
        </button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Request not found.</p>
        </div>
      </div>
    );
  }

  const requester = users.find((u) => u.id === req.requestedById);
  const dept = departments.find((d) => d.id === req.departmentId);

  const pendingApproval = req.approvals.find((a) => a.decision === "PENDING");
  const canApprove =
    pendingApproval &&
    (pendingApproval.approverId === currentUser.id ||
      currentUser.role === "SUPER_ADMIN") &&
    (req.status === "SUBMITTED" || req.status === "UNDER_REVIEW");

  const canEdit = (req.requestedById === currentUser.id || currentUser.role === "SUPER_ADMIN") && req.status === "DRAFT";

  const handleApprove = () => {
    if (!pendingApproval) return;
    approveRequest(req.id, decision, comment);
    setComment("");
    setShowApproveDialog(false);
    toast.success(
      decision === "APPROVED"
        ? "Request approved"
        : decision === "REJECTED"
        ? "Request rejected"
        : "Changes requested",
      {
        description: `${req.requestNumber} has been ${decision.toLowerCase().replace("_", " ")}.`,
      }
    );
  };

  const stageLabel = (stage: ApprovalStage) =>
    stage === "DEPARTMENT_MANAGER" ? "Department Manager" : stage.charAt(0) + stage.slice(1).toLowerCase();

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          onClick={() => navigate("requests")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft size={14} /> Back to requests
        </button>
        <div className="flex items-center gap-2">
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors">
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
          {canEdit && (
            <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors">
              <Pencil size={14} />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {req.status === "DRAFT" && (req.requestedById === currentUser.id || currentUser.role === "SUPER_ADMIN") && (
            <button
              onClick={() => {
                submitRequest(req.id);
                toast.success("Request submitted", { description: `${req.requestNumber} is now in the approval queue.` });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Send size={14} />
              Submit for Approval
            </button>
          )}
          {(req.status === "SUBMITTED" || req.status === "UNDER_REVIEW") && (req.requestedById === currentUser.id || currentUser.role === "SUPER_ADMIN") && (
            <button
              onClick={() => {
                cancelRequest(req.id);
                toast.info("Request cancelled", { description: `${req.requestNumber} has been cancelled.` });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 transition-colors"
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Cancel</span>
            </button>
          )}
        </div>
      </div>

      {/* Title section */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">{req.requestNumber}</span>
              <StatusBadge status={req.status} />
              <PriorityBadge priority={req.priority} />
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground text-balance">{req.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Avatar initials={requester?.initials ?? "?"} color={requester?.avatarColor ?? "bg-slate-500"} size="sm" />
                <span>{requester?.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Building2 size={13} />
                <span>{dept?.name ?? "No department"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={13} />
                <span>Created {formatDate(req.createdAt)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={13} />
                <span>Needed by {formatDate(req.neededByDate)}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Estimated Total</p>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {formatCurrency(req.totalEstimated, req.currency)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left — line items + justification */}
        <div className="lg:col-span-2 space-y-6">
          {/* Line items */}
          <SectionCard
            title="Line Items"
            description={`${req.lineItems.length} item${req.lineItems.length !== 1 ? "s" : ""} in this request`}
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border">
              <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                <div className="col-span-5">Item</div>
                <div className="col-span-1 text-center">Qty</div>
                <div className="col-span-1">Unit</div>
                <div className="col-span-2 text-right">Unit Cost</div>
                <div className="col-span-3 text-right">Subtotal</div>
              </div>
              {req.lineItems.map((li) => (
                <div key={li.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 px-5 py-3.5 items-start sm:items-center">
                  <div className="sm:col-span-5 min-w-0">
                    <p className="text-sm font-medium text-foreground">{li.itemName}</p>
                    {li.description && <p className="text-xs text-muted-foreground mt-0.5">{li.description}</p>}
                  </div>
                  <div className="sm:col-span-1 text-sm text-foreground tabular-nums sm:text-center">{li.quantity}</div>
                  <div className="sm:col-span-1 text-xs text-muted-foreground">{li.unit}</div>
                  <div className="sm:col-span-2 text-sm text-foreground tabular-nums sm:text-right">
                    {formatCurrency(li.estimatedCost, req.currency)}
                  </div>
                  <div className="sm:col-span-3 text-sm font-semibold text-foreground tabular-nums sm:text-right">
                    {formatCurrency(li.quantity * li.estimatedCost, req.currency)}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3 px-5 py-4 bg-muted/20">
                <div className="text-sm text-muted-foreground">Total Estimated</div>
                <div className="text-right text-base font-semibold text-foreground tabular-nums">
                  {formatCurrency(req.totalEstimated, req.currency)}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Business Justification */}
          <SectionCard title="Business Justification" description="Submitted by requester">
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{req.businessJustification}</p>
          </SectionCard>

          {/* Attachments */}
          <SectionCard
            title="Attachments"
            description={`${req.attachments.length} file${req.attachments.length !== 1 ? "s" : ""} attached`}
          >
            {req.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files attached.</p>
            ) : (
              <div className="space-y-2">
                {req.attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-card border border-border text-muted-foreground">
                      <Paperclip size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{file.size}</p>
                    </div>
                    <Download size={15} className="text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right — approval workflow + comments */}
        <div className="space-y-6">
          {/* Approval workflow */}
          <SectionCard title="Approval Workflow" description="Multi-stage approval chain">
            <div className="space-y-3">
              {req.approvals.length === 0 && (
                <div className="text-sm text-muted-foreground py-3 text-center">
                  Not yet submitted for approval.
                </div>
              )}
              {req.approvals.map((ap, idx) => {
                const approver = users.find((u) => u.id === ap.approverId);
                const isLast = idx === req.approvals.length - 1;
                return (
                  <div key={ap.id} className="relative">
                    {!isLast && (
                      <div className="absolute left-[15px] top-9 bottom-[-12px] w-px bg-border" />
                    )}
                    <div className="flex gap-3">
                      <div className="relative shrink-0">
                        <div
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-card",
                            ap.decision === "APPROVED" && "bg-emerald-500 text-white",
                            ap.decision === "REJECTED" && "bg-rose-500 text-white",
                            ap.decision === "PENDING" && "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
                            ap.decision === "CHANGES_REQUESTED" && "bg-orange-500 text-white"
                          )}
                        >
                          {ap.decision === "APPROVED" && <Check size={15} />}
                          {ap.decision === "REJECTED" && <X size={15} />}
                          {ap.decision === "PENDING" && <CircleDot size={15} />}
                          {ap.decision === "CHANGES_REQUESTED" && <Pencil size={14} />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{stageLabel(ap.stage)}</p>
                          <span
                            className={cn(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide",
                              ap.decision === "APPROVED" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                              ap.decision === "REJECTED" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                              ap.decision === "PENDING" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                              ap.decision === "CHANGES_REQUESTED" && "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                            )}
                          >
                            {ap.decision.replace("_", " ").toLowerCase()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {approver?.name} · {approver ? ROLE_LABELS[approver.role] : "—"}
                        </p>
                        {ap.comment && (
                          <div className="mt-2 rounded-lg bg-muted/60 border border-border p-2.5">
                            <p className="text-xs text-foreground italic">"{ap.comment}"</p>
                          </div>
                        )}
                        {ap.decidedAt && (
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            {formatDateTime(ap.decidedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Approve / Reject actions */}
            {canApprove && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Action required — this request is awaiting your approval at the {stageLabel(pendingApproval!.stage)} stage.
                  </p>
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment (optional)…"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
                  rows={2}
                />
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setDecision("APPROVED");
                      setShowApproveDialog(true);
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    onClick={() => {
                      setDecision("CHANGES_REQUESTED");
                      setShowApproveDialog(true);
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <Pencil size={14} /> Changes
                  </button>
                  <button
                    onClick={() => {
                      setDecision("REJECTED");
                      setShowApproveDialog(true);
                    }}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 transition-colors"
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Quick stats */}
          <SectionCard title="Summary">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Request #</dt>
                <dd className="font-mono text-foreground">{req.requestNumber}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Department</dt>
                <dd className="text-foreground">{dept?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority</dt>
                <dd><PriorityBadge priority={req.priority} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Needed by</dt>
                <dd className="text-foreground">{formatDate(req.neededByDate)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Items</dt>
                <dd className="text-foreground">{req.lineItems.length}</dd>
              </div>
              <div className="flex justify-between pt-3 border-t border-border">
                <dt className="font-medium text-foreground">Total</dt>
                <dd className="font-semibold text-foreground tabular-nums">{formatCurrency(req.totalEstimated, req.currency)}</dd>
              </div>
            </dl>
          </SectionCard>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showApproveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6 animate-fade-up">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full shrink-0",
                  decision === "APPROVED" && "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
                  decision === "REJECTED" && "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
                  decision === "CHANGES_REQUESTED" && "bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
                )}
              >
                {decision === "APPROVED" && <CheckCircle2 size={20} />}
                {decision === "REJECTED" && <XCircle size={20} />}
                {decision === "CHANGES_REQUESTED" && <MessageSquare size={20} />}
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {decision === "APPROVED" ? "Approve request?" : decision === "REJECTED" ? "Reject request?" : "Request changes?"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {decision === "APPROVED" && "This will advance the request to the next approval stage."}
                  {decision === "REJECTED" && "This will reject the request. The requester will be notified."}
                  {decision === "CHANGES_REQUESTED" && "The requester will be asked to make changes and resubmit."}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowApproveDialog(false)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-white transition-colors",
                  decision === "APPROVED" && "bg-emerald-600 hover:bg-emerald-700",
                  decision === "REJECTED" && "bg-rose-600 hover:bg-rose-700",
                  decision === "CHANGES_REQUESTED" && "bg-orange-500 hover:bg-orange-600"
                )}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
