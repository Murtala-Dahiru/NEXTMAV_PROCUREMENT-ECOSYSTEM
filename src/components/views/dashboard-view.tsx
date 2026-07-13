// NextMav Procure — Executive Dashboard

"use client";

import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileText,
  Package,
  Plus,
  TrendingUp,
  Users,
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
    </div>
  );
}
