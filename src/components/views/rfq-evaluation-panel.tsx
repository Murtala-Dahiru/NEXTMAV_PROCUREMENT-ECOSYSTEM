// NextMav Procure — the evaluation interface.
//
// Two audiences, one screen, and the difference between them is enforced by the
// server rather than by which tab is showing:
//
//   A panel member scores the bids they were appointed to judge, and sees the
//   aggregate result plus their own marks.
//
//   The chair — or anyone holding `rfqs.manageEvaluation` — additionally sees who
//   scored what. §30 keeps that from ordinary members on purpose: knowing a
//   colleague marked a supplier down turns a panel into a negotiation.
//
// The result table shows the arithmetic rather than asserting a number. Each
// criterion's contribution is listed, and they sum to the weighted total, so an
// award can be defended line by line instead of resting on a figure nobody can
// reproduce (§31).

"use client";

import { useMemo, useState } from "react";
import { Check, Gavel, Info, Loader2, Lock, Scale, TriangleAlert, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, SectionCard } from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import { prettyStatus, type EvaluationSummary, type RfqDetail } from "@/lib/sourcing";
import { cn } from "@/lib/utils";

export function EvaluationPanel({
  rfq,
  evaluation,
  loading,
  error,
  onChange,
}: {
  rfq: RfqDetail;
  evaluation: EvaluationSummary | null;
  loading: boolean;
  error: string | null;
  onChange: () => Promise<void>;
}) {
  const hasPermission = useStore((s) => s.hasPermission);
  const [scoring, setScoring] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const manualCriteria = useMemo(
    () => (evaluation?.criteria ?? []).filter((c) => !c.isAutomatic),
    [evaluation?.criteria]
  );

  if (loading && !evaluation) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-5 py-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!evaluation) return null;

  if (evaluation.sealed) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-5 py-4 dark:border-violet-900 dark:bg-violet-950/20">
        <div className="flex items-start gap-3">
          <Lock size={18} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
          <div>
            <p className="text-sm font-medium text-foreground">Sealed until the deadline</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Bids on this RFQ cannot be read or scored — by anyone — until the response period ends.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (rfq.criteria.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="No evaluation criteria defined"
        description={
          rfq.evaluationMethod === "LOWEST_PRICE"
            ? "This RFQ awards on lowest price. The arithmetic is the evaluation — there is nothing to score."
            : "Define the criteria before bids are scored, so the yardstick is fixed in advance."
        }
      />
    );
  }

  if (evaluation.results.length === 0) {
    return (
      <EmptyState
        icon={Gavel}
        title="No bids to evaluate"
        description="Quotations appear here for scoring once suppliers have submitted them."
      />
    );
  }

  const openScoring = (quotationId: string) => {
    const existing = evaluation.myScores.filter((s) => s.quotationId === quotationId);
    const seed: Record<string, number> = {};
    for (const c of manualCriteria) {
      seed[c.id] = existing.find((s) => s.criterionId === c.id)?.score ?? Math.round(c.maxScore / 2);
    }
    setDraft(seed);
    setNotes("");
    setScoring(quotationId);
  };

  const submitScores = async () => {
    if (!scoring) return;
    setSaving(true);
    const r = await mutate(
      () =>
        api.post(`/api/rfqs/${rfq.id}/quotations/${scoring}/evaluate`, {
          criterionScores: manualCriteria.map((c) => ({ criterionId: c.id, score: draft[c.id] ?? 0 })),
          evaluationNotes: notes.trim(),
        }),
      { success: "Scores recorded" }
    );
    setSaving(false);
    if (r) {
      setScoring(null);
      await onChange();
    }
  };

  const mySeat = evaluation.evaluators.find((e) => evaluation.isPanelMember && e.completedAt === null);
  const canScore = evaluation.isPanelMember && hasPermission("rfqs.evaluate");

  return (
    <div className="space-y-4">
      {/* Panel state */}
      <SectionCard
        title="Evaluation panel"
        description={`${prettyStatus(evaluation.method)} · ${evaluation.criteria.length} criteria`}
        action={
          canScore &&
          mySeat && (
            <button
              onClick={async () => {
                const r = await mutate(() => api.post(`/api/rfqs/${rfq.id}/evaluation/complete`, {}), {
                  success: "Your evaluation is marked complete",
                });
                if (r) await onChange();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Check size={13} /> Mark my scoring complete
            </button>
          )
        }
      >
        <div className="flex flex-wrap gap-3">
          {evaluation.evaluators.map((e) => (
            <div
              key={e.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2",
                e.completedAt
                  ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-border bg-muted/20"
              )}
            >
              <Avatar initials={e.user.initials} color={e.user.avatarColor} size="sm" />
              <div>
                <p className="text-sm text-foreground">{e.user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {prettyStatus(e.role)}
                  {e.isChair && " · Chair"}
                </p>
              </div>
              {e.completedAt && <Check size={14} className="text-emerald-500" />}
            </div>
          ))}
          {evaluation.evaluators.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No panel appointed. Anyone holding evaluation rights can score, but a named panel is what makes an award
              defensible.
            </p>
          )}
        </div>

        {!evaluation.isPanelMember && !evaluation.canSeeAll && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            You are not on this panel, so you can read the result but not score.
          </p>
        )}
      </SectionCard>

      {/* Results — the arithmetic, shown */}
      <SectionCard
        title="Result"
        description="Each criterion's contribution is its normalised score times its weight. They sum to the total."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Supplier
                </th>
                {evaluation.criteria.map((c) => (
                  <th
                    key={c.id}
                    className="px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    <span className="flex items-center justify-center gap-1">
                      {c.name}
                      {c.isAutomatic && <Gavel size={9} className="text-emerald-500" />}
                    </span>
                    <span className="block font-normal normal-case text-muted-foreground/70">{c.weight}%</span>
                  </th>
                ))}
                <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total
                </th>
                {canScore && <th className="px-3 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {evaluation.results.map((r) => (
                <tr key={r.quotationId} className={cn(r.rank === 1 && "bg-emerald-50/40 dark:bg-emerald-950/10")}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                          r.rank === 1 ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {r.rank}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.vendorName}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {formatCurrency(r.totalAmount, rfq.currency)}
                        </p>
                      </div>
                    </div>
                  </td>
                  {evaluation.criteria.map((c) => {
                    const cell = r.criteria.find((x) => x.criterionId === c.id);
                    return (
                      <td key={c.id} className="px-3 py-3.5 text-center">
                        {cell?.rawScore === null || cell === undefined ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <>
                            <p className="text-sm tabular-nums text-foreground">
                              {cell.rawScore?.toFixed(1)}
                              <span className="text-xs text-muted-foreground">/{c.maxScore}</span>
                            </p>
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              +{cell.contribution.toFixed(1)}
                            </p>
                            {cell.evaluatorCount > 1 && (
                              <p className="text-[10px] text-muted-foreground">avg of {cell.evaluatorCount}</p>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3.5 text-right">
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {r.weightedScore !== null ? r.weightedScore.toFixed(1) : "—"}
                    </p>
                    {r.completeness < 100 && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">{r.completeness}% scored</p>
                    )}
                  </td>
                  {canScore && (
                    <td className="px-3 py-3.5 text-right">
                      <button
                        onClick={() => openScoring(r.quotationId)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium transition-colors hover:bg-muted"
                      >
                        Score
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {evaluation.results.some((r) => r.completeness < 100) && (
          <p className="flex items-start gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
            Weights are re-normalised over the criteria scored so far, so a part-finished evaluation still compares
            like with like — but the totals will move as the rest is scored.
          </p>
        )}
      </SectionCard>

      {/* Per-evaluator detail — chair and evaluation managers only (§30). */}
      {evaluation.canSeeAll && evaluation.panelScores && evaluation.panelScores.length > 0 && (
        <SectionCard
          title="Panel scoring"
          description="Who scored what. Visible to the chair and to evaluation managers only."
        >
          <div className="space-y-4">
            {evaluation.panelScores.map((p) => (
              <div key={p.quotationId}>
                <p className="text-sm font-medium text-foreground">{p.vendorName}</p>
                <div className="mt-2 space-y-1.5">
                  {p.scores.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Not scored yet.</p>
                  ) : (
                    p.scores.map((s, i) => (
                      <div
                        key={`${s.criterionId}-${s.evaluatorId ?? i}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-foreground">{s.criterionName}</span>
                        <span className="tabular-nums text-foreground">{s.score}</span>
                        <span className="text-muted-foreground">
                          {s.scoredBy ?? "unknown"}
                          {s.evaluatorRole && ` · ${prettyStatus(s.evaluatorRole)}`}
                        </span>
                        <span className="text-muted-foreground">{formatRelativeTime(s.scoredAt)}</span>
                        {s.notes && <span className="w-full italic text-muted-foreground">&ldquo;{s.notes}&rdquo;</span>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Scoring drawer */}
      {scoring && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setScoring(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground">
              Score {evaluation.results.find((r) => r.quotationId === scoring)?.vendorName}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your scores are recorded against your own seat on the panel. Re-scoring keeps the previous value.
            </p>

            <div className="mt-4 space-y-4">
              {manualCriteria.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {c.name}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.weight}%</span>
                    </label>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {draft[c.id] ?? 0}
                      <span className="text-xs font-normal text-muted-foreground">/{c.maxScore}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={c.maxScore}
                    step={c.maxScore <= 10 ? 0.5 : 1}
                    value={draft[c.id] ?? 0}
                    onChange={(e) => setDraft({ ...draft, [c.id]: Number(e.target.value) })}
                    className="mt-2 w-full accent-emerald-600"
                  />
                  {c.description && <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>}
                </div>
              ))}

              {manualCriteria.length === 0 && (
                <p className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Every criterion on this RFQ is scored automatically from the bid. There is nothing for the panel to
                  mark.
                </p>
              )}

              <div>
                <label className="text-sm font-medium text-foreground">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="What justifies these marks?"
                  className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setScoring(null)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitScores()}
                disabled={saving || manualCriteria.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Record scores
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
