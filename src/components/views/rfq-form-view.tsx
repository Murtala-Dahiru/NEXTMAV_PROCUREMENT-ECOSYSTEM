// NextMav Procure — the RFQ builder.
//
// The old version of this screen was a single form that issued an RFQ to
// suppliers the moment it was submitted. That is not how sourcing works: the
// requirement, the specification, the yardstick and the invitation list are
// assembled over time, reviewed, and only then published.
//
// So this builds a *draft*. Nothing leaves the building until it has been through
// approval and someone has pressed publish on the detail page. The four steps
// mirror the four decisions a buyer actually makes:
//
//   Requirement — what are we buying, by when, on whose authority
//   Line items  — the exact things suppliers will price
//   Evaluation  — how the bids will be judged, fixed before any arrive (§27)
//   Suppliers   — who is invited, from the eligible list only (§8, Rule 5)

"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  ClipboardList,
  FileText,
  Gavel,
  Info,
  Loader2,
  Plus,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, PageHeader, SectionCard, VendorComplianceBadge, VendorRiskBadge } from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCurrency, formatDate } from "@/lib/format";
import type { CriterionType, EligibleSupplier, EvaluationMethod, RfqDetail } from "@/lib/sourcing";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DraftLine {
  key: string;
  itemName: string;
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  targetPrice: string;
  notes: string;
  requestLineItemId?: string;
}

interface DraftCriterion {
  key: string;
  name: string;
  type: CriterionType;
  weight: number;
  maxScore: number;
  lowerIsBetter: boolean;
  isAutomatic: boolean;
}

const STEPS = [
  { key: "requirement", label: "Requirement", icon: FileText },
  { key: "lines", label: "Line Items", icon: ClipboardList },
  { key: "evaluation", label: "Evaluation", icon: Scale },
  { key: "suppliers", label: "Suppliers", icon: Users },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const newKey = () => Math.random().toString(36).slice(2, 10);

const emptyLine = (): DraftLine => ({
  key: newKey(),
  itemName: "",
  description: "",
  specification: "",
  quantity: 1,
  unit: "unit",
  targetPrice: "",
  notes: "",
});

/**
 * A starting criterion set that reflects what most organizations actually weigh.
 * Price and delivery are marked automatic — the system knows both from the bid,
 * and asking a human to score them invites inconsistency for no gain.
 */
const DEFAULT_CRITERIA = (): DraftCriterion[] => [
  { key: newKey(), name: "Price", type: "PRICE", weight: 40, maxScore: 10, lowerIsBetter: true, isAutomatic: true },
  { key: newKey(), name: "Technical Compliance", type: "TECHNICAL", weight: 25, maxScore: 10, lowerIsBetter: false, isAutomatic: false },
  { key: newKey(), name: "Delivery", type: "DELIVERY", weight: 15, maxScore: 10, lowerIsBetter: true, isAutomatic: true },
  { key: newKey(), name: "Experience", type: "EXPERIENCE", weight: 10, maxScore: 10, lowerIsBetter: false, isAutomatic: false },
  { key: newKey(), name: "Warranty", type: "WARRANTY", weight: 10, maxScore: 10, lowerIsBetter: false, isAutomatic: false },
];

export function RfqFormView() {
  const navigate = useStore((s) => s.navigate);
  const selectRfq = useStore((s) => s.selectRfq);
  const requests = useStore((s) => s.requests);
  const organization = useStore((s) => s.organization);

  const [step, setStep] = useState<StepKey>("requirement");
  const [saving, setSaving] = useState(false);

  // Requirement
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [requestId, setRequestId] = useState("");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [questionDeadline, setQuestionDeadline] = useState("");
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [currency, setCurrency] = useState<string>(organization?.currency ?? "USD");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [isSealed, setIsSealed] = useState(false);
  const [showTargetPrice, setShowTargetPrice] = useState(false);
  const [allowSupplierRevision, setAllowSupplierRevision] = useState(false);
  const [evaluationMethod, setEvaluationMethod] = useState<EvaluationMethod>("WEIGHTED_SCORE");

  // Line items and criteria
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [criteria, setCriteria] = useState<DraftCriterion[]>(DEFAULT_CRITERIA());

  // Suppliers
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [compliantOnly, setCompliantOnly] = useState(false);
  const [existingOnly, setExistingOnly] = useState(false);
  const [maxRisk, setMaxRisk] = useState("ALL");

  const approvedRequests = useMemo(
    () => requests.filter((r) => r.status === "APPROVED" || r.status === "IN_PROCUREMENT"),
    [requests]
  );

  const fetchSuppliers = useCallback(
    () =>
      api.get<EligibleSupplier[]>("/api/rfqs/eligible-suppliers", {
        search: supplierSearch || undefined,
        compliantOnly: compliantOnly || undefined,
        existingOnly: existingOnly || undefined,
        maxRisk: maxRisk === "ALL" ? undefined : maxRisk,
        limit: 100,
      }),
    [supplierSearch, compliantOnly, existingOnly, maxRisk]
  );
  const suppliers = useServerData(fetchSuppliers, "Could not load the supplier list.");

  /** Pulls the line items across from an approved request, so nothing is re-keyed. */
  const adoptRequest = (id: string) => {
    setRequestId(id);
    const request = requests.find((r) => r.id === id);
    if (!request) return;
    if (!title.trim()) setTitle(request.title);
    if (request.lineItems.length > 0) {
      setLines(
        request.lineItems.map((li) => ({
          key: newKey(),
          itemName: li.itemName,
          description: li.description ?? "",
          specification: "",
          quantity: li.quantity,
          unit: li.unit,
          targetPrice: String(li.estimatedCost ?? ""),
          notes: "",
          requestLineItemId: li.id,
        }))
      );
      toast.success(`${request.lineItems.length} line item(s) brought across from ${request.requestNumber}`);
    }
  };

  const weightTotal = useMemo(
    () => Math.round(criteria.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0) * 100) / 100,
    [criteria]
  );
  const weightsValid = evaluationMethod === "LOWEST_PRICE" || Math.abs(weightTotal - 100) < 0.01;

  const estimatedFromLines = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.targetPrice) || 0) * (l.quantity || 0), 0),
    [lines]
  );

  const problems = useMemo(() => {
    const out: string[] = [];
    if (title.trim().length < 3) out.push("Give the RFQ a title of at least 3 characters");
    if (!deadline) out.push("Set a response deadline");
    else if (new Date(deadline).getTime() <= Date.now()) out.push("The response deadline must be in the future");
    if (lines.length === 0 || lines.some((l) => !l.itemName.trim()))
      out.push("Every line item needs a name");
    if (lines.some((l) => !(l.quantity > 0))) out.push("Every line item needs a quantity above zero");
    if (!weightsValid) out.push(`Evaluation weights total ${weightTotal}% — they must total 100%`);
    if (selectedVendorIds.length === 0) out.push("Invite at least one supplier");
    return out;
  }, [title, deadline, lines, weightsValid, weightTotal, selectedVendorIds.length]);

  const save = async () => {
    if (problems.length > 0) {
      toast.error("Not ready yet", { description: problems[0] });
      return;
    }
    setSaving(true);
    const created = await mutate(
      () =>
        api.post<RfqDetail>("/api/rfqs", {
          title: title.trim(),
          description: description.trim(),
          referenceNumber: referenceNumber.trim() || undefined,
          requestId: requestId || undefined,
          deadline: new Date(`${deadline}T23:59:59`).toISOString(),
          questionDeadline: questionDeadline ? new Date(`${questionDeadline}T23:59:59`).toISOString() : undefined,
          requiredDeliveryDate: requiredDeliveryDate ? new Date(requiredDeliveryDate).toISOString() : undefined,
          deliveryTerms: deliveryTerms.trim() || undefined,
          deliveryAddress: deliveryAddress.trim() || undefined,
          termsAndConditions: termsAndConditions.trim() || undefined,
          currency,
          estimatedValue: Number(estimatedValue) || estimatedFromLines || undefined,
          showTargetPrice,
          isSealed,
          allowSupplierRevision,
          evaluationMethod,
          invitedVendorIds: selectedVendorIds,
          lineItems: lines.map((l) => ({
            itemName: l.itemName.trim(),
            description: l.description.trim(),
            specification: l.specification.trim(),
            quantity: Number(l.quantity),
            unit: l.unit || "unit",
            targetPrice: Number(l.targetPrice) || undefined,
            notes: l.notes.trim(),
            requestLineItemId: l.requestLineItemId,
          })),
          criteria:
            evaluationMethod === "LOWEST_PRICE"
              ? undefined
              : criteria.map((c) => ({
                  name: c.name.trim(),
                  type: c.type,
                  weight: c.weight,
                  maxScore: c.maxScore,
                  lowerIsBetter: c.lowerIsBetter,
                  isAutomatic: c.isAutomatic,
                })),
        }),
      { success: "RFQ saved as a draft" }
    );
    setSaving(false);
    if (!created) return;
    selectRfq(created.id);
    navigate("rfq-detail");
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("rfqs")}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} /> Back to sourcing
      </button>

      <PageHeader
        title="New Request for Quotation"
        description="Build the tender as a draft. It goes to suppliers only after approval and publication."
      />

      {/* Step rail */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const active = s.key === step;
          return (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {done ? <Check size={14} /> : <s.icon size={14} />}
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {step === "requirement" && (
            <RequirementStep
              {...{
                title,
                setTitle,
                description,
                setDescription,
                referenceNumber,
                setReferenceNumber,
                requestId,
                adoptRequest,
                approvedRequests,
                deadline,
                setDeadline,
                questionDeadline,
                setQuestionDeadline,
                requiredDeliveryDate,
                setRequiredDeliveryDate,
                deliveryTerms,
                setDeliveryTerms,
                deliveryAddress,
                setDeliveryAddress,
                termsAndConditions,
                setTermsAndConditions,
                currency,
                setCurrency,
                estimatedValue,
                setEstimatedValue,
                estimatedFromLines,
                isSealed,
                setIsSealed,
                showTargetPrice,
                setShowTargetPrice,
                allowSupplierRevision,
                setAllowSupplierRevision,
              }}
            />
          )}

          {step === "lines" && <LineItemsStep lines={lines} setLines={setLines} currency={currency} />}

          {step === "evaluation" && (
            <EvaluationStep
              criteria={criteria}
              setCriteria={setCriteria}
              method={evaluationMethod}
              setMethod={setEvaluationMethod}
              weightTotal={weightTotal}
              weightsValid={weightsValid}
            />
          )}

          {step === "suppliers" && (
            <SuppliersStep
              suppliers={suppliers.data ?? []}
              loading={suppliers.loading}
              selected={selectedVendorIds}
              setSelected={setSelectedVendorIds}
              search={supplierSearch}
              setSearch={setSupplierSearch}
              compliantOnly={compliantOnly}
              setCompliantOnly={setCompliantOnly}
              existingOnly={existingOnly}
              setExistingOnly={setExistingOnly}
              maxRisk={maxRisk}
              setMaxRisk={setMaxRisk}
            />
          )}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].key)}
              disabled={stepIndex === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={14} /> Back
            </button>
            {stepIndex < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(STEPS[stepIndex + 1].key)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
              >
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={save}
                disabled={saving || problems.length > 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save draft
              </button>
            )}
          </div>
        </div>

        {/* Summary rail */}
        <div className="space-y-4">
          <div className="sticky top-20 space-y-4">
            <SectionCard title="Summary">
              <dl className="space-y-2.5 text-sm">
                <Row label="Title" value={title || "—"} />
                <Row label="Reference" value={referenceNumber || "—"} />
                <Row
                  label="From request"
                  value={requestId ? (requests.find((r) => r.id === requestId)?.requestNumber ?? "—") : "None"}
                />
                <Row label="Deadline" value={deadline ? formatDate(deadline) : "—"} />
                <Row label="Line items" value={String(lines.length)} />
                <Row
                  label="Estimated value"
                  value={
                    Number(estimatedValue) || estimatedFromLines
                      ? formatCurrency(Number(estimatedValue) || estimatedFromLines, currency)
                      : "—"
                  }
                />
                <Row
                  label="Evaluation"
                  value={evaluationMethod === "LOWEST_PRICE" ? "Lowest price" : `${criteria.length} criteria`}
                />
                <Row label="Suppliers" value={String(selectedVendorIds.length)} />
              </dl>
            </SectionCard>

            {problems.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="flex items-start gap-2.5">
                  <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Before this can be saved</p>
                    <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                      {problems.map((p) => (
                        <li key={p} className="flex gap-1.5">
                          <span className="text-amber-500">·</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="text-xs">
                    <p className="text-sm font-medium text-foreground">Ready to save</p>
                    <p className="mt-1 text-muted-foreground">
                      Saving creates a draft. Suppliers are notified only when it is published, after approval.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

const inputCls =
  "mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all";

interface RequirementStepProps {
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  referenceNumber: string;
  setReferenceNumber: (v: string) => void;
  requestId: string;
  adoptRequest: (id: string) => void;
  approvedRequests: { id: string; requestNumber: string; title: string }[];
  deadline: string;
  setDeadline: (v: string) => void;
  questionDeadline: string;
  setQuestionDeadline: (v: string) => void;
  requiredDeliveryDate: string;
  setRequiredDeliveryDate: (v: string) => void;
  deliveryTerms: string;
  setDeliveryTerms: (v: string) => void;
  deliveryAddress: string;
  setDeliveryAddress: (v: string) => void;
  termsAndConditions: string;
  setTermsAndConditions: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  estimatedValue: string;
  setEstimatedValue: (v: string) => void;
  estimatedFromLines: number;
  isSealed: boolean;
  setIsSealed: (v: boolean) => void;
  showTargetPrice: boolean;
  setShowTargetPrice: (v: boolean) => void;
  allowSupplierRevision: boolean;
  setAllowSupplierRevision: (v: boolean) => void;
}

function RequirementStep(p: RequirementStepProps) {
  return (
    <>
      <SectionCard title="What is being sourced">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">
              Title <span className="text-rose-500">*</span>
            </label>
            <input
              value={p.title}
              onChange={(e) => p.setTitle(e.target.value)}
              placeholder="e.g. Field hardware refresh — Q3"
              className={inputCls}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground">Linked purchase request</label>
              <select value={p.requestId} onChange={(e) => p.adoptRequest(e.target.value)} className={inputCls}>
                <option value="">Not linked to a request</option>
                {p.approvedRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requestNumber} — {r.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Linking keeps the award traceable back to the requirement that justified it.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Your reference</label>
              <input
                value={p.referenceNumber}
                onChange={(e) => p.setReferenceNumber(e.target.value)}
                placeholder="Tender or board paper number"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              value={p.description}
              onChange={(e) => p.setDescription(e.target.value)}
              rows={4}
              placeholder="What suppliers need to understand about this requirement…"
              className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Dates and delivery">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Calendar size={14} /> Response deadline <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={p.deadline}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => p.setDeadline(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">Enforced by the server, not by a disabled button.</p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Questions close</label>
            <input
              type="date"
              value={p.questionDeadline}
              max={p.deadline}
              onChange={(e) => p.setQuestionDeadline(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Required delivery date</label>
            <input
              type="date"
              value={p.requiredDeliveryDate}
              onChange={(e) => p.setRequiredDeliveryDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Delivery terms</label>
            <input
              value={p.deliveryTerms}
              onChange={(e) => p.setDeliveryTerms(e.target.value)}
              placeholder="e.g. DDP, buyer's warehouse"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-foreground">Delivery address</label>
            <input
              value={p.deliveryAddress}
              onChange={(e) => p.setDeliveryAddress(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Commercial terms">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground">Currency</label>
              <select value={p.currency} onChange={(e) => p.setCurrency(e.target.value)} className={inputCls}>
                {["USD", "EUR", "GBP", "NGN", "KES", "ZAR", "GHS", "AED", "INR"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Estimated value</label>
              <input
                type="number"
                min={0}
                value={p.estimatedValue}
                onChange={(e) => p.setEstimatedValue(e.target.value)}
                placeholder={p.estimatedFromLines ? String(p.estimatedFromLines) : "0.00"}
                className={inputCls}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Routes the approval band. Never shown to suppliers.
              </p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Terms and conditions</label>
            <textarea
              value={p.termsAndConditions}
              onChange={(e) => p.setTermsAndConditions(e.target.value)}
              rows={4}
              placeholder="Payment terms, warranty expectations, penalties…"
              className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-2.5 border-t border-border pt-4">
            <Toggle
              checked={p.isSealed}
              onChange={p.setIsSealed}
              label="Sealed bidding"
              hint="Bids stay unreadable — to you as well — until the deadline passes."
            />
            <Toggle
              checked={p.showTargetPrice}
              onChange={p.setShowTargetPrice}
              label="Publish target prices to suppliers"
              hint="Off by default: publishing the budget invites every bid to land just underneath it."
            />
            <Toggle
              checked={p.allowSupplierRevision}
              onChange={p.setAllowSupplierRevision}
              label="Let suppliers revise their own quotation"
              hint="Off by default. With it off, a revision needs your explicit invitation."
            />
          </div>
        </div>
      </SectionCard>
    </>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all",
          checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
        )}
      >
        {checked && <Check size={13} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function LineItemsStep({
  lines,
  setLines,
  currency,
}: {
  lines: DraftLine[];
  setLines: (l: DraftLine[]) => void;
  currency: string;
}) {
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <SectionCard
      title="Line items"
      description="Exactly what suppliers will price. Every line must be answered — with a price or an explicit no-bid."
      action={
        <button
          onClick={() => setLines([...lines, emptyLine()])}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus size={13} /> Add line
        </button>
      }
    >
      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={l.key} className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Line {i + 1}</span>
              {lines.length > 1 && (
                <button
                  onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                  className="text-muted-foreground transition-colors hover:text-rose-600"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-3">
                <label className="text-xs font-medium text-foreground">Item name *</label>
                <input
                  value={l.itemName}
                  onChange={(e) => update(l.key, { itemName: e.target.value })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Quantity *</label>
                <input
                  type="number"
                  min={0.0001}
                  step="any"
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: Number(e.target.value) })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Unit</label>
                <input
                  value={l.unit}
                  onChange={(e) => update(l.key, { unit: e.target.value })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Target price</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.targetPrice}
                  onChange={(e) => update(l.key, { targetPrice: e.target.value })}
                  placeholder={currency}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="sm:col-span-6">
                <label className="text-xs font-medium text-foreground">Specification</label>
                <textarea
                  value={l.specification}
                  onChange={(e) => update(l.key, { specification: e.target.value })}
                  rows={2}
                  placeholder="What the supplier must confirm compliance against"
                  className="mt-1 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

const CRITERION_TYPES: CriterionType[] = [
  "PRICE",
  "DELIVERY",
  "QUALITY",
  "TECHNICAL",
  "COMPLIANCE",
  "WARRANTY",
  "EXPERIENCE",
  "SERVICE_LEVEL",
  "RISK",
  "OTHER",
];

function EvaluationStep({
  criteria,
  setCriteria,
  method,
  setMethod,
  weightTotal,
  weightsValid,
}: {
  criteria: DraftCriterion[];
  setCriteria: (c: DraftCriterion[]) => void;
  method: EvaluationMethod;
  setMethod: (m: EvaluationMethod) => void;
  weightTotal: number;
  weightsValid: boolean;
}) {
  const update = (key: string, patch: Partial<DraftCriterion>) =>
    setCriteria(criteria.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  /** Spreads the weights evenly. The commonest fix for a set that does not add up. */
  const normalise = () => {
    const even = Math.floor((100 / criteria.length) * 100) / 100;
    const rows = criteria.map((c) => ({ ...c, weight: even }));
    // The rounding remainder lands on the first criterion so the set totals
    // exactly 100 rather than 99.99.
    if (rows.length > 0) {
      rows[0].weight = Math.round((100 - even * (rows.length - 1)) * 100) / 100;
    }
    setCriteria(rows);
  };

  return (
    <>
      <SectionCard title="How the bids will be judged">
        <div className="space-y-3">
          {(
            [
              ["LOWEST_PRICE", "Lowest price", "The cheapest compliant bid wins. No panel, no scoring."],
              ["WEIGHTED_SCORE", "Weighted score", "Bids are scored against criteria you weight. The total decides."],
              ["QUALITY_THEN_PRICE", "Quality, then price", "Score first; price breaks ties between equals."],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              onClick={() => setMethod(value)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all",
                method === value
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-border bg-card hover:bg-muted/40"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
                  method === value ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
                )}
              >
                {method === value && <Check size={12} />}
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </SectionCard>

      {method !== "LOWEST_PRICE" && (
        <SectionCard
          title="Evaluation criteria"
          description="Fixed now, before any bid arrives — so the yardstick cannot be chosen after seeing the numbers."
          action={
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                  weightsValid
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                )}
              >
                {weightTotal}% of 100%
              </span>
              <button
                onClick={normalise}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                Even out
              </button>
              <button
                onClick={() =>
                  setCriteria([
                    ...criteria,
                    {
                      key: newKey(),
                      name: "",
                      type: "OTHER",
                      weight: 0,
                      maxScore: 10,
                      lowerIsBetter: false,
                      isAutomatic: false,
                    },
                  ])
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            {criteria.map((c) => (
              <div key={c.key} className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Criterion
                  </label>
                  <input
                    value={c.name}
                    onChange={(e) => update(c.key, { name: e.target.value })}
                    placeholder="e.g. Technical compliance"
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Type</label>
                  <select
                    value={c.type}
                    onChange={(e) => {
                      const type = e.target.value as CriterionType;
                      update(c.key, {
                        type,
                        // Price, delivery and risk read the other way round, and the
                        // system can score the first two from the bid itself.
                        lowerIsBetter: type === "PRICE" || type === "DELIVERY" || type === "RISK",
                        isAutomatic: type === "PRICE" || type === "DELIVERY",
                      });
                    }}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {CRITERION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ").toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Weight %
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={c.weight}
                    onChange={(e) => update(c.key, { weight: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Max score
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={c.maxScore}
                    onChange={(e) => update(c.key, { maxScore: Number(e.target.value) })}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="flex items-end justify-between gap-2 sm:col-span-1">
                  {c.isAutomatic && (
                    <span title="Scored automatically from the bid" className="pb-2 text-emerald-600 dark:text-emerald-400">
                      <Gavel size={14} />
                    </span>
                  )}
                  <button
                    onClick={() => setCriteria(criteria.filter((x) => x.key !== c.key))}
                    className="pb-2 text-muted-foreground transition-colors hover:text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            Criteria marked with a gavel are scored by the system from the bid itself — price and lead time — so the
            panel is only asked for the judgements a person has to make.
          </p>
        </SectionCard>
      )}
    </>
  );
}

function SuppliersStep({
  suppliers,
  loading,
  selected,
  setSelected,
  search,
  setSearch,
  compliantOnly,
  setCompliantOnly,
  existingOnly,
  setExistingOnly,
  maxRisk,
  setMaxRisk,
}: {
  suppliers: EligibleSupplier[];
  loading: boolean;
  selected: string[];
  setSelected: (v: string[]) => void;
  search: string;
  setSearch: (v: string) => void;
  compliantOnly: boolean;
  setCompliantOnly: (v: boolean) => void;
  existingOnly: boolean;
  setExistingOnly: (v: boolean) => void;
  maxRisk: string;
  setMaxRisk: (v: string) => void;
}) {
  const toggle = (id: string) =>
    setSelected(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);

  return (
    <SectionCard
      title="Invite suppliers"
      description={`${selected.length} selected. Only approved and active suppliers appear here — a suspended or blacklisted supplier is not selectable at all.`}
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search suppliers…"
              className="h-9 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Select value={maxRisk} onValueChange={setMaxRisk}>
            <SelectTrigger className="h-9 w-[150px] text-sm">
              <SelectValue placeholder="Risk" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any risk</SelectItem>
              <SelectItem value="LOW">Low only</SelectItem>
              <SelectItem value="MEDIUM">Medium or lower</SelectItem>
              <SelectItem value="HIGH">High or lower</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip active={compliantOnly} onClick={() => setCompliantOnly(!compliantOnly)} label="Compliant only" />
          <FilterChip active={existingOnly} onClick={() => setExistingOnly(!existingOnly)} label="Traded with before" />
        </div>

        {loading && suppliers.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No eligible suppliers"
            description="Only approved or active suppliers can be invited to source. Approve a supplier first, or widen the filters."
          />
        ) : (
          <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {suppliers.map((v) => {
              const isSelected = selected.includes(v.id);
              return (
                <button
                  key={v.id}
                  onClick={() => toggle(v.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all",
                    isSelected
                      ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                      : "border-border bg-card hover:bg-muted/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all",
                      isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"
                    )}
                  >
                    {isSelected && <Check size={13} />}
                  </span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white">
                    {v.companyName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{v.companyName}</span>
                      <VendorComplianceBadge state={v.complianceState} />
                      <VendorRiskBadge level={v.riskLevel} />
                      {/* An invitation to a supplier with no portal login is a
                          notification nobody will read — worth saying out loud. */}
                      {!v.hasPortalAccess && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                          No portal access
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[v.country, v.categories.map((c) => c.name).join(", ")].filter(Boolean).join(" · ") ||
                        "No categories recorded"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">{v.totalOrders} orders</span>
                    <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-medium text-foreground">
                      {v.rating > 0 ? (
                        <>
                          <Star size={11} className="fill-amber-400 text-amber-400" />
                          {v.rating.toFixed(1)}
                        </>
                      ) : (
                        "New"
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      )}
    >
      {active && <Check size={11} />}
      {label}
    </button>
  );
}
