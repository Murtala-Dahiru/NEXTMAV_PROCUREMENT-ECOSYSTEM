// NextMav Procure — RFQ detail.
//
// One screen that has to answer §22's questions without making the buyer hunt:
// what are we sourcing, why, who was invited, how many answered, what is the
// deadline, what is the state, and what can I do next.
//
// The action bar is the part worth explaining. It renders from the RFQ's actual
// state and the caller's actual permissions, not from a fixed set of buttons that
// error when pressed. `availableTransitions` and `readiness` both come from the
// server — the same functions that enforce the rules — so what the screen offers
// and what the API will accept cannot drift apart.

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Gavel,
  Inbox,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  Package,
  RefreshCw,
  Scale,
  Send,
  ShieldCheck,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  Avatar,
  EmptyState,
  InvitationStatusBadge,
  PageHeader,
  QuotationStatusBadge,
  RFQStatusBadge,
  SectionCard,
  SkeletonList,
  StatusBadge,
} from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import {
  RFQ_EDITABLE,
  RFQ_OPEN,
  deadlineTone,
  prettyStatus,
  timeRemaining,
  type Comparison,
  type EvaluationSummary,
  type RfqDetail,
} from "@/lib/sourcing";
import { cn } from "@/lib/utils";
import { ComparisonPanel } from "./rfq-comparison-panel";
import { EvaluationPanel } from "./rfq-evaluation-panel";
import { AwardPanel } from "./rfq-award-panel";

type Tab = "overview" | "suppliers" | "questions" | "quotations" | "comparison" | "evaluation" | "award";

export function RfqDetailView() {
  const navigate = useStore((s) => s.navigate);
  const rfqId = useStore((s) => s.selectedRfqId);
  const hasPermission = useStore((s) => s.hasPermission);

  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ kind: string; label: string; hint: string } | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const fetchRfq = useCallback(() => api.get<RfqDetail>(`/api/rfqs/${rfqId}`), [rfqId]);
  const { data: rfq, error, loading, reload } = useServerData(fetchRfq, "Could not load this RFQ.");

  const fetchComparison = useCallback(
    () => api.get<Comparison>(`/api/rfqs/${rfqId}/comparison`),
    [rfqId]
  );
  const comparison = useServerData(fetchComparison, "Could not build the comparison.");

  const fetchEvaluation = useCallback(
    () => api.get<EvaluationSummary>(`/api/rfqs/${rfqId}/evaluation`),
    [rfqId]
  );
  const evaluation = useServerData(fetchEvaluation, "Could not load the evaluation.");

  const refreshAll = async () => {
    await Promise.all([reload(), comparison.reload(), evaluation.reload()]);
  };

  const run = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(label);
    const r = await mutate(fn, { success });
    setBusy(null);
    if (r) await refreshAll();
  };

  if (loading && !rfq) {
    return (
      <div className="space-y-6">
        <SkeletonList count={4} />
      </div>
    );
  }

  if (error || !rfq) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate("rfqs")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back to sourcing
        </button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">{error ?? "RFQ not found."}</p>
        </div>
      </div>
    );
  }

  const isOpen = RFQ_OPEN.includes(rfq.status);
  const isEditable = RFQ_EDITABLE.includes(rfq.status);
  const can = (t: string) => rfq.availableTransitions.includes(t);
  const remaining = timeRemaining(rfq.deadline);
  const tone = deadlineTone(rfq.deadline);

  const responded = rfq.invitedVendors.filter((i) => i.status === "QUOTED").length;
  const declined = rfq.invitedVendors.filter((i) => i.status === "DECLINED").length;
  const viewedCount = rfq.invitedVendors.filter(
    (i) => i.status !== "INVITED" && i.status !== "NO_RESPONSE"
  ).length;
  const openQuestions = rfq.clarifications.filter((c) => c.status === "OPEN").length;
  const liveQuotes = rfq.quotations.filter(
    (q) => q.status !== "WITHDRAWN" && q.status !== "SUPERSEDED"
  );

  const tabs: { key: Tab; label: string; icon: typeof FileText; badge?: number }[] = [
    { key: "overview", label: "Overview", icon: FileText },
    { key: "suppliers", label: "Suppliers", icon: Users, badge: rfq.invitedVendors.length },
    { key: "questions", label: "Questions", icon: MessageSquare, badge: openQuestions || undefined },
    { key: "quotations", label: "Quotations", icon: Inbox, badge: liveQuotes.length || undefined },
    { key: "comparison", label: "Comparison", icon: Scale },
    { key: "evaluation", label: "Evaluation", icon: Gavel },
    { key: "award", label: "Award", icon: Award },
  ];

  const submitPrompt = async () => {
    if (!prompt) return;
    const value = promptValue.trim();
    const kind = prompt.kind;
    setPrompt(null);
    setPromptValue("");

    if (kind === "close") {
      await run("close", () => api.post(`/api/rfqs/${rfq.id}/close`, { reason: value }), "Response period closed");
    } else if (kind === "cancel") {
      await run("cancel", () => api.post(`/api/rfqs/${rfq.id}/cancel`, { reason: value }), "RFQ cancelled");
    } else if (kind === "no-award") {
      await run("no-award", () => api.post(`/api/rfqs/${rfq.id}/no-award`, { reason: value }), "Closed with no award");
    } else if (kind === "reject") {
      await run(
        "reject",
        () =>
          api.post(`/api/rfqs/${rfq.id}/decide`, {
            stepId: rfq.approval?.myStepId,
            decision: "REJECTED",
            comment: value,
          }),
        "Sent back to the buyer"
      );
    }
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("rfqs")}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} /> Back to sourcing
      </button>

      <PageHeader
        title={rfq.title}
        description={`${rfq.rfqNumber}${rfq.referenceNumber ? ` · ${rfq.referenceNumber}` : ""} · raised ${formatRelativeTime(rfq.createdAt)}`}
        breadcrumb={
          rfq.sourcingEvent
            ? [{ label: "Sourcing" }, { label: rfq.sourcingEvent.eventNumber }, { label: rfq.rfqNumber }]
            : undefined
        }
        actions={
          <>
            <RFQStatusBadge status={rfq.status} />
            {rfq.isSealed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                <Lock size={11} /> Sealed
              </span>
            )}
            <button
              onClick={() => void refreshAll()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} /> Refresh
            </button>
          </>
        }
      />

      {/* Readiness — what is still missing before this can go to market (§10). */}
      {isEditable && rfq.readiness.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-foreground">Not ready to publish yet</p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {rfq.readiness.map((r) => (
                  <li key={r.path} className="flex gap-1.5">
                    <span className="text-amber-500">·</span>
                    {r.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {rfq.status === "CANCELLED" && rfq.cancelReason && (
        <Banner tone="rose" icon={Ban} title="This RFQ was cancelled" body={rfq.cancelReason} />
      )}
      {rfq.isSealedAndLocked && (
        <Banner
          tone="violet"
          icon={Lock}
          title="Sealed bidding is in force"
          body={`Quotation contents stay unreadable — to you as well — until the deadline passes on ${formatDate(rfq.deadline)}.`}
        />
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        {rfq.status === "DRAFT" && hasPermission("rfqs.create") && (
          <Action
            label="Submit for approval"
            icon={ClipboardCheck}
            busy={busy === "submit"}
            onClick={() =>
              run("submit", () => api.post(`/api/rfqs/${rfq.id}/submit`, {}), "Sent for approval")
            }
          />
        )}
        {rfq.status === "UNDER_REVIEW" && rfq.approval?.myStepId && hasPermission("rfqs.approve") && (
          <>
            <Action
              label="Approve"
              icon={CheckCircle2}
              variant="primary"
              busy={busy === "approve"}
              onClick={() =>
                run(
                  "approve",
                  () =>
                    api.post(`/api/rfqs/${rfq.id}/decide`, {
                      stepId: rfq.approval?.myStepId,
                      decision: "APPROVED",
                      comment: "",
                    }),
                  "RFQ approved"
                )
              }
            />
            <Action
              label="Send back"
              icon={X}
              variant="danger"
              onClick={() =>
                setPrompt({
                  kind: "reject",
                  label: "Send this RFQ back",
                  hint: "Say what has to change before it can go out to suppliers.",
                })
              }
            />
          </>
        )}
        {can("PUBLISHED") && hasPermission("rfqs.issue") && (
          <Action
            label="Publish to suppliers"
            icon={Send}
            variant="primary"
            busy={busy === "publish"}
            disabled={rfq.readiness.length > 0}
            onClick={() =>
              run("publish", () => api.post(`/api/rfqs/${rfq.id}/publish`, {}), "RFQ published to suppliers")
            }
          />
        )}
        {isOpen && hasPermission("rfqs.issue") && (
          <Action
            label={`Remind (${rfq.remindersSent})`}
            icon={Clock}
            busy={busy === "remind"}
            onClick={() =>
              run("remind", () => api.post(`/api/rfqs/${rfq.id}/remind`, {}), "Reminder sent")
            }
          />
        )}
        {can("CLOSED") && hasPermission("rfqs.issue") && (
          <Action
            label="Close responses"
            icon={Lock}
            onClick={() =>
              setPrompt({ kind: "close", label: "Close the response period", hint: "Optional note for the record." })
            }
          />
        )}
        {can("NO_AWARD") && hasPermission("rfqs.selectQuotation") && (
          <Action
            label="Close with no award"
            icon={Ban}
            onClick={() =>
              setPrompt({
                kind: "no-award",
                label: "Close without an award",
                hint: "Record why none of the bids will be taken. The bids stay on record.",
              })
            }
          />
        )}
        {can("CANCELLED") && hasPermission("rfqs.cancel") && (
          <Action
            label="Cancel RFQ"
            icon={X}
            variant="danger"
            onClick={() =>
              setPrompt({
                kind: "cancel",
                label: "Cancel this RFQ",
                hint: "Invited suppliers are told. Quotations are kept as a record.",
              })
            }
          />
        )}
      </div>

      {/* Response monitor — §23, from the invitation rows only. */}
      {rfq.invitedVendors.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Monitor label="Invited" value={rfq.invitedVendors.length} tone="neutral" />
          <Monitor label="Viewed" value={viewedCount} tone="sky" />
          <Monitor label="Responded" value={responded} tone="emerald" />
          <Monitor label="Declined" value={declined} tone="rose" />
          <Monitor
            label={remaining ? "Time left" : "Deadline"}
            value={remaining ?? formatDate(rfq.deadline)}
            tone={tone === "urgent" ? "rose" : tone === "soon" ? "amber" : "neutral"}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-px">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-t-lg border-b-2 px-3 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon size={14} />
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab rfq={rfq} onOpenRequest={() => {
        if (!rfq.request) return;
        useStore.getState().selectRequest(rfq.request.id);
        navigate("request-detail");
      }} />}

      {tab === "suppliers" && <SuppliersTab rfq={rfq} onChange={refreshAll} />}

      {tab === "questions" && <QuestionsTab rfq={rfq} onChange={refreshAll} />}

      {tab === "quotations" && <QuotationsTab rfq={rfq} />}

      {tab === "comparison" && (
        <ComparisonPanel
          comparison={comparison.data}
          loading={comparison.loading}
          error={comparison.error}
          currency={rfq.currency}
        />
      )}

      {tab === "evaluation" && (
        <EvaluationPanel
          rfq={rfq}
          evaluation={evaluation.data}
          loading={evaluation.loading}
          error={evaluation.error}
          onChange={refreshAll}
        />
      )}

      {tab === "award" && <AwardPanel rfq={rfq} comparison={comparison.data} onChange={refreshAll} />}

      {/* Reason prompt */}
      {prompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setPrompt(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">{prompt.label}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{prompt.hint}</p>
            <textarea
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              rows={3}
              autoFocus
              className="mt-3 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPrompt(null)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitPrompt()}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
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

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function OverviewTab({ rfq, onOpenRequest }: { rfq: RfqDetail; onOpenRequest: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <SectionCard title="Requirement">
          {rfq.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{rfq.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No description recorded.</p>
          )}

          {/* §36 — the chain back to why this money is being spent. */}
          {(rfq.request || rfq.sourcingEvent) && (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Traceability</p>
              <div className="flex flex-wrap items-center gap-2">
                {rfq.request && (
                  <button
                    onClick={onOpenRequest}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                  >
                    <FileText size={14} className="text-muted-foreground" />
                    <span className="font-mono text-xs">{rfq.request.requestNumber}</span>
                    <span className="text-foreground">{rfq.request.title}</span>
                    <StatusBadge status={rfq.request.status} />
                  </button>
                )}
                {rfq.sourcingEvent && (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                    <Package size={14} className="text-muted-foreground" />
                    <span className="font-mono text-xs">{rfq.sourcingEvent.eventNumber}</span>
                    <span className="text-foreground">{rfq.sourcingEvent.title}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Line items" description={`${rfq.lineItems.length} item(s) suppliers must price`} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quantity</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Required by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rfq.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-foreground">{l.itemName}</p>
                      {l.description && <p className="mt-0.5 text-xs text-muted-foreground">{l.description}</p>}
                      {l.specification && (
                        <p className="mt-1 rounded border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                          {l.specification}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-foreground">
                      {l.quantity} <span className="text-xs text-muted-foreground">{l.unit}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums text-muted-foreground">
                      {l.targetPrice !== null ? formatCurrency(l.targetPrice, rfq.currency) : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {l.requiredDeliveryDate ? formatDate(l.requiredDeliveryDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rfq.showTargetPrice && rfq.lineItems.some((l) => l.targetPrice !== null) && (
            <p className="flex items-start gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
              <Info size={13} className="mt-0.5 shrink-0" />
              Target prices are internal. Suppliers do not see them on this RFQ.
            </p>
          )}
        </SectionCard>

        {rfq.termsAndConditions && (
          <SectionCard title="Terms and conditions">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{rfq.termsAndConditions}</p>
          </SectionCard>
        )}
      </div>

      <div className="space-y-4">
        <SectionCard title="Timeline">
          <dl className="space-y-2.5 text-sm">
            <Fact label="Raised" value={formatDate(rfq.createdAt)} icon={Calendar} />
            {rfq.submittedForApprovalAt && <Fact label="Sent for approval" value={formatDate(rfq.submittedForApprovalAt)} icon={ClipboardCheck} />}
            {rfq.approvedAt && <Fact label="Approved" value={`${formatDate(rfq.approvedAt)}${rfq.approvedBy ? ` · ${rfq.approvedBy.name}` : ""}`} icon={CheckCircle2} />}
            {rfq.publishedAt && <Fact label="Published" value={`${formatDate(rfq.publishedAt)}${rfq.publishedBy ? ` · ${rfq.publishedBy.name}` : ""}`} icon={Send} />}
            <Fact label="Responses close" value={formatDate(rfq.deadline)} icon={Clock} />
            {rfq.questionDeadline && <Fact label="Questions close" value={formatDate(rfq.questionDeadline)} icon={MessageSquare} />}
            {rfq.closedAt && <Fact label="Closed" value={formatDate(rfq.closedAt)} icon={Lock} />}
            {rfq.awardedAt && <Fact label="Awarded" value={formatDate(rfq.awardedAt)} icon={Award} />}
          </dl>
        </SectionCard>

        <SectionCard title="Commercial">
          <dl className="space-y-2.5 text-sm">
            <Fact label="Currency" value={rfq.currency} />
            <Fact
              label="Estimated value"
              value={rfq.estimatedValue !== null ? formatCurrency(rfq.estimatedValue, rfq.currency) : "—"}
            />
            <Fact label="Category" value={rfq.categoryRef?.name ?? "—"} />
            <Fact
              label="Evaluation"
              value={
                rfq.evaluationMethod === "LOWEST_PRICE"
                  ? "Lowest price"
                  : `${prettyStatus(rfq.evaluationMethod)} · ${rfq.criteria.length} criteria`
              }
            />
            <Fact label="Delivery terms" value={rfq.deliveryTerms ?? "—"} />
          </dl>
        </SectionCard>

        {rfq.approval && <ApprovalCard approval={rfq.approval} />}

        {rfq.evaluators.length > 0 && (
          <SectionCard title="Evaluation panel" description={`${rfq.evaluators.length} evaluator(s)`}>
            <div className="space-y-2">
              {rfq.evaluators.map((e) => (
                <div key={e.id} className="flex items-center gap-2.5">
                  <Avatar initials={e.user.initials} color={e.user.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{e.user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {prettyStatus(e.role)}
                      {e.isChair && " · Chair"}
                    </p>
                  </div>
                  {e.completedAt && <Check size={14} className="text-emerald-500" />}
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function SuppliersTab({ rfq, onChange }: { rfq: RfqDetail; onChange: () => Promise<void> }) {
  const hasPermission = useStore((s) => s.hasPermission);
  const [revising, setRevising] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const inviteRevision = async (vendorId: string) => {
    const r = await mutate(
      () => api.post(`/api/rfqs/${rfq.id}/allow-revision`, { vendorId, reason: reason.trim() }),
      { success: "Revision invited" }
    );
    setRevising(null);
    setReason("");
    if (r) await onChange();
  };

  if (rfq.invitedVendors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No suppliers invited"
        description="An RFQ cannot be published until at least one eligible supplier is invited."
      />
    );
  }

  return (
    <SectionCard
      title="Invited suppliers"
      description="Response state comes from what each supplier actually did — opened, accepted, quoted or declined."
      bodyClassName="p-0"
    >
      <div className="divide-y divide-border">
        {rfq.invitedVendors.map((iv) => {
          const quote = rfq.quotations.find(
            (q) => q.vendorId === iv.vendorId && q.status !== "SUPERSEDED" && q.status !== "WITHDRAWN"
          );
          return (
            <div key={iv.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white">
                  {iv.vendor.companyName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{iv.vendor.companyName}</p>
                    <InvitationStatusBadge status={iv.status} />
                    {iv.revisionAllowedAt && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        Revision invited
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {iv.vendor.email ?? "No email"}
                    {iv.viewedAt && ` · opened ${formatRelativeTime(iv.viewedAt)}`}
                    {iv.viewCount > 1 && ` (${iv.viewCount} times)`}
                  </p>
                  {iv.declineReason && (
                    <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">Declined: {iv.declineReason}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {quote && !quote.sealed ? (
                    <>
                      <p className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrency(quote.totalAmount, quote.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">{quote.deliveryDays}-day delivery</p>
                    </>
                  ) : quote?.sealed ? (
                    <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock size={11} /> Sealed
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No quotation</p>
                  )}
                </div>
                {iv.status === "QUOTED" && RFQ_OPEN.includes(rfq.status) && hasPermission("rfqs.issue") && (
                  <button
                    onClick={() => setRevising(revising === iv.vendorId ? null : iv.vendorId)}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    Invite revision
                  </button>
                )}
              </div>

              {revising === iv.vendorId && (
                <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    A submitted quotation is final unless you open a revision. The reason is recorded on the tender.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is a revision being invited?"
                      className="h-8 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      onClick={() => void inviteRevision(iv.vendorId)}
                      disabled={!reason.trim()}
                      className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function QuestionsTab({ rfq, onChange }: { rfq: RfqDetail; onChange: () => Promise<void> }) {
  const hasPermission = useStore((s) => s.hasPermission);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "ALL_SUPPLIERS">("PRIVATE");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");

  const submitAnswer = async (id: string) => {
    const r = await mutate(
      () => api.post(`/api/rfqs/${rfq.id}/clarifications/${id}`, { answer: answer.trim(), visibility }),
      { success: visibility === "ALL_SUPPLIERS" ? "Answered and issued to every bidder" : "Answered" }
    );
    setAnswering(null);
    setAnswer("");
    if (r) await onChange();
  };

  const issueNotice = async () => {
    const r = await mutate(
      () => api.post(`/api/rfqs/${rfq.id}/clarifications`, { question: noticeTitle.trim(), answer: noticeBody.trim() }),
      { success: "Notice issued to every invited supplier" }
    );
    setNoticeOpen(false);
    setNoticeTitle("");
    setNoticeBody("");
    if (r) await onChange();
  };

  return (
    <SectionCard
      title="Clarifications"
      description="A private answer goes back to the supplier who asked. A published one reaches every bidder — use it whenever the answer changes a requirement."
      action={
        hasPermission("rfqs.clarify") && (
          <button
            onClick={() => setNoticeOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <Send size={13} /> Issue notice
          </button>
        )
      }
    >
      {noticeOpen && (
        <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <input
            value={noticeTitle}
            onChange={(e) => setNoticeTitle(e.target.value)}
            placeholder="Subject — e.g. Amendment to clause 4"
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            value={noticeBody}
            onChange={(e) => setNoticeBody(e.target.value)}
            rows={3}
            placeholder="What every invited supplier needs to know…"
            className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setNoticeOpen(false)} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
              Cancel
            </button>
            <button
              onClick={() => void issueNotice()}
              disabled={!noticeTitle.trim() || !noticeBody.trim()}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Issue to all suppliers
            </button>
          </div>
        </div>
      )}

      {rfq.clarifications.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No questions have been asked yet.</p>
      ) : (
        <div className="space-y-3">
          {rfq.clarifications.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {c.vendor?.companyName ?? c.askedByUser?.name ?? "Buyer notice"}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                    c.visibility === "ALL_SUPPLIERS"
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {c.visibility === "ALL_SUPPLIERS" ? "All bidders" : "Private"}
                </span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
              </div>
              <p className="mt-2 text-sm text-foreground">{c.question}</p>

              {c.answer ? (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Answered{c.answeredBy ? ` by ${c.answeredBy.name}` : ""}
                    {c.answeredAt ? ` · ${formatRelativeTime(c.answeredAt)}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{c.answer}</p>
                </div>
              ) : hasPermission("rfqs.clarify") ? (
                answering === c.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      rows={3}
                      autoFocus
                      placeholder="Your answer…"
                      className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={visibility === "ALL_SUPPLIERS"}
                          onChange={(e) => setVisibility(e.target.checked ? "ALL_SUPPLIERS" : "PRIVATE")}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                        Publish to every invited supplier
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => setAnswering(null)} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted">
                          Cancel
                        </button>
                        <button
                          onClick={() => void submitAnswer(c.id)}
                          disabled={!answer.trim()}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          Answer
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAnswering(c.id);
                      setAnswer("");
                      setVisibility("PRIVATE");
                    }}
                    className="mt-3 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <MessageSquare size={12} /> Answer
                  </button>
                )
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function QuotationsTab({ rfq }: { rfq: RfqDetail }) {
  const live = rfq.quotations.filter((q) => q.status !== "SUPERSEDED");
  const superseded = rfq.quotations.filter((q) => q.status === "SUPERSEDED");

  if (rfq.quotations.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No quotations yet"
        description={
          RFQ_OPEN.includes(rfq.status)
            ? `Suppliers have until ${formatDate(rfq.deadline)} to respond.`
            : "No supplier responded to this RFQ."
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {live.map((q) => (
        <SectionCard key={q.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{q.vendor.companyName}</span>
                <QuotationStatusBadge status={q.status} />
                {q.revision > 1 && (
                  <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Revision {q.revision}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {q.quotationNumber ?? "—"}
                {q.supplierReference && ` · their ref ${q.supplierReference}`}
                {q.submittedAt && ` · ${formatRelativeTime(q.submittedAt)}`}
              </p>
            </div>
            <div className="text-right">
              {q.sealed ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Lock size={13} /> Sealed until the deadline
                </span>
              ) : (
                <>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(q.totalAmount, q.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {q.deliveryDays}-day delivery · {q.paymentTerms ?? "terms not stated"}
                  </p>
                </>
              )}
            </div>
          </div>

          {!q.sealed && q.lineItems.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unit</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tax</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {q.lineItems.map((l) => (
                    <tr key={l.id} className={cn(l.isNoBid && "opacity-50")}>
                      <td className="px-3 py-2 text-sm text-foreground">
                        {l.itemName}
                        {l.isNoBid && <span className="ml-1.5 text-xs text-rose-600">no bid</span>}
                        {l.isAlternative && <span className="ml-1.5 text-xs text-amber-600">alternative</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">{l.quantity}</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">
                        {formatCurrency(l.unitPrice, q.currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
                        {formatCurrency(l.taxAmount, q.currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(l.lineTotal, q.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/20">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">Subtotal</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">{formatCurrency(q.subtotal, q.currency)}</td>
                  </tr>
                  {q.shippingAmount > 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">Shipping</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">{formatCurrency(q.shippingAmount, q.currency)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">Tax</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">{formatCurrency(q.taxAmount, q.currency)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold text-foreground">Total</td>
                    <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-foreground">{formatCurrency(q.totalAmount, q.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {q.notes && (
            <p className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm italic text-foreground">
              &ldquo;{q.notes}&rdquo;
            </p>
          )}
        </SectionCard>
      ))}

      {superseded.length > 0 && (
        <SectionCard title="Superseded revisions" description="Kept as evidence — §18. A later revision replaced each of these.">
          <div className="space-y-2">
            {superseded.map((q) => (
              <div key={q.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {q.vendor.companyName} · revision {q.revision}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {formatCurrency(q.totalAmount, q.currency)}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function ApprovalCard({ approval }: { approval: NonNullable<RfqDetail["approval"]> }) {
  return (
    <SectionCard title="Approval" description={approval.workflow?.name ?? "No workflow"}>
      <div className="space-y-3">
        {approval.steps.map((s) => (
          <div key={s.id} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                s.decision === "APPROVED"
                  ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : s.decision === "REJECTED"
                    ? "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                    : "border-border bg-muted text-muted-foreground"
              )}
            >
              {s.decision === "APPROVED" ? <Check size={12} /> : s.decision === "REJECTED" ? <X size={12} /> : s.sequence}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{s.stageRef?.name ?? prettyStatus(s.stage)}</p>
              <p className="text-xs text-muted-foreground">
                {s.approver.name}
                {s.delegatedTo && ` → ${s.delegatedTo.name}`}
                {s.decidedAt && ` · ${formatRelativeTime(s.decidedAt)}`}
              </p>
              {s.comment && <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{s.comment}&rdquo;</p>}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function Fact({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon size={13} />}
        {label}
      </dt>
      <dd className="truncate text-right text-foreground">{value}</dd>
    </div>
  );
}

function Monitor({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
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
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", colors[tone])}>{value}</p>
    </div>
  );
}

function Banner({
  tone,
  icon: Icon,
  title,
  body,
}: {
  tone: "rose" | "violet";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
}) {
  const cls =
    tone === "rose"
      ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400"
      : "border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400";
  return (
    <div className={cn("rounded-xl border px-5 py-4", cls)}>
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
    </div>
  );
}

function Action({
  label,
  icon: Icon,
  onClick,
  variant = "default",
  busy,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  variant?: "default" | "primary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-95",
        variant === "danger" &&
          "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400",
        variant === "default" && "border border-border bg-card hover:bg-muted"
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}
