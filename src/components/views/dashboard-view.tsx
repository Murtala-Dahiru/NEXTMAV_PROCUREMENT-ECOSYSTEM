// NextMav Procure — Executive Dashboard

"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileText,
  GitBranch,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { Avatar, KpiCard, PageHeader, PriorityBadge, SectionCard, StatusBadge } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatRelativeTime } from "@/lib/format";

export function DashboardView() {
  const navigate = useStore((s) => s.navigate);
  const requests = useStore((s) => s.requests);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const activities = useStore((s) => s.activities);
  const departments = useStore((s) => s.departments);
  const users = useStore((s) => s.users);

  // KPIs
  const pendingRequests = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW").length;
  const pendingApprovals = requests.filter((r) => r.approvals.some((a) => a.decision === "PENDING") && (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW")).length;
  const activeVendors = vendors.filter((v) => v.status === "ACTIVE").length;
  const totalSpend = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
  const monthlySpend = purchaseOrders
    .filter((p) => new Date(p.issuedAt).getMonth() === new Date().getMonth())
    .reduce((s, p) => s + p.totalAmount, 0);
  const requestsThisWeek = requests.filter((r) => {
    const created = new Date(r.createdAt);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created >= weekAgo;
  }).length;

  // Avg approval time (simulated based on approvals)
  const completedApprovals = requests.flatMap((r) => r.approvals).filter((a) => a.decision === "APPROVED" && a.decidedAt);
  const avgApprovalHrs = completedApprovals.length > 0
    ? completedApprovals.reduce((s, a) => {
        const dur = new Date(a.decidedAt!).getTime() - new Date(a.createdAt).getTime();
        return s + dur / (1000 * 60 * 60);
      }, 0) / completedApprovals.length
    : 0;

  // Charts
  const monthlyTrend = [
    { month: "Aug", spend: 42500, requests: 12 },
    { month: "Sep", spend: 58200, requests: 18 },
    { month: "Oct", spend: 71800, requests: 22 },
    { month: "Nov", spend: 64300, requests: 19 },
    { month: "Dec", spend: 89100, requests: 28 },
    { month: "Jan", spend: 102500, requests: 31 },
    { month: "Feb", spend: 38500, requests: 14 },
  ];

  const deptSpend = departments
    .map((d) => ({
      name: d.name.split(" ")[0],
      fullName: d.name,
      spend: d.spent,
      budget: d.budget,
      pct: Math.round((d.spent / d.budget) * 100),
    }))
    .sort((a, b) => b.spend - a.spend);

  const vendorDistribution = vendors
    .filter((v) => v.totalValue > 0)
    .map((v) => ({ name: v.companyName, value: v.totalValue }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const otherVendorValue = vendors
    .filter((v) => v.totalValue > 0)
    .slice(5)
    .reduce((s, v) => s + v.totalValue, 0);
  if (otherVendorValue > 0) vendorDistribution.push({ name: "Others", value: otherVendorValue });

  const PIE_COLORS = ["#10b981", "#f59e0b", "#0ea5e9", "#a855f7", "#f43f5e", "#64748b"];

  // Recent activity (top 6)
  const recentActivity = activities.slice(0, 6);

  // Recent requests (top 5)
  const recentRequests = [...requests]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Overview"
        description="Real-time snapshot of procurement activity, spend, and approvals across your organization."
        actions={
          <button
            onClick={() => navigate("request-new")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 h-9 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New Request</span>
          </button>
        }
      />

      {/* KPI Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pending Approvals"
          value={pendingApprovals}
          delta={pendingApprovals > 0 ? "Action needed" : "All clear"}
          deltaType={pendingApprovals > 0 ? "down" : "up"}
          icon={ClipboardCheck}
          iconBg="bg-amber-100 dark:bg-amber-950/40"
        />
        <KpiCard
          label="Monthly Spend"
          value={formatCurrency(monthlySpend)}
          delta="+18.2%"
          deltaType="up"
          hint="vs last month"
          icon={DollarSign}
          iconBg="bg-emerald-100 dark:bg-emerald-950/40"
        />
        <KpiCard
          label="Active Vendors"
          value={activeVendors}
          delta={`${vendors.filter(v => v.status === "PROSPECTIVE").length} prospective`}
          deltaType="neutral"
          icon={Users}
          iconBg="bg-sky-100 dark:bg-sky-950/40"
        />
        <KpiCard
          label="Avg Approval Time"
          value={`${avgApprovalHrs.toFixed(1)}h`}
          delta="-32%"
          deltaType="up"
          hint="vs last month"
          icon={Clock}
          iconBg="bg-violet-100 dark:bg-violet-950/40"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pending Requests" value={pendingRequests} icon={FileText} iconBg="bg-orange-100 dark:bg-orange-950/40" />
        <KpiCard label="Total Spend YTD" value={formatCompactCurrency(totalSpend)} icon={TrendingUp} iconBg="bg-teal-100 dark:bg-teal-950/40" />
        <KpiCard label="Purchase Orders" value={purchaseOrders.length} icon={Package} iconBg="bg-rose-100 dark:bg-rose-950/40" />
        <KpiCard label="Requests This Week" value={requestsThisWeek} icon={Activity} iconBg="bg-amber-100 dark:bg-amber-950/40" />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Spend trend */}
        <SectionCard
          className="lg:col-span-2"
          title="Spend Trend"
          description="Monthly procurement spend over the last 7 months"
          action={
            <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <TrendingUp size={13} />
              +18.2%
            </div>
          }
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                <XAxis dataKey="month" stroke="oklch(0.55 0.02 160)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="oklch(0.55 0.02 160)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "oklch(1 0 0)",
                    border: "1px solid oklch(0.92 0.008 150)",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                  formatter={(v: number) => [formatCurrency(v), "Spend"]}
                />
                <Area
                  type="monotone"
                  dataKey="spend"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  fill="url(#spendGrad)"
                  dot={{ fill: "#10b981", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Vendor distribution */}
        <SectionCard
          title="Vendor Distribution"
          description="Top vendors by total spend"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={vendorDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {vendorDistribution.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "oklch(1 0 0)",
                    border: "1px solid oklch(0.92 0.008 150)",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Department spend + Recent activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Department Spend"
          description="Budget utilization across all departments"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptSpend} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                <XAxis dataKey="name" stroke="oklch(0.55 0.02 160)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="oklch(0.55 0.02 160)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "oklch(1 0 0)",
                    border: "1px solid oklch(0.92 0.008 150)",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  formatter={(v: number, n: string) => [formatCurrency(v), n === "spend" ? "Spent" : "Budget"]}
                  labelFormatter={(l) => deptSpend.find((d) => d.name === l)?.fullName}
                />
                <Bar dataKey="budget" fill="oklch(0.92 0.01 150)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spend" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Activity"
          description="Latest procurement events"
          action={
            <button
              onClick={() => navigate("activity")}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-0.5"
            >
              View all <ArrowUpRight size={12} />
            </button>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {recentActivity.map((a) => {
              const user = users.find((u) => u.id === a.userId);
              return (
                <div key={a.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground leading-snug">{a.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {user?.name ?? "System"} · {formatRelativeTime(a.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* Recent requests */}
      <SectionCard
        title="Recent Purchase Requests"
        description="Most recently updated requests across your organization"
        action={
          <button
            onClick={() => navigate("requests")}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-0.5"
          >
            View all <ArrowUpRight size={12} />
          </button>
        }
        bodyClassName="p-0"
      >
        <div className="divide-y divide-border">
          <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            <div className="col-span-5">Request</div>
            <div className="col-span-2">Requester</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Value</div>
          </div>
          {recentRequests.map((r) => {
            const requester = users.find((u) => u.id === r.requestedById);
            return (
              <button
                key={r.id}
                onClick={() => {
                  useStore.getState().selectRequest(r.id);
                  navigate("request-detail");
                }}
                className="w-full grid grid-cols-1 sm:grid-cols-12 gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left items-center"
              >
                <div className="sm:col-span-5 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.requestNumber} · {formatRelativeTime(r.updatedAt)}</p>
                </div>
                <div className="sm:col-span-2 flex items-center gap-2 min-w-0">
                  <Avatar initials={requester?.initials ?? "?"} color={requester?.avatarColor ?? "bg-slate-500"} size="sm" />
                  <span className="text-xs text-foreground truncate hidden sm:block">{requester?.name}</span>
                </div>
                <div className="sm:col-span-1">
                  <PriorityBadge priority={r.priority} />
                </div>
                <div className="sm:col-span-2">
                  <StatusBadge status={r.status} />
                </div>
                <div className="sm:col-span-2 sm:text-right">
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {formatCurrency(r.totalEstimated, r.currency)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Quick Actions & AI Insights */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Quick Actions */}
        <SectionCard title="Quick Actions" description="Jump to common tasks">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "New Request", icon: FileText, view: "request-new" as const, color: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" },
              { label: "New RFQ", icon: FileText, view: "rfq-new" as const, color: "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400" },
              { label: "Add Vendor", icon: Users, view: "vendors" as const, color: "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" },
              { label: "View Approvals", icon: ClipboardCheck, view: "approvals" as const, color: "bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400" },
              { label: "Budgets", icon: Wallet, view: "budgets" as const, color: "bg-teal-100 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400" },
              { label: "Reports", icon: TrendingUp, view: "reports" as const, color: "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" },
            ].map((qa) => (
              <button
                key={qa.label}
                onClick={() => navigate(qa.view)}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/40 hover:border-emerald-300 transition-all text-left"
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${qa.color}`}>
                  <qa.icon size={16} />
                </div>
                <span className="text-sm font-medium text-foreground">{qa.label}</span>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* AI Insights */}
        <SectionCard
          title="AI Insights"
          description="Smart recommendations from your AI assistant"
          action={
            <button
              onClick={() => navigate("ai-assistant")}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-0.5"
            >
              Open Assistant <ArrowUpRight size={12} />
            </button>
          }
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/15 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">SLA breach risk</p>
                  <p className="text-xs text-muted-foreground mt-0.5">PR-2026-0006 approval SLA expires in 24 hours. Consider escalating.</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/15 p-3">
              <div className="flex items-start gap-2">
                <TrendingUp size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">Cost saving opportunity</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Consolidating 4 construction material vendors could yield ~$18k annual savings.</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/15 p-3">
              <div className="flex items-start gap-2">
                <Bot size={15} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">Vendor recommendation</p>
                  <p className="text-xs text-muted-foreground mt-0.5">For IT equipment, TechCore Distributors has 94% on-time delivery and 4.7 rating.</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate("ai-assistant")}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Sparkles size={14} />
              Ask AI Assistant
            </button>
          </div>
        </SectionCard>
      </div>

      {/* Approval bottlenecks */}
      <SectionCard title="Approval Bottlenecks" description="Requests approaching or breaching SLA">
        <div className="space-y-2">
          {requests
            .filter((r) => r.approvals.some((a) => a.decision === "PENDING"))
            .slice(0, 4)
            .map((r) => {
              const pending = r.approvals.find((a) => a.decision === "PENDING")!;
              const hoursLeft = (new Date(pending.slaExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60);
              const isBreached = hoursLeft < 0;
              const isWarning = hoursLeft >= 0 && hoursLeft < 12;
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    useStore.getState().selectRequest(r.id);
                    navigate("request-detail");
                  }}
                  className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                    isBreached ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" :
                    isWarning ? "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400" :
                    "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                  }`}>
                    {isBreached ? <AlertTriangle size={15} /> : <Clock size={15} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.requestNumber} · Pending at {pending.stage.replace("_", " ").toLowerCase()} stage</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-medium ${
                      isBreached ? "text-rose-600 dark:text-rose-400" :
                      isWarning ? "text-amber-600 dark:text-amber-400" :
                      "text-muted-foreground"
                    }`}>
                      {isBreached ? "SLA breached" : `${hoursLeft.toFixed(0)}h left`}
                    </p>
                    <p className="text-xs text-foreground tabular-nums">{formatCurrency(r.totalEstimated)}</p>
                  </div>
                </button>
              );
            })}
        </div>
      </SectionCard>
    </div>
  );
}
