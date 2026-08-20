// NextMav Procure — award recommendation and approval.
//
// §32–§34. The screen deliberately separates the three acts that a single
// "Select winner" button used to collapse:
//
//   Recommending — a buyer proposes a supplier, with a reason, on the evidence of
//   the evaluation. The evaluation is frozen onto the recommendation at that
//   moment, so a later re-score cannot rewrite what the approver saw.
//
//   Approving — whoever the award workflow routes to decides. That is not always,
//   or usually, the person who recommended.
//
//   Awarding — happens automatically when the last approval stage clears. An
//   approved recommendation that has not been enacted is a state nobody watches.
//
// Where the organization has configured no award workflow the middle step is
// skipped and the audit trail says so — an unconfigured control is recorded as
// absent, not silently invented.

"use client";

import { useState } from "react";
import { Award, Check, FileText, Gavel, Info, Loader2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, SectionCard } from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { prettyStatus, type AwardRecommendation, type Comparison, type RfqDetail } from "@/lib/sourcing";
import { cn } from "@/lib/utils";

export function AwardPanel({
  rfq,
  comparison,
  onChange,
}: {
  rfq: RfqDetail;
  comparison: Comparison | null;
  onChange: () => Promise<void>;
}) {
  const hasPermission = useStore((s) => s.hasPermission);
  const [selected, setSelected] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const awarded = rfq.status === "AWARDED";
  const live = rfq.recommendations.find((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL");
  const approved = rfq.recommendations.find((r) => r.status === "APPROVED");
  const candidates = comparison?.rows ?? [];

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    const r = await mutate(fn, { success });
    setBusy(null);
    if (r) await onChange();
  };

  // ---------------------------------------------------------------------
  // Awarded — the outcome, and the trail behind it
  // ---------------------------------------------------------------------
  if (awarded && approved) {
    const winner = rfq.quotations.find((q) => q.id === rfq.selectedQuotationId);
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-5 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Award size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Awarded to {approved.vendor.companyName}
              </p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(approved.recommendedAmount, approved.currency)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {approved.type === "PARTIAL" ? "Partial award" : "Full award"}
                {rfq.awardedAt && ` · ${formatDate(rfq.awardedAt)}`}
                {winner && ` · ${winner.deliveryDays}-day delivery`}
              </p>
            </div>
          </div>
        </div>

        <SectionCard title="Why this supplier" description="The justification recorded at the time of the decision.">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{approved.justification}</p>
          <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Recommended by</dt>
              <dd className="text-foreground">{approved.recommendedBy?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Approved by</dt>
              <dd className="text-foreground">{approved.decidedBy?.name ?? "No approval workflow configured"}</dd>
            </div>
          </dl>
        </SectionCard>

        {/* §32 — the evaluation as it stood when the approver signed. */}
        <FrozenEvaluation recommendation={approved} currency={rfq.currency} />

        {rfq.purchaseOrders.length > 0 && (
          <SectionCard title="Purchase orders" description="Raised from this award.">
            <div className="space-y-2">
              {rfq.purchaseOrders.map((po) => (
                <div key={po.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <FileText size={14} className="text-muted-foreground" />
                  <span className="font-mono text-xs">{po.poNumber}</span>
                  <span className="text-xs text-muted-foreground">{prettyStatus(po.status)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    );
  }

  if (rfq.status === "NO_AWARD") {
    return (
      <EmptyState
        icon={X}
        title="Closed with no award"
        description="The round ran and none of the bids were taken. The quotations remain on record."
      />
    );
  }

  // ---------------------------------------------------------------------
  // A recommendation is in flight
  // ---------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {live && (
        <SectionCard
          title={live.status === "DRAFT" ? "Award recommendation — draft" : "Award recommendation — awaiting approval"}
          description={
            live.status === "DRAFT"
              ? "Not yet submitted. Send it into the approval chain when you are ready."
              : "With the approvers now. The award is written automatically once the last stage clears."
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{live.vendor.companyName}</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {formatCurrency(live.recommendedAmount, live.currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recommended by {live.recommendedBy?.name ?? "—"}
                {live.submittedAt && ` · submitted ${formatRelativeTime(live.submittedAt)}`}
              </p>
              <p className="mt-3 max-w-xl whitespace-pre-wrap text-sm text-foreground">{live.justification}</p>
            </div>

            <div className="flex shrink-0 flex-col gap-2">
              {live.status === "DRAFT" && hasPermission("rfqs.recommendAward") && (
                <button
                  onClick={() =>
                    run(
                      "submit",
                      () => api.post(`/api/rfqs/${rfq.id}/recommendations/${live.id}/submit`, {}),
                      "Sent for award approval"
                    )
                  }
                  disabled={busy === "submit"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy === "submit" ? <Loader2 size={14} className="animate-spin" /> : <Gavel size={14} />}
                  Submit for approval
                </button>
              )}
              {hasPermission("rfqs.recommendAward") && (
                <button
                  onClick={() =>
                    run(
                      "withdraw",
                      () =>
                        api.post(`/api/rfqs/${rfq.id}/recommendations/${live.id}/withdraw`, {
                          reason: "Withdrawn by the buyer",
                        }),
                      "Recommendation withdrawn"
                    )
                  }
                  disabled={busy === "withdraw"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Withdraw
                </button>
              )}
            </div>
          </div>

          <AwardApproval
            rfqId={rfq.id}
            recommendation={live}
            busy={busy}
            rejecting={rejecting}
            setRejecting={setRejecting}
            rejectReason={rejectReason}
            setRejectReason={setRejectReason}
            run={run}
          />
        </SectionCard>
      )}

      {rfq.recommendations.some((r) => r.status === "REJECTED") && (
        <SectionCard title="Previous recommendations" description="Kept on record — a rejection and what followed it both matter.">
          <div className="space-y-2">
            {rfq.recommendations
              .filter((r) => r.status === "REJECTED" || r.status === "WITHDRAWN")
              .map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{r.vendor.companyName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatCurrency(r.recommendedAmount, r.currency)}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                        r.status === "REJECTED"
                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                          : "border-border bg-card text-muted-foreground"
                      )}
                    >
                      {prettyStatus(r.status)}
                    </span>
                  </div>
                  {r.decisionReason && (
                    <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{r.decisionReason}&rdquo;</p>
                  )}
                </div>
              ))}
          </div>
        </SectionCard>
      )}

      {/* Raise a recommendation */}
      {!live && hasPermission("rfqs.recommendAward") && (
        <SectionCard
          title="Recommend an award"
          description="Pick the supplier the evaluation supports and say why. The evaluation is frozen onto the recommendation."
        >
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No bid is currently in contention. Close the response period and evaluate first.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                {candidates.map((c) => (
                  <button
                    key={c.quotationId}
                    onClick={() => setSelected(c.quotationId)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                      selected === c.quotationId
                        ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                        : "border-border bg-card hover:bg-muted/40"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
                        selected === c.quotationId ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
                      )}
                    >
                      {selected === c.quotationId && <Check size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{c.vendorName}</span>
                        {c.rank === 1 && (
                          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            HIGHEST SCORED
                          </span>
                        )}
                        {c.isLowest && (
                          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                            LOWEST PRICE
                          </span>
                        )}
                        {c.coverage < 100 && (
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            {c.coverage}% COVERAGE
                          </span>
                        )}
                        {c.isExpired && (
                          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                            EXPIRED
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {c.deliveryDays}-day delivery
                        {c.weightedScore !== null && ` · score ${c.weightedScore.toFixed(1)}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(c.totalAmount, c.currency)}
                    </span>
                  </button>
                ))}
              </div>

              {/* Naming the highest-scored bid keeps a departure from it deliberate
                  rather than accidental — and the justification field is where the
                  buyer has to account for it. */}
              {selected && candidates[0] && candidates[0].quotationId !== selected && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-muted-foreground">
                    This is not the highest-ranked bid ({candidates[0].vendorName}). Your justification should say why.
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-foreground">
                  Justification <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={4}
                  placeholder="Why this supplier, on the evidence of the evaluation…"
                  className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  At least 10 characters. This is the answer to &ldquo;why was this supplier selected?&rdquo; a year from now.
                </p>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() =>
                    run(
                      "recommend",
                      () =>
                        api.post(`/api/rfqs/${rfq.id}/recommendations`, {
                          quotationId: selected,
                          type: "FULL",
                          justification: justification.trim(),
                          submit: true,
                        }),
                      "Recommendation raised and sent for approval"
                    )
                  }
                  disabled={!selected || justification.trim().length < 10 || busy === "recommend"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "recommend" ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
                  Recommend and submit
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {!live && !hasPermission("rfqs.recommendAward") && (
        <EmptyState
          icon={ShieldCheck}
          title="No award recommendation yet"
          description="Someone with award-recommendation rights has to put a supplier forward before an award can be approved."
        />
      )}
    </div>
  );
}

/**
 * The award approval chain.
 *
 * Read from the recommendation the server already sent, rather than fetched here:
 * the previous version fired a request during the render phase, which React may
 * run twice and which was reading the RFQ's approval rather than this one's.
 */
function AwardApproval({
  rfqId,
  recommendation,
  busy,
  rejecting,
  setRejecting,
  rejectReason,
  setRejectReason,
  run,
}: {
  rfqId: string;
  recommendation: AwardRecommendation;
  busy: string | null;
  rejecting: string | null;
  setRejecting: (v: string | null) => void;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  run: (key: string, fn: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const hasPermission = useStore((s) => s.hasPermission);
  const approval = recommendation.approval;
  const myStepId = approval?.myStepId ?? null;

  if (!approval) return null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-xs font-medium text-foreground">
        {approval.workflow?.name ?? "Award approval"}
      </p>

      <div className="mt-2 space-y-2">
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
              {s.comment && <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{s.comment}&rdquo;</p>}
            </div>
          </div>
        ))}
      </div>

      {hasPermission("rfqs.approveAward") && myStepId && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() =>
                run(
                  "approve-award",
                  () =>
                    api.post(`/api/rfqs/${rfqId}/recommendations/${recommendation.id}/decide`, {
                      stepId: myStepId,
                      decision: "APPROVED",
                      comment: "",
                    }),
                  "Award approved"
                )
              }
              disabled={busy === "approve-award"}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === "approve-award" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Approve award
            </button>
            <button
              onClick={() => setRejecting(rejecting ? null : recommendation.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 text-sm font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400"
            >
              <X size={14} /> Decline
            </button>
          </div>

          {rejecting === recommendation.id && (
            <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                autoFocus
                placeholder="Why is this award not being approved?"
                className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRejecting(null)}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    run(
                      "reject-award",
                      () =>
                        api.post(`/api/rfqs/${rfqId}/recommendations/${recommendation.id}/decide`, {
                          stepId: myStepId,
                          decision: "REJECTED",
                          comment: rejectReason.trim(),
                        }),
                      "Award declined"
                    )
                  }
                  disabled={!rejectReason.trim()}
                  className="inline-flex h-8 items-center rounded-lg bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  Decline award
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {hasPermission("rfqs.approveAward") && !myStepId && (
        <p className="mt-3 text-xs text-muted-foreground">
          {approval.isComplete
            ? "Every stage has been decided."
            : "The outstanding stage is assigned to someone else."}
        </p>
      )}
    </div>
  );
}

function FrozenEvaluation({
  recommendation,
  currency,
}: {
  recommendation: AwardRecommendation;
  currency: string;
}) {
  const summary = recommendation.evaluationSummary;

  if (!summary?.rows?.length) return null;

  return (
    <SectionCard
      title="Evaluation as it stood"
      description={`Captured when the recommendation was raised${summary.capturedAt ? ` on ${formatDate(summary.capturedAt)}` : ""}. A later re-score cannot change this.`}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Supplier</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
              <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery</th>
              <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coverage</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.rows.map((r, i) => (
              <tr key={`${r.vendorName}-${i}`} className={cn(r.rank === 1 && "bg-emerald-50/40 dark:bg-emerald-950/10")}>
                <td className="px-5 py-2.5 text-sm text-foreground">
                  {r.rank !== null && <span className="mr-2 text-xs text-muted-foreground">#{r.rank}</span>}
                  {r.vendorName}
                </td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-foreground">
                  {formatCurrency(r.totalAmount, currency)}
                </td>
                <td className="px-3 py-2.5 text-center text-sm tabular-nums text-muted-foreground">{r.deliveryDays}d</td>
                <td className="px-3 py-2.5 text-center text-sm tabular-nums text-muted-foreground">{r.coverage}%</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-foreground">
                  {r.weightedScore !== null ? r.weightedScore.toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
