// NextMav Procure — Executive Command Center
// Decision-focused operational nerve center. Answers: "What requires executive attention right now?"

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Package,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { Avatar, ContractStatusBadge, KpiCard, PageHeader, PriorityBadge, ProgressBar, SectionCard, StatusBadge } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ActionItem {
  id: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM";
  category: string;
  title: string;
  description: string;
  impact: string;
  action: () => void;
  actionLabel: string;
  icon: LucideIcon;
}

export function CommandCenterView() {
  const navigate = useStore((s) => s.navigate);
  const requests = useStore((s) => s.requests);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const vendors = useStore((s) => s.vendors);
  const contracts = useStore((s) => s.contracts);
  const invoices = useStore((s) => s.invoices);
  const budgets = useStore((s) => s.budgets);
  const activities = useStore((s) => s.activities);
  const departments = useStore((s) => s.departments);
  const users = useStore((s) => s.users);

  // Critical action items — things requiring executive attention
  const actionItems: ActionItem[] = [];

  // SLA breaches
  requests.filter((r) => r.approvals.some((a) => a.decision === "PENDING" && new Date(a.slaExpiresAt) < new Date())).forEach((r) => {
    actionItems.push({
      id: `sla-${r.id}`,
      priority: "CRITICAL",
      category: "SLA Breach",
      title: `${r.requestNumber} — SLA breached`,
      description: r.title,
      impact: `${formatCurrency(r.totalEstimated)} commitment delayed — pending ${r.approvals.find((a) => a.decision === "PENDING")?.stage.replace("_", " ").toLowerCase()} approval`,
      action: () => { useStore.getState().selectRequest(r.id); navigate("request-detail"); },
      actionLabel: "Review & Approve",
      icon: AlertTriangle,
    });
  });

  // High-value purchases awaiting approval
  requests.filter((r) => r.totalEstimated > 25000 && r.approvals.some((a) => a.decision === "PENDING")).forEach((r) => {
    actionItems.push({
      id: `hv-${r.id}`,
      priority: "HIGH",
      category: "High-Value Approval",
      title: `${r.requestNumber} — ${formatCompactCurrency(r.totalEstimated)} pending`,
      description: r.title,
      impact: `High-value purchase requires executive sign-off. Department: ${departments.find((d) => d.id === r.departmentId)?.name ?? "N/A"}`,
      action: () => { useStore.getState().selectRequest(r.id); navigate("request-detail"); },
      actionLabel: "Review",
      icon: DollarSign,
    });
  });

  // Budget overruns
  budgets.filter((b) => b.spentAmount / b.totalAmount > 0.9).forEach((b) => {
    const dept = departments.find((d) => d.id === b.departmentId);
    actionItems.push({
      id: `budget-${b.id}`,
      priority: b.spentAmount / b.totalAmount > 1 ? "CRITICAL" : "HIGH",
      category: "Budget Overrun",
      title: `${dept?.name ?? "Department"} — ${Math.round((b.spentAmount / b.totalAmount) * 100)}% budget utilized`,
      description: `${formatCurrency(b.spentAmount)} spent of ${formatCurrency(b.totalAmount)} — only ${formatCurrency(b.remainingAmount)} remaining`,
      impact: `Further purchases will exceed the approved annual budget for ${dept?.name}`,
      action: () => navigate("budgets"),
      actionLabel: "Review Budget",
      icon: Wallet,
    });
  });

  // Overdue invoices
  invoices.filter((i) => i.status === "OVERDUE").forEach((inv) => {
    const vendor = vendors.find((v) => v.id === inv.vendorId);
    actionItems.push({
      id: `inv-${inv.id}`,
      priority: "HIGH",
      category: "Overdue Payment",
      title: `${inv.invoiceNumber} — ${formatCompactCurrency(inv.balance)} overdue`,
      description: `Payment to ${vendor?.companyName} is past due`,
      impact: `Potential late payment penalties and damaged supplier relationship`,
      action: () => navigate("invoices"),
      actionLabel: "Process Payment",
      icon: DollarSign,
    });
  });

  // Late deliveries
  purchaseOrders.filter((p) => (p.status === "ISSUED" || p.status === "ACKNOWLEDGED") && new Date(p.expectedDelivery) < new Date()).forEach((po) => {
    const vendor = vendors.find((v) => v.id === po.vendorId);
    actionItems.push({
      id: `late-${po.id}`,
      priority: "HIGH",
      category: "Late Delivery",
      title: `${po.poNumber} — delivery overdue`,
      description: `${vendor?.companyName} — ${formatCompactCurrency(po.totalAmount)} order`,
      impact: `Expected ${formatRelativeTime(po.expectedDelivery)} — may impact downstream operations`,
      action: () => { useStore.getState().selectPo(po.id); navigate("po-detail"); },
      actionLabel: "Contact Vendor",
      icon: Package,
    });
  });

  // Expiring contracts
  contracts.filter((c) => c.status === "EXPIRING" || (c.status === "ACTIVE" && new Date(c.endDate) < new Date(Date.now() + 30 * 86400000))).forEach((c) => {
    const vendor = vendors.find((v) => v.id === c.vendorId);
    const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000);
    actionItems.push({
      id: `contract-${c.id}`,
      priority: daysLeft < 7 ? "CRITICAL" : "HIGH",
      category: "Contract Expiry",
      title: `${c.contractNumber} — ${daysLeft < 0 ? "expired" : `${daysLeft}d left`}`,
      description: `${c.title} with ${vendor?.companyName}`,
      impact: `Contract value: ${formatCompactCurrency(c.value)} — ${c.autoRenew ? "auto-renews" : "will terminate"} ${daysLeft < 0 ? "already" : "soon"}`,
      action: () => navigate("contracts"),
      actionLabel: c.autoRenew ? "Review Terms" : "Initiate Renewal",
      icon: FileText,
    });
  });

  // Vendor compliance risks
  vendors.filter((v) => v.documents.some((d) => d.status === "EXPIRED") && v.status === "ACTIVE").forEach((v) => {
    const expiredDocs = v.documents.filter((d) => d.status === "EXPIRED");
    actionItems.push({
      id: `vendor-${v.id}`,
      priority: "MEDIUM",
      category: "Compliance Risk",
      title: `${v.companyName} — ${expiredDocs.length} expired document(s)`,
      description: expiredDocs.map((d) => d.name).join(", "),
      impact: `Active vendor with expired compliance documents — risk of regulatory non-compliance`,
      action: () => { useStore.getState().selectVendor(v.id); navigate("vendor-detail"); },
      actionLabel: "Request Update",
      icon: Users,
    });
  });

  // Sort by priority
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  actionItems.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const criticalCount = actionItems.filter((a) => a.priority === "CRITICAL").length;
  const highCount = actionItems.filter((a) => a.priority === "HIGH").length;
  const mediumCount = actionItems.filter((a) => a.priority === "MEDIUM").length;

  // Strategic KPIs
  const totalSpend = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
  const pendingApprovals = requests.filter((r) => r.approvals.some((a) => a.decision === "PENDING") && (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW")).length;
  const outstandingPayables = invoices.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED").reduce((s, i) => s + i.balance, 0);
  const totalBudgetUtilization = budgets.length > 0 ? (budgets.reduce((s, b) => s + b.spentAmount, 0) / budgets.reduce((s, b) => s + b.totalAmount, 0)) * 100 : 0;
  const activeContractsValue = contracts.filter((c) => c.status === "ACTIVE").reduce((s, c) => s + c.value, 0);

  // Department risk indicators
  const deptRisk = departments.map((d) => {
    const budget = budgets.find((b) => b.departmentId === d.id);
    const utilPct = budget ? (budget.spentAmount / budget.totalAmount) * 100 : 0;
    const pendingReqs = requests.filter((r) => r.departmentId === d.id && (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW")).length;
    return {
      name: d.name,
      utilPct: Math.round(utilPct),
      pendingReqs,
      risk: utilPct > 90 ? "CRITICAL" : utilPct > 75 ? "HIGH" : pendingReqs > 3 ? "MEDIUM" : "LOW",
    };
  }).sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return order[a.risk as keyof typeof order] - order[b.risk as keyof typeof order];
  });

  // 7-day trend
  const trendData = [
    { day: "Mon", spend: 12500, actions: 8 },
    { day: "Tue", spend: 8200, actions: 12 },
    { day: "Wed", spend: 18900, actions: 6 },
    { day: "Thu", spend: 6400, actions: 9 },
    { day: "Fri", spend: 22100, actions: 14 },
    { day: "Sat", spend: 3200, actions: 3 },
    { day: "Sun", spend: 1800, actions: 2 },
  ];

  // Recent major activities (executive-level only)
  const majorActivities = activities.filter((a) => a.severity === "CRITICAL" || a.severity === "SUCCESS" || a.eventType.includes("PO_GENERATED") || a.eventType.includes("APPROVED") || a.eventType.includes("BLACKLISTED")).slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Command Center"
        description="Operational nerve center — what requires your attention right now."
        actions={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
            <button
              onClick={() => navigate("ai-assistant")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Sparkles size={14} /> Ask AI
            </button>
          </div>
        }
      />

      {/* Action Required Banner */}
      {actionItems.length > 0 ? (
        <div className={cn(
          "rounded-xl border p-5",
          criticalCount > 0
            ? "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/20"
            : "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20"
        )}>
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
              criticalCount > 0 ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" : "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
            )}>
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-foreground">
                {actionItems.length} item{actionItems.length !== 1 ? "s" : ""} require executive attention
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {criticalCount > 0 && <span className="text-rose-600 dark:text-rose-400 font-medium">{criticalCount} critical</span>}
                {criticalCount > 0 && highCount > 0 && <span className="text-muted-foreground"> · </span>}
                {highCount > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{highCount} high priority</span>}
                {(criticalCount > 0 || highCount > 0) && mediumCount > 0 && <span className="text-muted-foreground"> · </span>}
                {mediumCount > 0 && <span className="text-muted-foreground font-medium">{mediumCount} medium</span>}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-foreground">All clear</h2>
              <p className="text-sm text-muted-foreground mt-0.5">No critical items require executive attention at this time.</p>
            </div>
          </div>
        </div>
      )}

      {/* Priority Actions List — the core of the Command Center */}
      <SectionCard
        title="Priority Actions"
        description="Decisions and exceptions requiring your attention — sorted by urgency"
      >
        <div className="space-y-2">
          {actionItems.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500" />
              <p className="mt-3 text-sm font-medium text-foreground">No pending actions</p>
              <p className="text-xs text-muted-foreground mt-0.5">All workflows are on track</p>
            </div>
          ) : (
            actionItems.slice(0, 8).map((item) => (
              <button
                key={item.id}
                onClick={item.action}
                className="w-full flex items-start gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/30 hover:border-emerald-300 transition-all text-left group"
              >
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                  item.priority === "CRITICAL" && "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
                  item.priority === "HIGH" && "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
                  item.priority === "MEDIUM" && "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"
                )}>
                  <item.icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                      item.priority === "CRITICAL" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                      item.priority === "HIGH" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                      item.priority === "MEDIUM" && "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                    )}>
                      {item.priority}
                    </span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{item.category}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  <p className="text-xs text-foreground mt-1.5">{item.impact}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 group-hover:underline">
                    {item.actionLabel}
                  </span>
                  <ArrowRight size={12} className="text-emerald-600 dark:text-emerald-400 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))
          )}
        </div>
      </SectionCard>

      {/* Strategic KPIs — executive-level, not operational stats */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Strategic KPIs</h3>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Spend YTD" value={formatCompactCurrency(totalSpend)} delta="+18.2%" deltaType="up" hint="vs last year" icon={DollarSign} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
          <KpiCard label="Budget Utilization" value={`${totalBudgetUtilization.toFixed(1)}%`} delta={totalBudgetUtilization > 75 ? "Above target" : "On track"} deltaType={totalBudgetUtilization > 75 ? "down" : "up"} icon={Wallet} iconBg="bg-amber-100 dark:bg-amber-950/40" />
          <KpiCard label="Outstanding Payables" value={formatCompactCurrency(outstandingPayables)} delta={`${invoices.filter((i) => i.status === "OVERDUE").length} overdue`} deltaType={invoices.some((i) => i.status === "OVERDUE") ? "down" : "neutral"} icon={TrendingDown} iconBg="bg-rose-100 dark:bg-rose-950/40" />
          <KpiCard label="Active Contracts" value={formatCompactCurrency(activeContractsValue)} delta={`${contracts.filter((c) => c.status === "ACTIVE").length} active`} deltaType="neutral" icon={FileText} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        </div>
      </div>

      {/* Department Risk & AI Recommendations */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Department Risk Indicators */}
        <SectionCard title="Department Risk Indicators" description="Budget and workflow risk by department">
          <div className="space-y-2">
            {deptRisk.slice(0, 6).map((d) => (
              <div key={d.name} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                  d.risk === "CRITICAL" && "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
                  d.risk === "HIGH" && "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
                  d.risk === "MEDIUM" && "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400",
                  d.risk === "LOW" && "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                )}>
                  <AlertTriangle size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{d.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <ProgressBar value={d.utilPct} size="sm" color={d.utilPct > 90 ? "bg-rose-500" : d.utilPct > 75 ? "bg-amber-500" : "bg-emerald-500"} />
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{d.utilPct}%</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                    d.risk === "CRITICAL" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                    d.risk === "HIGH" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                    d.risk === "MEDIUM" && "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
                    d.risk === "LOW" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  )}>
                    {d.risk}
                  </span>
                  {d.pendingReqs > 0 && <p className="text-[10px] text-muted-foreground mt-0.5">{d.pendingReqs} pending</p>}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* AI Recommendations */}
        <SectionCard
          title="AI Strategic Recommendations"
          description="Generated from operational data analysis"
          action={
            <button onClick={() => navigate("ai-assistant")} className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-0.5">
              Full analysis <ArrowRight size={12} />
            </button>
          }
        >
          <div className="space-y-3">
            {(() => {
              const recs: { type: string; icon: LucideIcon; color: string; title: string; desc: string }[] = [];
              // Vendor consolidation
              const categories = vendors.filter((v) => v.totalValue > 0).reduce((acc, v) => {
                acc[v.category] = (acc[v.category] ?? 0) + 1;
                return acc;
              }, {} as Record<string, number>);
              const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
              if (topCategory && topCategory[1] > 2) {
                recs.push({
                  type: "Cost Saving",
                  icon: TrendingDown,
                  color: "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/15",
                  title: `Consolidate ${topCategory[1]} ${topCategory[0]} vendors`,
                  desc: `Consolidating to 2-3 strategic partners could yield 8-12% volume discounts — estimated annual savings of ${formatCompactCurrency(totalSpend * 0.08)}`,
                });
              }
              // SLA performance
              if (pendingApprovals > 0) {
                recs.push({
                  type: "Operational",
                  icon: Clock,
                  color: "border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/15",
                  title: `${pendingApprovals} approvals pending`,
                  desc: "Consider delegating approval authority for low-value requests to reduce bottleneck at executive level",
                });
              }
              // Contract renewal
              const expiringCount = contracts.filter((c) => c.status === "EXPIRING" || (c.status === "ACTIVE" && new Date(c.endDate) < new Date(Date.now() + 60 * 86400000))).length;
              if (expiringCount > 0) {
                recs.push({
                  type: "Strategic",
                  icon: FileText,
                  color: "border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/15",
                  title: `${expiringCount} contracts expiring within 60 days`,
                  desc: "Initiate renewal negotiations now to secure favorable terms before expiry",
                });
              }
              // Budget risk
              if (totalBudgetUtilization > 70) {
                recs.push({
                  type: "Financial",
                  icon: Wallet,
                  color: "border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/15",
                  title: `Budget utilization at ${totalBudgetUtilization.toFixed(0)}%`,
                  desc: "Review discretionary spending — projected to exceed annual budget if current rate continues",
                });
              }
              return recs.length > 0 ? recs.map((r, i) => (
                <div key={i} className={cn("rounded-lg border p-3", r.color)}>
                  <div className="flex items-start gap-2.5">
                    <r.icon size={15} className="shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-foreground">{r.title}</p>
                        <span className="text-[10px] text-muted-foreground bg-card px-1.5 py-0.5 rounded">{r.type}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r.desc}</p>
                    </div>
                  </div>
                </div>
              )) : <p className="text-sm text-muted-foreground text-center py-4">No recommendations — operations running smoothly</p>;
            })()}
          </div>
        </SectionCard>
      </div>

      {/* Operational Timeline & Weekly Spend */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Operational Timeline"
          description="Major procurement events in the last 7 days"
        >
          <div className="divide-y divide-border">
            {majorActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No major events</p>
            ) : (
              majorActivities.map((a) => {
                const user = users.find((u) => u.id === a.userId);
                return (
                  <div key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                      a.severity === "CRITICAL" && "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
                      a.severity === "SUCCESS" && "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
                      a.severity === "WARNING" && "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
                      a.severity === "INFO" && "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"
                    )}>
                      {a.severity === "SUCCESS" ? <CheckCircle2 size={14} /> : a.severity === "CRITICAL" ? <AlertTriangle size={14} /> : <Clock size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{a.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{user?.name ?? "System"} · {formatRelativeTime(a.createdAt)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>

        <SectionCard title="Weekly Spend" description="Last 7 days">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="ccWeekGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                <XAxis dataKey="day" stroke="oklch(0.55 0.02 160)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.55 0.02 160)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }} formatter={(v: number) => formatCurrency(v)} />
                <Area type="monotone" dataKey="spend" stroke="#10b981" strokeWidth={2} fill="url(#ccWeekGrad)" dot={{ fill: "#10b981", r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Week total</span>
              <span className="font-semibold text-foreground tabular-nums">{formatCurrency(trendData.reduce((s, d) => s + d.spend, 0))}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1">
              <span className="text-muted-foreground">Avg daily</span>
              <span className="font-medium text-foreground tabular-nums">{formatCurrency(trendData.reduce((s, d) => s + d.spend, 0) / 7)}</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
