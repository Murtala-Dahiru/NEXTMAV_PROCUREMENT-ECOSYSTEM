// NextMav Procure — Vendor Profile
//
// One question this page has to answer at a glance: who is this supplier, are
// they approved, are they compliant, what do they supply, what risks exist, and
// what has happened with them.
//
// It reads /api/vendors/[id], which returns the record together with its approval
// history, activity timeline, internal notes and procurement totals. Two things
// the previous version did are deliberately gone: it charted a six-month
// performance trend generated with `Math.random()`, and it offered every action
// to everybody. Performance now shows the snapshots that exist — often none — and
// the action bar is built from `availableActions`, which the server computes from
// the caller's permissions and the vendor's current state.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  PauseCircle,
  Phone,
  Plus,
  RotateCcw,
  ShieldCheck,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  Avatar,
  ComplianceItemBadge,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionCard,
  SkeletonList,
  StatTile,
  VendorComplianceBadge,
  VendorRiskBadge,
  VendorStatusBadge,
} from "@/components/shared";
import { api, mutate } from "@/lib/api/client";
import { useServerData } from "@/lib/use-server-data";
import { formatCompactCurrency, formatDate, formatRelativeTime, initials as initialsOf } from "@/lib/format";
import type {
  Vendor,
  VendorComplianceRequirement,
  VendorDocument,
  VendorNote,
  VendorRiskAssessment,
} from "@/lib/types";
import type { VendorAction } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// What /api/vendors/[id] adds on top of the directory projection.
interface VendorDetail extends Vendor {
  riskAssessments: VendorRiskAssessment[];
  performance: {
    id: string;
    periodStart: string;
    periodEnd: string;
    ordersCount: number;
    receiptsCount: number;
    onTimeRate: number;
    qualityRate: number;
    complianceScore: number;
    disputeCount: number;
    totalSpend: number;
  }[];
  approvals: {
    id: string;
    status: string;
    workflowName?: string;
    startedAt: string;
    completedAt?: string;
    outcomeReason?: string;
    steps: {
      id: string;
      stage: string;
      sequence: number;
      approverId: string;
      approverRole: string;
      decision: string;
      comment?: string;
      decidedAt?: string;
      slaExpiresAt?: string;
    }[];
  }[];
  activity: {
    id: string;
    eventType: string;
    description: string;
    severity: string;
    userId?: string;
    createdAt: string;
  }[];
  internalNotes: VendorNote[];
  procurement: {
    rfqs: number;
    purchaseOrders: number;
    invoices: number;
    payments: number;
    contracts: number;
    orderedValue: number;
    invoicedValue: number;
  };
  availableActions: string[];
}

type Tab =
  | "overview"
  | "company"
  | "contacts"
  | "compliance"
  | "documents"
  | "performance"
  | "risk"
  | "notes"
  | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "company", label: "Company" },
  { key: "contacts", label: "Contacts" },
  { key: "compliance", label: "Compliance" },
  { key: "documents", label: "Documents" },
  { key: "performance", label: "Performance" },
  { key: "risk", label: "Risk" },
  { key: "notes", label: "Notes" },
  { key: "activity", label: "Activity" },
];

export function VendorDetailView() {
  const navigate = useStore((s) => s.navigate);
  const vendorId = useStore((s) => s.selectedVendorId);
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);

  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    () => api.get<VendorDetail>(`/api/vendors/${vendorId}`),
    [vendorId]
  );
  const { data: vendor, error, loading, reload: load } = useServerData(
    fetcher,
    "Could not load this vendor."
  );

  const nameOf = (id?: string) => users.find((u) => u.id === id)?.name ?? "—";

  if (!vendorId) {
    return <NotFound onBack={() => navigate("vendors")} />;
  }

  if (loading && !vendor) {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => navigate("vendors")} />
        <SkeletonList count={5} />
      </div>
    );
  }

  if (error || !vendor) {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => navigate("vendors")} />
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-10 text-center dark:border-rose-900 dark:bg-rose-950/20">
          <TriangleAlert size={22} className="mx-auto text-rose-500" />
          <p className="mt-3 text-sm font-medium text-foreground">{error ?? "Vendor not found."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => void load()}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-95"
            >
              Try again
            </button>
            <button
              onClick={() => navigate("vendors")}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              Back to vendors
            </button>
          </div>
        </div>
      </div>
    );
  }

  const can = (a: string) => vendor.availableActions.includes(a);
  const mandatory = vendor.compliance.filter((c) => c.isMandatory);
  const satisfied = mandatory.filter((c) => c.status === "VERIFIED" || c.status === "WAIVED");
  const lapsing = [
    ...vendor.documents.filter((d) => d.daysToExpiry !== undefined && d.daysToExpiry <= 30),
    ...vendor.compliance.filter((c) => c.daysToExpiry !== undefined && c.daysToExpiry <= 30),
  ];

  return (
    <div className="space-y-6">
      <BackLink onClick={() => navigate("vendors")} />

      <PageHeader
        title={vendor.companyName}
        description={
          [
            vendor.legalName && vendor.legalName !== vendor.companyName ? vendor.legalName : null,
            vendor.code,
            vendor.vendorType.replace(/_/g, " ").toLowerCase(),
            `added ${formatDate(vendor.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <VendorStatusBadge status={vendor.status} />
            {vendor.isPreferred && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">
                <Star size={11} className="fill-violet-500 text-violet-500" /> Preferred
              </span>
            )}
          </div>
        }
      />

      <ActionBar
        vendor={vendor}
        busy={busy}
        setBusy={setBusy}
        onDone={load}
      />

      {/* The things a reader must not have to hunt for. */}
      {(vendor.status === "SUSPENDED" ||
        vendor.status === "BLACKLISTED" ||
        vendor.status === "REJECTED" ||
        vendor.complianceState === "NON_COMPLIANT" ||
        vendor.complianceState === "EXPIRED" ||
        lapsing.length > 0) && (
        <div className="space-y-2">
          {vendor.status === "BLACKLISTED" && (
            <Banner
              tone="rose"
              icon={Ban}
              title="This supplier is blacklisted"
              detail={vendor.blacklistedReason ?? "No reason recorded."}
              meta={vendor.blacklistedAt ? `Barred ${formatDate(vendor.blacklistedAt)}` : undefined}
            />
          )}
          {vendor.status === "SUSPENDED" && (
            <Banner
              tone="amber"
              icon={PauseCircle}
              title="This supplier is suspended"
              detail={vendor.suspendedReason ?? "No reason recorded."}
              meta={vendor.suspendedAt ? `Suspended ${formatDate(vendor.suspendedAt)}` : undefined}
            />
          )}
          {vendor.status === "REJECTED" && (
            <Banner
              tone="rose"
              icon={AlertCircle}
              title="Onboarding was rejected"
              detail={vendor.rejectedReason ?? "No reason recorded."}
              meta={vendor.rejectedAt ? `Rejected ${formatDate(vendor.rejectedAt)}` : undefined}
            />
          )}
          {(vendor.complianceState === "NON_COMPLIANT" || vendor.complianceState === "EXPIRED") && (
            <Banner
              tone="rose"
              icon={ShieldCheck}
              title={
                vendor.complianceState === "EXPIRED"
                  ? "Mandatory compliance evidence has expired"
                  : "This supplier is not compliant"
              }
              detail={`${satisfied.length} of ${mandatory.length} mandatory requirements are satisfied.`}
            />
          )}
          {lapsing.length > 0 && vendor.complianceState !== "EXPIRED" && (
            <Banner
              tone="amber"
              icon={CalendarClock}
              title={`${lapsing.length} item${lapsing.length === 1 ? "" : "s"} lapsing within 30 days`}
              detail="Collect replacements before they expire to keep this supplier tradeable."
            />
          )}
        </div>
      )}

      {/* Headline figures */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Compliance"
          value={`${vendor.complianceScore}%`}
          sublabel={
            mandatory.length > 0
              ? `${satisfied.length}/${mandatory.length} mandatory satisfied`
              : "No requirements set"
          }
          icon={ShieldCheck}
        />
        <StatTile
          label="Risk"
          value={vendor.riskScore !== undefined ? `${vendor.riskScore}/100` : "Unrated"}
          sublabel={
            vendor.riskReviewedAt ? `Reviewed ${formatDate(vendor.riskReviewedAt)}` : "Never assessed"
          }
          icon={Gauge}
        />
        <StatTile
          label="Purchase orders"
          value={vendor.procurement.purchaseOrders}
          sublabel={
            vendor.procurement.orderedValue > 0
              ? formatCompactCurrency(vendor.procurement.orderedValue, vendor.preferredCurrency)
              : "No spend yet"
          }
          icon={Package}
        />
        <StatTile
          label="On-time delivery"
          value={
            vendor.performance.length > 0 || vendor.onTimeDeliveryRate > 0
              ? `${Math.round(vendor.onTimeDeliveryRate)}%`
              : "—"
          }
          sublabel={
            vendor.performanceUpdatedAt
              ? `Computed ${formatDate(vendor.performanceUpdatedAt)}`
              : "Awaiting delivery history"
          }
          icon={Activity}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-emerald-600 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.key === "compliance" && mandatory.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {satisfied.length}/{mandatory.length}
              </span>
            )}
            {t.key === "contacts" && vendor.contacts.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {vendor.contacts.length}
              </span>
            )}
            {t.key === "documents" && vendor.documents.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                {vendor.documents.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab vendor={vendor} nameOf={nameOf} />}
      {tab === "company" && <CompanyTab vendor={vendor} />}
      {tab === "contacts" && <ContactsTab vendor={vendor} onDone={load} can={can} />}
      {tab === "compliance" && <ComplianceTab vendor={vendor} onDone={load} nameOf={nameOf} can={can} />}
      {tab === "documents" && <DocumentsTab vendor={vendor} onDone={load} nameOf={nameOf} can={can} />}
      {tab === "performance" && <PerformanceTab vendor={vendor} />}
      {tab === "risk" && <RiskTab vendor={vendor} onDone={load} nameOf={nameOf} can={can} />}
      {tab === "notes" && <NotesTab vendor={vendor} onDone={load} nameOf={nameOf} currentUserId={currentUserId} />}
      {tab === "activity" && <ActivityTab vendor={vendor} nameOf={nameOf} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} /> Back to vendors
    </button>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />
      <EmptyState
        icon={Building2}
        title="No vendor selected"
        description="Choose a supplier from the directory to see their profile."
        action={
          <button
            onClick={onBack}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-95"
          >
            Open the directory
          </button>
        }
      />
    </div>
  );
}

function Banner({
  tone,
  icon: Icon,
  title,
  detail,
  meta,
}: {
  tone: "rose" | "amber";
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  detail: string;
  meta?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4",
        tone === "rose"
          ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
          : "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
      )}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", tone === "rose" ? "text-rose-500" : "text-amber-500")} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        {meta && <p className="mt-1 text-[11px] text-muted-foreground/80">{meta}</p>}
      </div>
    </div>
  );
}

/**
 * The lifecycle actions.
 *
 * Every button here comes from `vendor.availableActions`, which the server built
 * from this caller's permissions and this vendor's state. An action the user may
 * not take is not rendered — and, because the same rules run again in the
 * service, hiding it is a courtesy rather than the control.
 */
function ActionBar({
  vendor,
  busy,
  setBusy,
  onDone,
}: {
  vendor: VendorDetail;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const vendorAction = useStore((s) => s.vendorAction);
  const submitVendorForReview = useStore((s) => s.submitVendorForReview);
  const [confirm, setConfirm] = useState<{
    action: VendorAction;
    title: string;
    description: string;
    needsReason: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");

  const available = new Set(vendor.availableActions);

  const run = async (action: VendorAction, why?: string) => {
    setBusy(true);
    const ok = await mutate(() => vendorAction(vendor.id, action, why), {
      success: `${vendor.companyName} updated`,
    });
    setBusy(false);
    setConfirm(null);
    setReason("");
    if (ok !== null) await onDone();
  };

  const submit = async () => {
    setBusy(true);
    const ok = await mutate(() => submitVendorForReview(vendor.id), {
      success: `${vendor.companyName} submitted for approval`,
    });
    setBusy(false);
    if (ok !== null) await onDone();
  };

  const buttons: React.ReactNode[] = [];

  if (available.has("SUBMIT_FOR_REVIEW")) {
    buttons.push(
      <ActionButton key="submit" primary icon={ClipboardList} onClick={submit} disabled={busy}>
        Submit for approval
      </ActionButton>
    );
  }
  if (available.has("START_ONBOARDING")) {
    buttons.push(
      <ActionButton key="onboard" icon={UserPlus} onClick={() => run("START_ONBOARDING")} disabled={busy}>
        Start onboarding
      </ActionButton>
    );
  }
  if (available.has("INVITE")) {
    buttons.push(
      <ActionButton key="invite" icon={Mail} onClick={() => run("INVITE")} disabled={busy}>
        Mark invited
      </ActionButton>
    );
  }
  if (available.has("ACTIVATE")) {
    buttons.push(
      <ActionButton key="activate" primary icon={CheckCircle2} onClick={() => run("ACTIVATE")} disabled={busy}>
        Activate supplier
      </ActionButton>
    );
  }
  if (available.has("REACTIVATE")) {
    buttons.push(
      <ActionButton key="reactivate" icon={RotateCcw} onClick={() => run("REACTIVATE")} disabled={busy}>
        Reactivate
      </ActionButton>
    );
  }
  if (available.has("SUSPEND")) {
    buttons.push(
      <ActionButton
        key="suspend"
        icon={PauseCircle}
        tone="amber"
        disabled={busy}
        onClick={() =>
          setConfirm({
            action: "SUSPEND",
            title: `Suspend ${vendor.companyName}?`,
            description:
              "They stay on the directory but cannot take new business until reactivated. The reason goes on their record.",
            needsReason: true,
          })
        }
      >
        Suspend
      </ActionButton>
    );
  }
  if (available.has("DEACTIVATE")) {
    buttons.push(
      <ActionButton
        key="deactivate"
        icon={PauseCircle}
        disabled={busy}
        onClick={() =>
          setConfirm({
            action: "DEACTIVATE",
            title: `Deactivate ${vendor.companyName}?`,
            description: "Ends the trading relationship without barring them. They can be reactivated later.",
            needsReason: true,
          })
        }
      >
        Deactivate
      </ActionButton>
    );
  }
  if (available.has("SET_PREFERRED")) {
    buttons.push(
      <ActionButton key="pref" icon={Star} onClick={() => run("SET_PREFERRED")} disabled={busy}>
        Mark preferred
      </ActionButton>
    );
  }
  if (available.has("CLEAR_PREFERRED")) {
    buttons.push(
      <ActionButton key="unpref" icon={Star} onClick={() => run("CLEAR_PREFERRED")} disabled={busy}>
        Remove preferred
      </ActionButton>
    );
  }
  if (available.has("ARCHIVE")) {
    buttons.push(
      <ActionButton
        key="archive"
        disabled={busy}
        onClick={() =>
          setConfirm({
            action: "ARCHIVE",
            title: `Archive ${vendor.companyName}?`,
            description: "They are hidden from the working directory. Nothing is deleted and they can be restored.",
            needsReason: false,
          })
        }
      >
        Archive
      </ActionButton>
    );
  }
  if (available.has("RESTORE")) {
    buttons.push(
      <ActionButton key="restore" icon={RotateCcw} onClick={() => run("RESTORE")} disabled={busy}>
        Restore
      </ActionButton>
    );
  }
  if (available.has("BLACKLIST")) {
    buttons.push(
      <ActionButton
        key="blacklist"
        icon={Ban}
        tone="rose"
        disabled={busy}
        onClick={() =>
          setConfirm({
            action: "BLACKLIST",
            title: `Blacklist ${vendor.companyName}?`,
            description:
              "They are barred from purchase orders, invoices and payments across the platform. Lifting it later is a separate, deliberate step.",
            needsReason: true,
          })
        }
      >
        Blacklist
      </ActionButton>
    );
  }
  if (available.has("LIFT_BLACKLIST")) {
    buttons.push(
      <ActionButton
        key="unblacklist"
        icon={RotateCcw}
        disabled={busy}
        onClick={() =>
          setConfirm({
            action: "LIFT_BLACKLIST",
            title: `Lift the blacklist on ${vendor.companyName}?`,
            description:
              "They become inactive, not active — re-admitting a barred supplier is a second, separate decision.",
            needsReason: true,
          })
        }
      >
        Lift blacklist
      </ActionButton>
    );
  }

  if (buttons.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        {busy && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        {buttons}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">{confirm.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{confirm.description}</p>
            {confirm.needsReason && (
              <div className="mt-4">
                <label className="text-sm font-medium text-foreground">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="This is recorded on the vendor's audit history."
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirm(null);
                  setReason("");
                }}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void run(confirm.action, reason)}
                disabled={busy || (confirm.needsReason && reason.trim().length === 0)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActionButton({
  children,
  icon: Icon,
  onClick,
  disabled,
  primary,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  tone?: "amber" | "rose";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50",
        primary
          ? "border-transparent bg-primary text-primary-foreground hover:opacity-95"
          : tone === "rose"
            ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400"
            : tone === "amber"
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400"
              : "border-border bg-card text-foreground hover:bg-muted"
      )}
    >
      {Icon && <Icon size={13} />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function OverviewTab({ vendor, nameOf }: { vendor: VendorDetail; nameOf: (id?: string) => string }) {
  const primary = vendor.contacts.find((c) => c.isPrimary) ?? vendor.contacts[0];
  const current = vendor.approvals.find((a) => a.status === "IN_PROGRESS");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {current && (
          <SectionCard title="Onboarding approval in progress" description={current.workflowName}>
            <div className="space-y-3">
              {current.steps.map((s) => (
                <div key={s.id} className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      s.decision === "APPROVED"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : s.decision === "REJECTED"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {s.sequence}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {s.stage.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {nameOf(s.approverId)} ·{" "}
                      {s.decision === "PENDING"
                        ? s.slaExpiresAt
                          ? `due ${formatRelativeTime(s.slaExpiresAt)}`
                          : "awaiting decision"
                        : `${s.decision.toLowerCase()} ${s.decidedAt ? formatDate(s.decidedAt) : ""}`}
                    </p>
                    {s.comment && (
                      <p className="mt-1 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                        “{s.comment}”
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard title="What they supply">
          {vendor.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No supply categories recorded. Categories are what sourcing uses to propose an invitation
              list for an RFQ, so it is worth filling in.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vendor.categories.map((c) => (
                <span
                  key={c.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium",
                    c.isPreferred
                      ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300"
                      : "border-border bg-muted/50 text-muted-foreground"
                  )}
                >
                  {c.isPreferred && <Star size={10} className="fill-current" />}
                  {c.categoryName}
                </span>
              ))}
            </div>
          )}
          {vendor.description && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{vendor.description}</p>
          )}
        </SectionCard>

        <SectionCard
          title="Procurement history"
          description="Counted from live records. Empty until this supplier is used."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="RFQs" value={vendor.procurement.rfqs} icon={ClipboardList} />
            <StatTile
              label="Purchase orders"
              value={vendor.procurement.purchaseOrders}
              sublabel={
                vendor.procurement.orderedValue > 0
                  ? formatCompactCurrency(vendor.procurement.orderedValue, vendor.preferredCurrency)
                  : undefined
              }
              icon={Package}
            />
            <StatTile
              label="Invoices"
              value={vendor.procurement.invoices}
              sublabel={
                vendor.procurement.invoicedValue > 0
                  ? formatCompactCurrency(vendor.procurement.invoicedValue, vendor.preferredCurrency)
                  : undefined
              }
              icon={FileText}
            />
            <StatTile label="Payments" value={vendor.procurement.payments} icon={FileText} />
            <StatTile label="Contracts" value={vendor.procurement.contracts} icon={FileText} />
          </div>
        </SectionCard>
      </div>

      <div className="space-y-6">
        <SectionCard title="Primary contact">
          {primary ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar initials={initialsOf(primary.name)} color="bg-emerald-500" size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{primary.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {primary.jobTitle ?? primary.type.replace(/_/g, " ").toLowerCase()}
                  </p>
                </div>
              </div>
              {primary.email && <Line icon={Mail} value={primary.email} />}
              {primary.phone && <Line icon={Phone} value={primary.phone} />}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No contact recorded yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Status">
          <dl className="space-y-2.5 text-sm">
            <Row label="Lifecycle" value={<VendorStatusBadge status={vendor.status} />} />
            <Row label="Compliance" value={<VendorComplianceBadge state={vendor.complianceState} />} />
            <Row label="Risk" value={<VendorRiskBadge level={vendor.riskLevel} />} />
            <Row label="Payment terms" value={vendor.paymentTerms.replace(/_/g, " ")} />
            <Row label="Currency" value={vendor.preferredCurrency} />
            {vendor.leadTimeDays ? <Row label="Lead time" value={`${vendor.leadTimeDays} days`} /> : null}
            <Row label="Added by" value={nameOf(vendor.createdById)} />
            {vendor.approvedAt && (
              <Row label="Approved" value={`${formatDate(vendor.approvedAt)} by ${nameOf(vendor.approvedById)}`} />
            )}
            {vendor.activatedAt && <Row label="Activated" value={formatDate(vendor.activatedAt)} />}
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}

function CompanyTab({ vendor }: { vendor: VendorDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Legal identity">
        <dl className="space-y-2.5 text-sm">
          <Row label="Trading name" value={vendor.companyName} />
          <Row label="Registered name" value={vendor.legalName ?? "—"} />
          <Row label="Also known as" value={vendor.tradingName ?? "—"} />
          <Row label="Vendor type" value={vendor.vendorType.replace(/_/g, " ").toLowerCase()} />
          <Row label="Classification" value={vendor.businessClassification ?? "—"} />
          <Row label="Business size" value={vendor.businessSize?.toLowerCase() ?? "—"} />
          <Row label="Incorporated" value={vendor.incorporatedOn ? formatDate(vendor.incorporatedOn) : "—"} />
        </dl>
      </SectionCard>

      <SectionCard title="Registration">
        <dl className="space-y-2.5 text-sm">
          <Row label="Vendor code" value={vendor.code ?? "—"} />
          <Row label="Tax identification" value={vendor.taxNumber || "—"} />
          <Row label="Registration number" value={vendor.registrationNumber ?? "—"} />
          <Row label="Bank" value={vendor.bankName || "Not visible to your role"} />
          <Row label="Account" value={vendor.bankAccount || "Not visible to your role"} />
        </dl>
      </SectionCard>

      <SectionCard title="Address">
        <dl className="space-y-2.5 text-sm">
          <Row label="Street" value={vendor.address || "—"} />
          <Row label="City" value={vendor.city ?? "—"} />
          <Row label="State / region" value={vendor.stateRegion ?? "—"} />
          <Row label="Postal code" value={vendor.postalCode ?? "—"} />
          <Row label="Country" value={vendor.country ?? "—"} />
        </dl>
      </SectionCard>

      <SectionCard title="Commercial">
        <dl className="space-y-2.5 text-sm">
          <Row label="Payment terms" value={vendor.paymentTerms.replace(/_/g, " ")} />
          <Row label="Currency" value={vendor.preferredCurrency} />
          <Row label="Lead time" value={vendor.leadTimeDays ? `${vendor.leadTimeDays} days` : "—"} />
          <Row
            label="Minimum order"
            value={
              vendor.minimumOrderValue
                ? formatCompactCurrency(vendor.minimumOrderValue, vendor.preferredCurrency)
                : "—"
            }
          />
          <Row label="Website" value={vendor.website ?? "—"} />
          <Row label="Email" value={vendor.email || "—"} />
          <Row label="Phone" value={vendor.phone || "—"} />
        </dl>
      </SectionCard>
    </div>
  );
}

function ContactsTab({
  vendor,
  onDone,
  can,
}: {
  vendor: VendorDetail;
  onDone: () => Promise<void>;
  can: (a: string) => boolean;
}) {
  const addVendorContact = useStore((s) => s.addVendorContact);
  const removeVendorContact = useStore((s) => s.removeVendorContact);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    jobTitle: "",
    department: "",
    type: "GENERAL",
    isPrimary: false,
  });
  const [saving, setSaving] = useState(false);
  const editable = can("EDIT");

  const save = async () => {
    setSaving(true);
    const ok = await mutate(() => addVendorContact(vendor.id, form), {
      success: `${form.name} added`,
    });
    setSaving(false);
    if (ok !== null) {
      setAdding(false);
      setForm({ name: "", email: "", phone: "", jobTitle: "", department: "", type: "GENERAL", isPrimary: false });
      await onDone();
    }
  };

  return (
    <SectionCard
      title="Contacts"
      description="The named people at this supplier. Distinct from portal logins."
      action={
        editable && !adding ? (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
          >
            <Plus size={13} /> Add contact
          </button>
        ) : undefined
      }
    >
      {adding && (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
          <SmallField label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <div>
            <label className="text-xs font-medium text-muted-foreground">Contact type</label>
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GENERAL">General</SelectItem>
                <SelectItem value="SALES">Sales</SelectItem>
                <SelectItem value="FINANCE">Finance</SelectItem>
                <SelectItem value="OPERATIONS">Operations</SelectItem>
                <SelectItem value="ACCOUNT_MANAGER">Account manager</SelectItem>
                <SelectItem value="EXECUTIVE">Executive</SelectItem>
                <SelectItem value="TECHNICAL">Technical</SelectItem>
                <SelectItem value="SUPPORT">Support</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SmallField label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <SmallField label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <SmallField label="Job title" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} />
          <SmallField label="Department" value={form.department} onChange={(v) => setForm({ ...form, department: v })} />
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
            />
            Primary contact for this supplier
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button
              onClick={() => setAdding(false)}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || form.name.trim().length < 2}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save contact
            </button>
          </div>
        </div>
      )}

      {vendor.contacts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No contacts recorded. A supplier needs at least one before it can be submitted for approval.
        </p>
      ) : (
        <div className="space-y-2">
          {vendor.contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Avatar initials={initialsOf(c.name)} color="bg-sky-500" size="sm" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    {c.isPrimary && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        Primary
                      </span>
                    )}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {c.type.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {!c.isActive && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[c.jobTitle, c.department].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div>
              </div>
              {editable && (
                <button
                  onClick={async () => {
                    const ok = await mutate(() => removeVendorContact(vendor.id, c.id), {
                      success: `${c.name} removed`,
                    });
                    if (ok !== null) await onDone();
                  }}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-rose-600"
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ComplianceTab({
  vendor,
  onDone,
  nameOf,
  can,
}: {
  vendor: VendorDetail;
  onDone: () => Promise<void>;
  nameOf: (id?: string) => string;
  can: (a: string) => boolean;
}) {
  const addVendorRequirement = useStore((s) => s.addVendorRequirement);
  const removeVendorRequirement = useStore((s) => s.removeVendorRequirement);
  const decideVendorRequirement = useStore((s) => s.decideVendorRequirement);
  const manage = can("MANAGE_COMPLIANCE");

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ type: "BUSINESS_REGISTRATION", name: "", isMandatory: true, expiresAt: "" });
  const [deciding, setDeciding] = useState<VendorComplianceRequirement | null>(null);
  const [decision, setDecision] = useState<"VERIFIED" | "REJECTED" | "UNDER_REVIEW" | "WAIVED">("VERIFIED");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const mandatory = vendor.compliance.filter((c) => c.isMandatory);
  const satisfied = mandatory.filter((c) => c.status === "VERIFIED" || c.status === "WAIVED");

  return (
    <div className="space-y-6">
      <SectionCard
        title="Compliance"
        description="Each obligation is tracked separately with its own evidence and expiry. The overall state is derived from these — it is not a field anybody sets."
        action={
          manage && !adding ? (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              <Plus size={13} /> Add requirement
            </button>
          ) : undefined
        }
      >
        <div className="mb-4 flex items-center gap-4">
          <VendorComplianceBadge state={vendor.complianceState} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {mandatory.length > 0
                  ? `${satisfied.length} of ${mandatory.length} mandatory requirements satisfied`
                  : "No mandatory requirements configured"}
              </span>
              <span className="font-medium tabular-nums text-foreground">{vendor.complianceScore}%</span>
            </div>
            <ProgressBar value={vendor.complianceScore} size="sm" />
          </div>
        </div>

        {adding && (
          <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Requirement type</label>
              <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUSINESS_REGISTRATION">Business registration</SelectItem>
                  <SelectItem value="TAX_CLEARANCE">Tax clearance</SelectItem>
                  <SelectItem value="INSURANCE">Insurance</SelectItem>
                  <SelectItem value="CERTIFICATION">Certification</SelectItem>
                  <SelectItem value="INDUSTRY_LICENCE">Industry licence</SelectItem>
                  <SelectItem value="BANK_VERIFICATION">Bank verification</SelectItem>
                  <SelectItem value="DATA_PROTECTION">Data protection</SelectItem>
                  <SelectItem value="HEALTH_AND_SAFETY">Health and safety</SelectItem>
                  <SelectItem value="ANTI_BRIBERY">Anti-bribery</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SmallField
              label="Requirement name"
              required
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="e.g. Tax Clearance Certificate 2026"
            />
            <SmallField
              label="Expires on"
              type="date"
              value={form.expiresAt}
              onChange={(v) => setForm({ ...form, expiresAt: v })}
            />
            <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isMandatory}
                onChange={(e) => setForm({ ...form, isMandatory: e.target.checked })}
              />
              Mandatory — blocks compliance while outstanding
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button
                onClick={() => setAdding(false)}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSaving(true);
                  const ok = await mutate(
                    () =>
                      addVendorRequirement(vendor.id, {
                        ...form,
                        expiresAt: form.expiresAt || undefined,
                      }),
                    { success: "Requirement added" }
                  );
                  setSaving(false);
                  if (ok !== null) {
                    setAdding(false);
                    setForm({ type: "BUSINESS_REGISTRATION", name: "", isMandatory: true, expiresAt: "" });
                    await onDone();
                  }
                }}
                disabled={saving || form.name.trim().length < 2}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                Add requirement
              </button>
            </div>
          </div>
        )}

        {vendor.compliance.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No compliance requirements set for this supplier yet.
          </p>
        ) : (
          <div className="space-y-2">
            {vendor.compliance.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium text-foreground">{r.name}</p>
                      <ComplianceItemBadge status={r.status} />
                      {r.isMandatory && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Mandatory
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.type.replace(/_/g, " ").toLowerCase()}
                      {r.documentName ? ` · evidence: ${r.documentName}` : " · no evidence attached"}
                    </p>
                    {r.expiresAt && (
                      <p
                        className={cn(
                          "mt-0.5 text-xs",
                          (r.daysToExpiry ?? 999) < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : (r.daysToExpiry ?? 999) <= 30
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {(r.daysToExpiry ?? 0) < 0
                          ? `Expired ${formatDate(r.expiresAt)}`
                          : `Expires ${formatDate(r.expiresAt)} (${r.daysToExpiry} days)`}
                      </p>
                    )}
                    {r.reviewNotes && (
                      <p className="mt-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                        {r.reviewedById ? `${nameOf(r.reviewedById)}: ` : ""}
                        {r.reviewNotes}
                      </p>
                    )}
                    {r.waivedReason && (
                      <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
                        Waived by {nameOf(r.waivedById)} — {r.waivedReason}
                      </p>
                    )}
                  </div>
                  {manage && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        onClick={() => {
                          setDeciding(r);
                          setDecision("VERIFIED");
                          setNotes("");
                        }}
                        className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-muted"
                      >
                        Review
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await mutate(() => removeVendorRequirement(vendor.id, r.id), {
                            success: "Requirement removed",
                          });
                          if (ok !== null) await onDone();
                        }}
                        className="text-muted-foreground transition-colors hover:text-rose-600"
                        aria-label={`Remove ${r.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {deciding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Review “{deciding.name}”</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Verifying requires the evidence to be attached. A waiver records who set the requirement
              aside and why.
            </p>
            <div className="mt-4">
              <label className="text-xs font-medium text-muted-foreground">Decision</label>
              <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VERIFIED">Verified</SelectItem>
                  <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="WAIVED">Waived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium text-muted-foreground">
                Notes {decision === "WAIVED" && <span className="text-rose-500">*</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeciding(null)}
                className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSaving(true);
                  const ok = await mutate(
                    () => decideVendorRequirement(vendor.id, deciding.id, { decision, notes }),
                    { success: "Compliance updated" }
                  );
                  setSaving(false);
                  if (ok !== null) {
                    setDeciding(null);
                    await onDone();
                  }
                }}
                disabled={saving || (decision === "WAIVED" && notes.trim().length < 10)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsTab({
  vendor,
  onDone,
  nameOf,
  can,
}: {
  vendor: VendorDetail;
  onDone: () => Promise<void>;
  nameOf: (id?: string) => string;
  can: (a: string) => boolean;
}) {
  const addVendorDocument = useStore((s) => s.addVendorDocument);
  const verifyVendorDocument = useStore((s) => s.verifyVendorDocument);
  const removeVendorDocument = useStore((s) => s.removeVendorDocument);
  const manage = can("MANAGE_COMPLIANCE");

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    type: "CERTIFICATE",
    name: "",
    documentNumber: "",
    expiresAt: "",
    requirementId: "",
  });
  const [saving, setSaving] = useState(false);

  const unattached = vendor.compliance.filter((c) => !c.documentId);

  return (
    <SectionCard
      title="Documents"
      description="Supplier paperwork with its issue and expiry dates. A verified document is superseded by a replacement, never deleted."
      action={
        !adding ? (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
          >
            <Upload size={13} /> Record document
          </button>
        ) : undefined
      }
    >
      {adding && (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Document type</label>
            <Select value={form.type} onValueChange={(type) => setForm({ ...form, type })}>
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CERTIFICATE">Certificate</SelectItem>
                <SelectItem value="INSURANCE">Insurance</SelectItem>
                <SelectItem value="TAX">Tax</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="BANK_PROOF">Bank proof</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SmallField label="Document name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <SmallField
            label="Document number"
            value={form.documentNumber}
            onChange={(v) => setForm({ ...form, documentNumber: v })}
          />
          <SmallField
            label="Expires on"
            type="date"
            value={form.expiresAt}
            onChange={(v) => setForm({ ...form, expiresAt: v })}
          />
          {unattached.length > 0 && (
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                Attach to a compliance requirement
              </label>
              <Select
                value={form.requirementId || "NONE"}
                onValueChange={(v) => setForm({ ...form, requirementId: v === "NONE" ? "" : v })}
              >
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Not attached</SelectItem>
                  {unattached.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button
              onClick={() => setAdding(false)}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                const ok = await mutate(
                  () =>
                    addVendorDocument(vendor.id, {
                      type: form.type,
                      name: form.name,
                      documentNumber: form.documentNumber || undefined,
                      expiresAt: form.expiresAt || undefined,
                      requirementId: form.requirementId || undefined,
                    }),
                  { success: "Document recorded" }
                );
                setSaving(false);
                if (ok !== null) {
                  setAdding(false);
                  setForm({ type: "CERTIFICATE", name: "", documentNumber: "", expiresAt: "", requirementId: "" });
                  await onDone();
                }
              }}
              disabled={saving || form.name.trim().length < 2}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {vendor.documents.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No documents on file for this supplier.
        </p>
      ) : (
        <div className="space-y-2">
          {vendor.documents.map((d) => (
            <DocumentRow
              key={d.id}
              doc={d}
              nameOf={nameOf}
              manage={manage}
              onVerify={async (decision, reason) => {
                const ok = await mutate(() => verifyVendorDocument(vendor.id, d.id, decision, reason), {
                  success: decision === "VERIFIED" ? "Document verified" : "Document rejected",
                });
                if (ok !== null) await onDone();
              }}
              onRemove={async () => {
                const ok = await mutate(() => removeVendorDocument(vendor.id, d.id), {
                  success: "Document removed",
                });
                if (ok !== null) await onDone();
              }}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function DocumentRow({
  doc,
  nameOf,
  manage,
  onVerify,
  onRemove,
}: {
  doc: VendorDocument;
  nameOf: (id?: string) => string;
  manage: boolean;
  onVerify: (decision: "VERIFIED" | "REJECTED", reason?: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const tone =
    doc.status === "EXPIRED"
      ? "text-rose-600 dark:text-rose-400"
      : doc.status === "EXPIRING"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <FileText size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">{doc.name}</p>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  doc.status === "VALID" &&
                    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
                  doc.status === "EXPIRING" &&
                    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
                  doc.status === "EXPIRED" &&
                    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
                  doc.status === "PENDING_REVIEW" && "border-border bg-muted text-muted-foreground"
                )}
              >
                {doc.status.replace(/_/g, " ").toLowerCase()}
              </span>
              {doc.version > 1 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  v{doc.version}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doc.type.replace(/_/g, " ").toLowerCase()}
              {doc.documentNumber ? ` · ${doc.documentNumber}` : ""}
              {" · uploaded "}
              {formatDate(doc.uploadedAt)}
              {doc.uploadedById ? ` by ${nameOf(doc.uploadedById)}` : ""}
            </p>
            {doc.expiresAt && (
              <p className={cn("mt-0.5 text-xs", tone)}>
                {(doc.daysToExpiry ?? 0) < 0
                  ? `Expired ${formatDate(doc.expiresAt)}`
                  : `Expires ${formatDate(doc.expiresAt)} (${doc.daysToExpiry} days)`}
              </p>
            )}
            {doc.verifiedAt && (
              <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                Verified {formatDate(doc.verifiedAt)} by {nameOf(doc.verifiedById)}
              </p>
            )}
            {doc.rejectedReason && (
              <p className="mt-1 rounded-md bg-rose-50/60 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/20 dark:text-rose-300">
                Rejected — {doc.rejectedReason}
              </p>
            )}
          </div>
        </div>
        {manage && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!doc.verifiedAt && (
              <>
                <button
                  onClick={() => void onVerify("VERIFIED")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
                >
                  <CheckCircle2 size={12} /> Verify
                </button>
                <button
                  onClick={() => setRejecting((v) => !v)}
                  className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-muted"
                >
                  Reject
                </button>
                <button
                  onClick={() => void onRemove()}
                  className="text-muted-foreground transition-colors hover:text-rose-600"
                  aria-label={`Remove ${doc.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this document not accepted?"
            className="h-8 flex-1 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={async () => {
              await onVerify("REJECTED", reason);
              setRejecting(false);
              setReason("");
            }}
            disabled={reason.trim().length === 0}
            className="inline-flex h-8 items-center rounded-lg bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function PerformanceTab({ vendor }: { vendor: VendorDetail }) {
  if (vendor.performance.length === 0) {
    return (
      <SectionCard title="Performance">
        <EmptyState
          icon={Activity}
          title="No performance data yet"
          description="Supplier performance is computed from goods receipts, invoices and payments — it is not entered by hand. Figures appear here once this supplier has delivered against a purchase order."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Performance"
      description="Computed from receipts, invoices and payments. Never entered manually."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 text-left font-semibold">Period</th>
              <th className="py-2 text-right font-semibold">Orders</th>
              <th className="py-2 text-right font-semibold">Receipts</th>
              <th className="py-2 text-right font-semibold">On time</th>
              <th className="py-2 text-right font-semibold">Quality</th>
              <th className="py-2 text-right font-semibold">Disputes</th>
              <th className="py-2 text-right font-semibold">Spend</th>
            </tr>
          </thead>
          <tbody>
            {vendor.performance.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="py-2.5 text-foreground">
                  {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                </td>
                <td className="py-2.5 text-right tabular-nums">{p.ordersCount}</td>
                <td className="py-2.5 text-right tabular-nums">{p.receiptsCount}</td>
                <td className="py-2.5 text-right tabular-nums">{Math.round(p.onTimeRate)}%</td>
                <td className="py-2.5 text-right tabular-nums">{Math.round(p.qualityRate)}%</td>
                <td className="py-2.5 text-right tabular-nums">{p.disputeCount}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatCompactCurrency(p.totalSpend, vendor.preferredCurrency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function RiskTab({
  vendor,
  onDone,
  nameOf,
  can,
}: {
  vendor: VendorDetail;
  onDone: () => Promise<void>;
  nameOf: (id?: string) => string;
  can: (a: string) => boolean;
}) {
  const assessVendorRisk = useStore((s) => s.assessVendorRisk);
  const allowed = can("ASSESS_RISK");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ level: "LOW", score: 20, summary: "", nextReviewAt: "" });
  const [saving, setSaving] = useState(false);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Risk"
        description="A dated, attributed judgement. Earlier assessments are kept so a decision taken under an old rating stays explicable."
        action={
          allowed && !open ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              <Plus size={13} /> Record assessment
            </button>
          ) : undefined
        }
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Current level"
            value={vendor.riskLevel.toLowerCase()}
            icon={Gauge}
            sublabel={vendor.riskStatus.replace(/_/g, " ").toLowerCase()}
          />
          <StatTile
            label="Score"
            value={vendor.riskScore !== undefined ? `${vendor.riskScore}/100` : "—"}
            icon={Gauge}
            sublabel={vendor.riskReviewedAt ? `Reviewed ${formatDate(vendor.riskReviewedAt)}` : "Never"}
          />
          <StatTile
            label="Next review"
            value={vendor.riskNextReviewAt ? formatDate(vendor.riskNextReviewAt) : "Not scheduled"}
            icon={CalendarClock}
          />
        </div>

        {open && (
          <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Risk level</label>
              <Select value={form.level} onValueChange={(level) => setForm({ ...form, level })}>
                <SelectTrigger className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SmallField
              label="Score (0–100)"
              type="number"
              value={String(form.score)}
              onChange={(v) => setForm({ ...form, score: Math.max(0, Math.min(100, Number(v) || 0)) })}
            />
            <SmallField
              label="Next review date"
              type="date"
              value={form.nextReviewAt}
              onChange={(v) => setForm({ ...form, nextReviewAt: v })}
            />
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Summary</label>
              <textarea
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
                rows={3}
                placeholder="What drives this rating — concentration, delivery record, financial standing, compliance?"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button
                onClick={() => setOpen(false)}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSaving(true);
                  const ok = await mutate(
                    () =>
                      assessVendorRisk(vendor.id, {
                        level: form.level,
                        score: form.score,
                        summary: form.summary || undefined,
                        nextReviewAt: form.nextReviewAt || undefined,
                      }),
                    { success: "Risk assessment recorded" }
                  );
                  setSaving(false);
                  if (ok !== null) {
                    setOpen(false);
                    await onDone();
                  }
                }}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                Save assessment
              </button>
            </div>
          </div>
        )}

        {vendor.riskAssessments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This supplier has never been assessed.
          </p>
        ) : (
          <div className="space-y-2">
            {vendor.riskAssessments.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <VendorRiskBadge level={a.level} />
                    <span className="text-sm font-medium tabular-nums text-foreground">{a.score}/100</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {nameOf(a.assessedById)} · {formatDate(a.assessedAt)}
                  </span>
                </div>
                {a.summary && <p className="mt-2 text-sm text-muted-foreground">{a.summary}</p>}
                {a.nextReviewAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Next review {formatDate(a.nextReviewAt)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function NotesTab({
  vendor,
  onDone,
  nameOf,
  currentUserId,
}: {
  vendor: VendorDetail;
  onDone: () => Promise<void>;
  nameOf: (id?: string) => string;
  currentUserId: string;
}) {
  const addVendorNote = useStore((s) => s.addVendorNote);
  const removeVendorNote = useStore((s) => s.removeVendorNote);
  const hasPermission = useStore((s) => s.hasPermission);
  const canWrite = hasPermission("vendors.notes");

  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"INTERNAL" | "RESTRICTED">("INTERNAL");
  const [saving, setSaving] = useState(false);

  return (
    <SectionCard
      title="Internal notes"
      description="Buyer-side only. Nothing here is ever shown to a supplier through the portal."
    >
      {canWrite && (
        <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What should a colleague know about this supplier?"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-2">
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL">Visible to anyone who can see vendors</SelectItem>
                <SelectItem value="RESTRICTED">Restricted to vendor approvers</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={async () => {
                setSaving(true);
                const ok = await mutate(() => addVendorNote(vendor.id, body, visibility), {
                  success: "Note added",
                });
                setSaving(false);
                if (ok !== null) {
                  setBody("");
                  await onDone();
                }
              }}
              disabled={saving || body.trim().length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Add note
            </button>
          </div>
        </div>
      )}

      {vendor.internalNotes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No internal notes yet.</p>
      ) : (
        <div className="space-y-2">
          {vendor.internalNotes.map((n) => (
            <div key={n.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare size={12} className="text-muted-foreground" />
                    <p className="text-xs font-medium text-foreground">{nameOf(n.authorId)}</p>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(n.createdAt)}</span>
                    {n.visibility === "RESTRICTED" && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        Restricted
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                </div>
                {canWrite && n.authorId === currentUserId && (
                  <button
                    onClick={async () => {
                      const ok = await mutate(() => removeVendorNote(vendor.id, n.id), {
                        success: "Note removed",
                      });
                      if (ok !== null) await onDone();
                    }}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-rose-600"
                    aria-label="Remove note"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ActivityTab({
  vendor,
  nameOf,
}: {
  vendor: VendorDetail;
  nameOf: (id?: string) => string;
}) {
  return (
    <SectionCard
      title="Activity"
      description="Read from the platform's audit and activity log — not a separate feed maintained for this page."
    >
      {vendor.activity.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <div className="space-y-0">
          {vendor.activity.map((a, i) => (
            <div key={a.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    a.severity === "CRITICAL"
                      ? "bg-rose-500"
                      : a.severity === "WARNING"
                        ? "bg-amber-500"
                        : a.severity === "SUCCESS"
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/40"
                  )}
                />
                {i < vendor.activity.length - 1 && <div className="w-px flex-1 bg-border" />}
              </div>
              <div className="min-w-0 flex-1 pb-4">
                <p className="text-sm text-foreground">{a.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.eventType.replace(/_/g, " ").toLowerCase()} · {formatRelativeTime(a.createdAt)}
                  {a.userId ? ` · ${nameOf(a.userId)}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function Line({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{value}</span>
    </div>
  );
}

function SmallField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
