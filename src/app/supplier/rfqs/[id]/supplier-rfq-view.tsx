// NextMav Procure — the supplier's RFQ screen and quotation editor.
//
// §12 and §15: a supplier opens the tender, reads the requirement, asks a
// question if they need to, prices it over as many sittings as they like, and
// submits when ready. The draft is theirs — invisible to the buyer, allowed to be
// incomplete, and it survives them closing the tab.
//
// Everything on this page comes from /api/supplier/*, which never returns another
// bidder's data, the buyer's budget, an evaluation score or an internal note. The
// countdown is server-computed for the same reason the deadline is server-
// enforced: a clock the browser owns is not a control.
//
// The running total is computed client-side for feedback while typing, and then
// discarded — what is stored is what the server recomputes from the same lines.
// The two agree because they use the same arithmetic (see quotation-math.ts), but
// the server's answer is the one that counts.

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  MessageSquare,
  Save,
  Send,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface SupplierLine {
  id: string;
  itemName: string;
  description: string | null;
  specification: string | null;
  quantity: number;
  unit: string;
  requiredDeliveryDate: string | null;
  notes: string | null;
  targetPrice: number | null;
  sortOrder: number;
}

interface SupplierRfq {
  id: string;
  rfqNumber: string;
  referenceNumber: string | null;
  title: string;
  description: string | null;
  status: string;
  currency: string;
  deadline: string;
  questionDeadline: string | null;
  requiredDeliveryDate: string | null;
  deliveryTerms: string | null;
  deliveryAddress: string | null;
  termsAndConditions: string | null;
  isSealed: boolean;
  buyer: { name: string; country: string | null };
  lineItems: SupplierLine[];
  myInvitation: {
    status: string;
    declineReason: string | null;
    revisionInvited: boolean;
    revisionReason: string | null;
  };
  isOpen: boolean;
  secondsRemaining: number;
  canRespond: boolean;
  cannotRespondReason: string | null;
  canAskQuestions: boolean;
  myQuotation: MyQuotation | null;
  clarifications: {
    id: string;
    question: string;
    answer: string | null;
    status: string;
    visibility: string;
    createdAt: string;
    answeredAt: string | null;
    isMine: boolean;
  }[];
}

interface MyQuotation {
  id: string;
  quotationNumber: string | null;
  revision: number;
  status: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  deliveryDays: number;
  warranty: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  validityDays: number | null;
  supplierReference: string | null;
  notes: string | null;
  submittedAt: string | null;
  lineItems: {
    id: string;
    rfqLineItemId: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountPercent: number;
    taxRate: number;
    deliveryCost: number;
    deliveryDays: number | null;
    isNoBid: boolean;
    notes: string | null;
  }[];
  history: { id: string; revision: number; status: string; totalAmount: number | null; submittedAt: string | null }[];
}

interface LineDraft {
  rfqLineItemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  deliveryCost: string;
  deliveryDays: string;
  isNoBid: boolean;
  notes: string;
}

interface FormState {
  lines: LineDraft[];
  deliveryDays: string;
  warranty: string;
  paymentTerms: string;
  validityDays: string;
  supplierReference: string;
  notes: string;
  shippingAmount: string;
  discountAmount: string;
}

const EMPTY_FORM: FormState = {
  lines: [],
  deliveryDays: "",
  warranty: "",
  paymentTerms: "",
  validityDays: "60",
  supplierReference: "",
  notes: "",
  shippingAmount: "",
  discountAmount: "",
};

/** Builds the editor's starting state from the RFQ and whatever was saved before. */
function seedForm(rfq: SupplierRfq): FormState {
  const q = rfq.myQuotation;
  return {
    lines: rfq.lineItems.map((l) => {
      const existing = q?.lineItems.find((x) => x.rfqLineItemId === l.id);
      return {
        rfqLineItemId: l.id,
        itemName: l.itemName,
        // The requested quantity is the default, but a supplier may quote a
        // different one — a pack size, say — and the comparison flags the
        // difference rather than silently correcting it.
        quantity: existing?.quantity ?? l.quantity,
        unit: existing?.unit ?? l.unit,
        unitPrice: existing ? String(existing.unitPrice) : "",
        discountPercent: existing ? String(existing.discountPercent) : "0",
        taxRate: existing ? String(existing.taxRate) : "0",
        deliveryCost: existing ? String(existing.deliveryCost) : "0",
        deliveryDays: existing?.deliveryDays != null ? String(existing.deliveryDays) : "",
        isNoBid: existing?.isNoBid ?? false,
        notes: existing?.notes ?? "",
      };
    }),
    deliveryDays: q ? String(q.deliveryDays ?? "") : "",
    warranty: q?.warranty ?? "",
    paymentTerms: q?.paymentTerms ?? "",
    validityDays: q?.validityDays ? String(q.validityDays) : "60",
    supplierReference: q?.supplierReference ?? "",
    notes: q?.notes ?? "",
    shippingAmount: q?.shippingAmount ? String(q.shippingAmount) : "",
    discountAmount: q?.discountAmount ? String(q.discountAmount) : "",
  };
}

const num = (v: string) => (v === "" ? 0 : Number(v) || 0);
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function SupplierRfqView({ rfqId }: { rfqId: string }) {
  const fetchRfq = useCallback(() => api.get<SupplierRfq>(`/api/supplier/rfqs/${rfqId}`), [rfqId]);
  const { data: rfq, error, loading, reload } = useServerData(fetchRfq, "Could not load this RFQ.");

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [seedKey, setSeedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  // Seeding the editor from server data is derived state, not a side effect, so
  // it happens during render rather than in an effect. React throws away the
  // in-progress render and immediately re-renders with the new state: no extra
  // commit, no flash of an empty form, and no cascading render.
  //
  // The key carries the quotation's id and status, so the editor re-seeds when a
  // submission or a withdrawal changes what the supplier is working on, and holds
  // still through every other refresh. Typing is never overwritten underneath them.
  const currentSeed = rfq
    ? `${rfq.id}:${rfq.myQuotation?.id ?? "none"}:${rfq.myQuotation?.status ?? "none"}`
    : null;
  if (rfq && currentSeed !== seedKey) {
    setSeedKey(currentSeed);
    setForm(seedForm(rfq));
  }

  const {
    lines,
    deliveryDays,
    warranty,
    paymentTerms,
    validityDays,
    supplierReference,
    notes,
    shippingAmount,
    discountAmount,
  } = form;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setLines = (next: LineDraft[]) => setForm((f) => ({ ...f, lines: next }));

  // Mirrors costQuotation on the server, so the figure the supplier watches while
  // typing is the figure that will be stored.
  const totals = useMemo(() => {
    let net = 0;
    let tax = 0;
    let carriage = 0;
    for (const l of lines) {
      if (l.isNoBid) continue;
      const gross = round4(l.quantity * num(l.unitPrice));
      const disc = round4(gross * (num(l.discountPercent) / 100));
      const lineNet = round4(gross - disc);
      net += lineNet;
      tax += round4(lineNet * (num(l.taxRate) / 100));
      carriage += round4(num(l.deliveryCost));
    }
    const shipping = round4(num(shippingAmount));
    const headerDiscount = round4(num(discountAmount));
    return {
      subtotal: round4(net),
      taxAmount: round4(tax),
      shippingAmount: round4(carriage + shipping),
      total: Math.max(0, round4(net + tax + carriage + shipping - headerDiscount)),
    };
  }, [lines, shippingAmount, discountAmount]);

  if (loading && !rfq) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !rfq) {
    return (
      <div className="space-y-4">
        <Link href="/supplier" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to invitations
        </Link>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">{error ?? "This RFQ is not available to you."}</p>
        </div>
      </div>
    );
  }

  const q = rfq.myQuotation;
  const isSubmitted = q !== null && q.status !== "DRAFT" && q.status !== "WITHDRAWN";
  const locked = isSubmitted && !rfq.myInvitation.revisionInvited;
  const days = Math.floor(rfq.secondsRemaining / 86400);
  const hours = Math.floor(rfq.secondsRemaining / 3600);

  const payload = () => ({
    deliveryDays: num(deliveryDays),
    warranty: warranty.trim(),
    paymentTerms: paymentTerms.trim(),
    validityDays: num(validityDays) || undefined,
    supplierReference: supplierReference.trim() || undefined,
    notes: notes.trim(),
    discountAmount: num(discountAmount),
    shippingAmount: num(shippingAmount),
    lineItems: lines.map((l) => ({
      rfqLineItemId: l.rfqLineItemId,
      itemName: l.itemName,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: num(l.unitPrice),
      discountPercent: num(l.discountPercent),
      taxRate: num(l.taxRate),
      deliveryCost: num(l.deliveryCost),
      deliveryDays: l.deliveryDays === "" ? undefined : num(l.deliveryDays),
      isNoBid: l.isNoBid,
      notes: l.notes.trim(),
    })),
  });

  const saveDraft = async () => {
    setBusy("save");
    const r = await mutate(() => api.put(`/api/supplier/rfqs/${rfqId}/quotation`, payload()), {
      success: "Draft saved. You can come back to it any time.",
    });
    setBusy(null);
    if (r) await reload();
  };

  const submit = async () => {
    setBusy("submit");
    const r = await mutate(() => api.post(`/api/supplier/rfqs/${rfqId}/quotation`, payload()), {
      success: "Quotation submitted",
    });
    setBusy(null);
    if (r) {
      await reload();
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    const r = await mutate(fn, { success });
    setBusy(null);
    if (r) {
      await reload();
    }
  };

  const update = (id: string, patch: Partial<LineDraft>) =>
    setLines(lines.map((l) => (l.rfqLineItemId === id ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-6">
      <Link href="/supplier" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} /> Back to invitations
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">
              {rfq.rfqNumber}
              {rfq.referenceNumber && ` · ${rfq.referenceNumber}`}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{rfq.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Issued by {rfq.buyer.name}
              {rfq.buyer.country && ` · ${rfq.buyer.country}`}
            </p>
          </div>

          <div
            className={cn(
              "shrink-0 rounded-lg border px-4 py-3 text-right",
              rfq.isOpen && rfq.secondsRemaining < 2 * 86400
                ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/20"
                : rfq.isOpen
                  ? "border-border bg-muted/30"
                  : "border-border bg-muted/30"
            )}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {rfq.isOpen ? "Time remaining" : "Closed"}
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
              {rfq.isOpen ? (days >= 2 ? `${days} days` : `${hours} hours`) : formatDate(rfq.deadline)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {rfq.isOpen ? `closes ${formatDate(rfq.deadline)}` : "no longer accepting quotations"}
            </p>
          </div>
        </div>
      </div>

      {/* State banners */}
      {rfq.isSealed && (
        <Notice tone="violet" icon={Lock} title="Sealed tender">
          Your bid stays unreadable — to the buyer as well — until the deadline passes.
        </Notice>
      )}
      {isSubmitted && !rfq.myInvitation.revisionInvited && (
        <Notice tone="emerald" icon={CheckCircle2} title="Your quotation has been submitted">
          {q?.quotationNumber} · {formatCurrency(q!.totalAmount, q!.currency)}
          {q?.submittedAt && ` · ${formatRelativeTime(q.submittedAt)}`}. It cannot be changed unless the buyer invites a
          revision.
        </Notice>
      )}
      {rfq.myInvitation.revisionInvited && (
        <Notice tone="amber" icon={TriangleAlert} title="The buyer has invited a revision">
          {rfq.myInvitation.revisionReason ?? "You may submit an updated quotation."}
        </Notice>
      )}
      {rfq.myInvitation.status === "DECLINED" && (
        <Notice tone="rose" icon={X} title="You declined this invitation">
          {rfq.myInvitation.declineReason ?? ""}
        </Notice>
      )}
      {!rfq.canRespond && rfq.cannotRespondReason && rfq.myInvitation.status !== "DECLINED" && !isSubmitted && (
        <Notice tone="rose" icon={Lock} title="This RFQ is not accepting quotations">
          {rfq.cannotRespondReason}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Requirement */}
          <Card title="What is being sourced">
            {rfq.description && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{rfq.description}</p>
            )}
            <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
              {rfq.requiredDeliveryDate && (
                <Fact label="Required delivery" value={formatDate(rfq.requiredDeliveryDate)} />
              )}
              {rfq.deliveryTerms && <Fact label="Delivery terms" value={rfq.deliveryTerms} />}
              {rfq.deliveryAddress && <Fact label="Deliver to" value={rfq.deliveryAddress} />}
              <Fact label="Currency" value={rfq.currency} />
            </dl>
          </Card>

          {rfq.termsAndConditions && (
            <Card title="Terms and conditions">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{rfq.termsAndConditions}</p>
            </Card>
          )}

          {/* The editor */}
          <Card
            title="Your quotation"
            description={
              locked
                ? "Submitted and locked. Ask the buyer to invite a revision if something has to change."
                : "Price every line, or mark it as a no-bid. Totals are computed for you."
            }
          >
            <div className="space-y-3">
              {lines.map((l, i) => {
                const spec = rfq.lineItems.find((x) => x.id === l.rfqLineItemId);
                const gross = round4(l.quantity * num(l.unitPrice));
                const disc = round4(gross * (num(l.discountPercent) / 100));
                const lineNet = round4(gross - disc);
                const lineTotal = l.isNoBid
                  ? 0
                  : round4(lineNet + lineNet * (num(l.taxRate) / 100) + num(l.deliveryCost));

                return (
                  <div
                    key={l.rfqLineItemId}
                    className={cn(
                      "rounded-lg border p-4 transition-colors",
                      l.isNoBid ? "border-border bg-muted/40 opacity-70" : "border-border bg-muted/20"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {i + 1}. {l.itemName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {spec?.quantity} {spec?.unit} required
                          {spec?.requiredDeliveryDate && ` · by ${formatDate(spec.requiredDeliveryDate)}`}
                          {spec?.targetPrice != null && ` · target ${formatCurrency(spec.targetPrice, rfq.currency)}`}
                        </p>
                        {spec?.description && <p className="mt-1 text-xs text-muted-foreground">{spec.description}</p>}
                        {spec?.specification && (
                          <p className="mt-1.5 rounded border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground">
                            {spec.specification}
                          </p>
                        )}
                      </div>
                      {!locked && (
                        <button
                          onClick={() => update(l.rfqLineItemId, { isNoBid: !l.isNoBid })}
                          className={cn(
                            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                            l.isNoBid
                              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
                              : "border-border bg-card text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {l.isNoBid ? "No bid" : "Mark no-bid"}
                        </button>
                      )}
                    </div>

                    {!l.isNoBid && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-6">
                        <Field label="Quantity">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            disabled={locked}
                            value={l.quantity}
                            onChange={(e) => update(l.rfqLineItemId, { quantity: Number(e.target.value) })}
                            className={fieldCls}
                          />
                        </Field>
                        <Field label={`Unit price (${rfq.currency})`}>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            disabled={locked}
                            value={l.unitPrice}
                            onChange={(e) => update(l.rfqLineItemId, { unitPrice: e.target.value })}
                            className={fieldCls}
                          />
                        </Field>
                        <Field label="Discount %">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={100}
                            disabled={locked}
                            value={l.discountPercent}
                            onChange={(e) => update(l.rfqLineItemId, { discountPercent: e.target.value })}
                            className={fieldCls}
                          />
                        </Field>
                        <Field label="Tax %">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={100}
                            disabled={locked}
                            value={l.taxRate}
                            onChange={(e) => update(l.rfqLineItemId, { taxRate: e.target.value })}
                            className={fieldCls}
                          />
                        </Field>
                        <Field label="Carriage">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            disabled={locked}
                            value={l.deliveryCost}
                            onChange={(e) => update(l.rfqLineItemId, { deliveryCost: e.target.value })}
                            className={fieldCls}
                          />
                        </Field>
                        <Field label="Lead days">
                          <input
                            type="number"
                            min={0}
                            disabled={locked}
                            value={l.deliveryDays}
                            onChange={(e) => update(l.rfqLineItemId, { deliveryDays: e.target.value })}
                            className={fieldCls}
                          />
                        </Field>
                        <div className="sm:col-span-6 flex items-center justify-between border-t border-border pt-2">
                          <input
                            disabled={locked}
                            value={l.notes}
                            onChange={(e) => update(l.rfqLineItemId, { notes: e.target.value })}
                            placeholder="Note on this line (optional)"
                            className="h-8 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                          />
                          <span className="ml-3 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                            {formatCurrency(lineTotal, rfq.currency)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Commercial terms */}
            <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
              <Field label="Overall delivery lead time (days)">
                <input
                  type="number"
                  min={0}
                  disabled={locked}
                  value={deliveryDays}
                  onChange={(e) => setField("deliveryDays", e.target.value)}
                  className={fieldCls}
                />
              </Field>
              <Field label="Quotation valid for (days)">
                <input
                  type="number"
                  min={1}
                  disabled={locked}
                  value={validityDays}
                  onChange={(e) => setField("validityDays", e.target.value)}
                  className={fieldCls}
                />
              </Field>
              <Field label="Payment terms">
                <input
                  disabled={locked}
                  value={paymentTerms}
                  onChange={(e) => setField("paymentTerms", e.target.value)}
                  placeholder="e.g. NET 30"
                  className={fieldCls}
                />
              </Field>
              <Field label="Warranty">
                <input
                  disabled={locked}
                  value={warranty}
                  onChange={(e) => setField("warranty", e.target.value)}
                  placeholder="e.g. 24 months return to base"
                  className={fieldCls}
                />
              </Field>
              <Field label="Shipping / handling">
                <input
                  type="number"
                  step="any"
                  min={0}
                  disabled={locked}
                  value={shippingAmount}
                  onChange={(e) => setField("shippingAmount", e.target.value)}
                  className={fieldCls}
                />
              </Field>
              <Field label="Settlement discount">
                <input
                  type="number"
                  step="any"
                  min={0}
                  disabled={locked}
                  value={discountAmount}
                  onChange={(e) => setField("discountAmount", e.target.value)}
                  className={fieldCls}
                />
              </Field>
              <Field label="Your reference">
                <input
                  disabled={locked}
                  value={supplierReference}
                  onChange={(e) => setField("supplierReference", e.target.value)}
                  placeholder="Your own quotation number"
                  className={fieldCls}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes to the buyer">
                  <textarea
                    disabled={locked}
                    value={notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    rows={3}
                    placeholder="Anything the buyer should know about this quotation…"
                    className="mt-1 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                </Field>
              </div>
            </div>
          </Card>

          {/* Questions */}
          <Card
            title="Questions"
            description="Your questions go to the buyer privately. If the answer affects everyone, they may publish it to all bidders."
          >
            {rfq.clarifications.length === 0 && (
              <p className="text-sm text-muted-foreground">No questions asked yet.</p>
            )}
            <div className="space-y-3">
              {rfq.clarifications.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {c.isMine ? "Your question" : "Notice to all bidders"}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-foreground">{c.question}</p>
                  {c.answer ? (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Buyer&apos;s answer</p>
                      <p className="mt-0.5 text-sm text-foreground">{c.answer}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs italic text-muted-foreground">Awaiting an answer.</p>
                  )}
                </div>
              ))}
            </div>

            {rfq.canAskQuestions && (
              <div className="mt-4 flex gap-2 border-t border-border pt-4">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask the buyer a question…"
                  className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() =>
                    act(
                      "ask",
                      () => api.post(`/api/supplier/rfqs/${rfqId}/clarifications`, { question: question.trim() }),
                      "Question sent to the buyer"
                    ).then(() => setQuestion(""))
                  }
                  disabled={question.trim().length < 5 || busy === "ask"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy === "ask" ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                  Ask
                </button>
              </div>
            )}
            {!rfq.canAskQuestions && rfq.questionDeadline && (
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                Questions closed on {formatDate(rfq.questionDeadline)}.
              </p>
            )}
          </Card>
        </div>

        {/* Summary rail */}
        <div className="space-y-4">
          <div className="sticky top-20 space-y-4">
            <Card title="Your total">
              <dl className="space-y-2 text-sm">
                <Money label="Net" value={totals.subtotal} currency={rfq.currency} />
                <Money label="Tax" value={totals.taxAmount} currency={rfq.currency} />
                <Money label="Shipping" value={totals.shippingAmount} currency={rfq.currency} />
                {num(discountAmount) > 0 && (
                  <Money label="Discount" value={-num(discountAmount)} currency={rfq.currency} />
                )}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <dt className="text-sm font-semibold text-foreground">Total</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">
                    {formatCurrency(totals.total, rfq.currency)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Computed from your line prices. The buyer sees the same figure — no total is typed in by hand.
              </p>
            </Card>

            {!locked && rfq.canRespond && (
              <div className="space-y-2">
                <button
                  onClick={() => void saveDraft()}
                  disabled={busy !== null}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  Save draft
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy !== null || totals.total <= 0}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  {busy === "submit" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Submit quotation
                </button>
                <p className="text-center text-xs text-muted-foreground">
                  A draft is private to you. Submitting makes it visible to the buyer.
                </p>
              </div>
            )}

            {rfq.canRespond && rfq.myInvitation.status !== "QUOTED" && !isSubmitted && (
              <Card title="Not quoting?">
                {declining ? (
                  <div className="space-y-2">
                    <textarea
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      rows={3}
                      placeholder="Tell the buyer why — it helps them source better next time."
                      className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDeclining(false)}
                        className="inline-flex h-8 flex-1 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          act(
                            "decline",
                            () =>
                              api.post(`/api/supplier/rfqs/${rfqId}/decline`, { reason: declineReason.trim() }),
                            "Invitation declined"
                          )
                        }
                        disabled={!declineReason.trim() || busy === "decline"}
                        className="inline-flex h-8 flex-1 items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeclining(true)}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <X size={14} /> Decline this invitation
                  </button>
                )}
              </Card>
            )}

            {isSubmitted && rfq.isOpen && (
              <Card title="Withdraw">
                <p className="text-xs text-muted-foreground">
                  You can withdraw while the RFQ is still open. Once it closes, your bid is part of a competition being
                  decided and cannot be pulled.
                </p>
                <button
                  onClick={() =>
                    act(
                      "withdraw",
                      () =>
                        api.post(`/api/supplier/rfqs/${rfqId}/quotation/withdraw`, {
                          reason: "Withdrawn by the supplier",
                        }),
                      "Quotation withdrawn"
                    )
                  }
                  disabled={busy === "withdraw"}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 text-sm font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400"
                >
                  Withdraw quotation
                </button>
              </Card>
            )}

            {q && q.history.length > 1 && (
              <Card title="Your revisions">
                <div className="space-y-2">
                  {q.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        Revision {h.revision} · {h.status.toLowerCase()}
                      </span>
                      <span className="tabular-nums text-foreground">
                        {h.totalAmount !== null ? formatCurrency(h.totalAmount, q.currency) : "draft"}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-start gap-2.5">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Your prices are visible only to the buying organization. No other supplier can see your quotation, and
                  you cannot see theirs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldCls =
  "mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      {title && (
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Money({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">{formatCurrency(value, currency)}</dd>
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "emerald" | "amber" | "rose" | "violet";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  const cls = {
    emerald: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400",
    amber: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400",
    rose: "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400",
    violet: "border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400",
  }[tone];

  return (
    <div className={cn("rounded-xl border px-5 py-4", cls)}>
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
        </div>
      </div>
    </div>
  );
}
