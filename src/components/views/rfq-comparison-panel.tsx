// NextMav Procure — the quotation comparison.
//
// §25 calls this one of the most important features of the phase, and §26 says
// why the obvious version of it is wrong: comparing headline totals tells you
// nothing if one supplier priced four lines and another priced six.
//
// So this table carries three things a naive comparison leaves out:
//
//   Coverage — what proportion of the RFQ each bid actually answered. A cheap bid
//   at 60% coverage is not cheap, and the column says so before the buyer reads
//   the number underneath it.
//
//   A per-line matrix — the RFQ line is the spine, each bid is a column, and a
//   supplier who did not price a line shows as a gap rather than as zero. Scoring
//   a missing line as free is how an automated comparison hands the award to the
//   least responsive bidder.
//
//   The split-award figure — what the same basket would cost taking every line
//   from whoever is cheapest on it. Often it beats the best single bid, and a
//   buyer cannot see that from totals alone.
//
// Every figure here is computed server-side. This component renders; it does not
// calculate.

"use client";

import { useState } from "react";
import { Award, Clock, Info, Loader2, Lock, Scale, TrendingDown, TriangleAlert } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/shared";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Comparison } from "@/lib/sourcing";
import { cn } from "@/lib/utils";

export function ComparisonPanel({
  comparison,
  loading,
  error,
  currency,
}: {
  comparison: Comparison | null;
  loading: boolean;
  error: string | null;
  currency: string;
}) {
  const [mode, setMode] = useState<"summary" | "lines">("summary");

  if (loading && !comparison) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <Lock size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-foreground">Comparison not available</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!comparison || comparison.rows.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Nothing to compare yet"
        description="Once suppliers submit quotations, they appear here side by side."
      />
    );
  }

  const { rows, lines, summary } = comparison;
  const splitSaves = (summary.splitAwardSaving ?? 0) > 0.5;

  return (
    <div className="space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bids received" value={`${summary.responded} of ${summary.invited}`} />
        <Stat
          label="Lowest bid"
          value={summary.lowestAmount !== null ? formatCurrency(summary.lowestAmount, currency) : "—"}
          tone="emerald"
        />
        <Stat
          label="Spread"
          value={summary.spread !== null ? formatCurrency(summary.spread, currency) : "—"}
          hint={
            summary.lowestAmount && summary.spread
              ? `${Math.round((summary.spread / summary.lowestAmount) * 100)}% between cheapest and dearest`
              : undefined
          }
        />
        <Stat
          label="Against estimate"
          value={
            summary.estimatedValue && summary.lowestAmount
              ? formatCurrency(summary.lowestAmount - summary.estimatedValue, currency)
              : "—"
          }
          tone={
            summary.estimatedValue && summary.lowestAmount
              ? summary.lowestAmount <= summary.estimatedValue
                ? "emerald"
                : "rose"
              : "neutral"
          }
          hint={summary.estimatedValue ? `Estimated ${formatCurrency(summary.estimatedValue, currency)}` : undefined}
        />
      </div>

      {splitSaves && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex items-start gap-3">
            <TrendingDown size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-foreground">A split award would be cheaper</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Taking each line from whoever is cheapest on it comes to{" "}
                <strong className="text-foreground">{formatCurrency(summary.splitAwardTotal ?? 0, currency)}</strong> —{" "}
                {formatCurrency(summary.splitAwardSaving ?? 0, currency)} below the best single bid. Check delivery and
                minimum-order terms before splitting.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        <ModeTab active={mode === "summary"} onClick={() => setMode("summary")} label="Bid summary" />
        <ModeTab active={mode === "lines"} onClick={() => setMode("lines")} label="Line by line" />
      </div>

      {mode === "summary" ? (
        <SectionCard
          title="Bid comparison"
          description="Ranked by the RFQ's own evaluation method. Coverage says how much of the tender each bid actually answered."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <Th>Supplier</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">vs lowest</Th>
                  <Th align="center">Coverage</Th>
                  <Th align="center">Delivery</Th>
                  <Th>Payment terms</Th>
                  <Th>Warranty</Th>
                  <Th align="center">Valid until</Th>
                  <Th align="center">Score</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.quotationId} className={cn("hover:bg-muted/20", r.rank === 1 && "bg-emerald-50/40 dark:bg-emerald-950/10")}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        {r.rank !== null && (
                          <span
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                              r.rank === 1
                                ? "bg-emerald-600 text-white"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {r.rank}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{r.vendorName}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {r.quotationNumber ?? "—"}
                            {r.revision > 1 && ` · rev ${r.revision}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.isLowest && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <Award size={10} /> LOWEST
                          </span>
                        )}
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(r.totalAmount, r.currency)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        net {formatCurrency(r.subtotal, r.currency)}
                        {r.shippingAmount > 0 && ` + ${formatCurrency(r.shippingAmount, r.currency)} carriage`}
                      </p>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      {r.isLowest ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <>
                          <p className="text-sm tabular-nums text-rose-600 dark:text-rose-400">
                            +{formatCurrency(r.varianceFromLowest, r.currency)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">+{r.variancePercent.toFixed(1)}%</p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="mx-auto w-[86px]">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className={cn(r.coverage < 100 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                            {r.linesQuoted}/{r.linesRequested}
                          </span>
                          <span className="text-muted-foreground">{r.coverage}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn("block h-full", r.coverage === 100 ? "bg-emerald-500" : "bg-amber-500")}
                            style={{ width: `${r.coverage}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {r.isFastest && (
                          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                            FASTEST
                          </span>
                        )}
                        <span className="text-sm tabular-nums text-foreground">{r.deliveryDays}d</span>
                      </div>
                    </td>
                    <td className="max-w-[130px] px-3 py-3.5 text-xs text-foreground">{r.paymentTerms ?? "—"}</td>
                    <td className="max-w-[150px] px-3 py-3.5 text-xs text-foreground">{r.warranty ?? "—"}</td>
                    <td className="px-3 py-3.5 text-center">
                      {r.validUntil ? (
                        <span
                          className={cn(
                            "text-xs",
                            r.isExpired ? "font-medium text-rose-600 dark:text-rose-400" : "text-foreground"
                          )}
                        >
                          {r.isExpired ? "Expired" : formatDate(r.validUntil)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {r.weightedScore !== null ? (
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {r.weightedScore.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not scored</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.some((r) => r.coverage < 100) && (
            <p className="flex items-start gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
              At least one bid did not price the whole tender. Totals are not comparable like for like — check the
              line-by-line view before drawing a conclusion.
            </p>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          title="Line by line"
          description="Normalised against the RFQ's own line items. A gap means the supplier did not price that line — it is not a zero."
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <Th>Requirement</Th>
                  {rows.map((r) => (
                    <th
                      key={r.quotationId}
                      className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {r.vendorName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => (
                  <tr key={l.rfqLineItemId} className="hover:bg-muted/20">
                    <td className="px-5 py-3.5 align-top">
                      <p className="text-sm font-medium text-foreground">{l.itemName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {l.quantity} {l.unit}
                        {l.targetPrice !== null && ` · target ${formatCurrency(l.targetPrice, currency)}`}
                      </p>
                    </td>
                    {rows.map((r) => {
                      const bid = l.bids.find((b) => b.quotationId === r.quotationId);
                      const isBest = l.bestVendorId === r.vendorId;
                      if (!bid || !bid.quoted) {
                        return (
                          <td key={r.quotationId} className="px-3 py-3.5 text-right align-top">
                            <span className="text-xs text-muted-foreground">
                              {bid?.isNoBid ? "No bid" : "Not quoted"}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={r.quotationId}
                          className={cn(
                            "px-3 py-3.5 text-right align-top",
                            isBest && "bg-emerald-50/50 dark:bg-emerald-950/15"
                          )}
                        >
                          <p className="text-sm font-medium tabular-nums text-foreground">
                            {formatCurrency(bid.lineTotal ?? 0, currency)}
                          </p>
                          <p className="text-[11px] tabular-nums text-muted-foreground">
                            {formatCurrency(bid.unitPrice ?? 0, currency)} / {bid.unit}
                          </p>
                          {/* Only surfaced when it differs — a supplier quoting a
                              pack size the buyer did not ask for is a real finding. */}
                          {bid.quantityMatches === false && (
                            <p className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              quoted {bid.quotedQuantity} {bid.unit}
                            </p>
                          )}
                          {bid.isAlternative && (
                            <p className="mt-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              alternative offered
                            </p>
                          )}
                          {bid.deliveryDays != null && (
                            <p className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                              <Clock size={9} /> {bid.deliveryDays}d
                            </p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/30">
                <tr>
                  <td className="px-5 py-3 text-sm font-semibold text-foreground">Total</td>
                  {rows.map((r) => (
                    <td key={r.quotationId} className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(r.totalAmount, r.currency)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-5 py-2 text-xs text-muted-foreground">Delivery</td>
                  {rows.map((r) => (
                    <td key={r.quotationId} className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {r.deliveryDays} days
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-5 py-2 text-xs text-muted-foreground">Validity</td>
                  {rows.map((r) => (
                    <td key={r.quotationId} className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {r.validUntil ? formatDate(r.validUntil) : "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="flex items-start gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            Highlighted cells are the cheapest bid on that line.
          </p>
        </SectionCard>
      )}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th
      className={cn(
        "px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:px-5",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left"
      )}
    >
      {children}
    </th>
  );
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "emerald" | "rose";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
          tone === "neutral" && "text-foreground"
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
