// NextMav Procure — Reports & Analytics

"use client";

import {
  Download,
  FileText,
  TrendingUp,
  Users,
  Package,
  Clock,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { KpiCard, PageHeader, RatingStars, SectionCard } from "@/components/shared";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { toast } from "sonner";

export function ReportsView() {
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const vendors = useStore((s) => s.vendors);
  const departments = useStore((s) => s.departments);
  const requests = useStore((s) => s.requests);
  const users = useStore((s) => s.users);

  // Monthly spend trend
  const monthlySpend = [
    { month: "Aug", spend: 42500 },
    { month: "Sep", spend: 58200 },
    { month: "Oct", spend: 71800 },
    { month: "Nov", spend: 64300 },
    { month: "Dec", spend: 89100 },
    { month: "Jan", spend: 102500 },
    { month: "Feb", spend: 38500 },
  ];

  // Department spend vs budget
  const deptData = departments
    .map((d) => ({
      name: d.name.split(" ")[0],
      fullName: d.name,
      spent: d.spent,
      budget: d.budget,
      pct: Math.round((d.spent / d.budget) * 100),
    }))
    .sort((a, b) => b.spent - a.spent);

  // Top vendors
  const topVendors = [...vendors]
    .filter((v) => v.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 8);

  const vendorPie = topVendors.slice(0, 5).map((v) => ({ name: v.companyName, value: v.totalValue }));

  // Approval performance
  const allApprovals = requests.flatMap((r) => r.approvals);
  const approved = allApprovals.filter((a) => a.decision === "APPROVED").length;
  const rejected = allApprovals.filter((a) => a.decision === "REJECTED").length;
  const pending = allApprovals.filter((a) => a.decision === "PENDING").length;
  const approvalRate = approved + rejected > 0 ? Math.round((approved / (approved + rejected)) * 100) : 0;

  // Status distribution
  const statusDist = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"].map((s) => ({
    name: s.charAt(0) + s.slice(1).toLowerCase().replace("_", " "),
    count: requests.filter((r) => r.status === s).length,
  })).filter((x) => x.count > 0);

  const PIE_COLORS = ["#10b981", "#f59e0b", "#0ea5e9", "#a855f7", "#f43f5e", "#64748b", "#14b8a6"];

  const totalSpend = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
  const avgPoValue = purchaseOrders.length > 0 ? totalSpend / purchaseOrders.length : 0;
  const avgApprovalDays = 2.4; // simulated
  const totalSaved = 38400; // simulated

  const reportTypes = [
    { label: "Monthly Spend", icon: TrendingUp, color: "bg-emerald-100 dark:bg-emerald-950/40" },
    { label: "Department Spend", icon: FileText, color: "bg-sky-100 dark:bg-sky-950/40" },
    { label: "Vendor Spend", icon: Users, color: "bg-amber-100 dark:bg-amber-950/40" },
    { label: "Purchase Orders", icon: Package, color: "bg-violet-100 dark:bg-violet-950/40" },
    { label: "Approval Performance", icon: Clock, color: "bg-rose-100 dark:bg-rose-950/40" },
    { label: "Top Vendors", icon: Users, color: "bg-teal-100 dark:bg-teal-950/40" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Spend intelligence and procurement KPIs across your organization."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const csvData = purchaseOrders.map((p) => ({
                  poNumber: p.poNumber,
                  vendor: vendors.find((v) => v.id === p.vendorId)?.companyName ?? "",
                  status: p.status,
                  total: p.totalAmount,
                  currency: p.currency,
                  issuedAt: p.issuedAt,
                  expectedDelivery: p.expectedDelivery,
                }));
                try {
                  const res = await fetch("/api/export?XTransformPort=3001", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "purchase_orders", data: csvData, format: "csv" }),
                  });
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `nextmav-pos-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("CSV exported", { description: `${csvData.length} purchase orders exported.` });
                  }
                } catch {
                  toast.error("Export failed");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download size={14} /> CSV
            </button>
            <button
              onClick={async () => {
                const jsonData = {
                  generatedAt: new Date().toISOString(),
                  organization: "Apex Industries",
                  summary: { totalSpend, totalPOs: purchaseOrders.length, totalVendors: vendors.length, avgPoValue },
                  purchaseOrders: purchaseOrders.map((p) => ({
                    ...p,
                    vendorName: vendors.find((v) => v.id === p.vendorId)?.companyName,
                  })),
                  vendors: vendors.map((v) => ({ id: v.id, name: v.companyName, rating: v.rating, totalValue: v.totalValue, status: v.status })),
                  departments: departments.map((d) => ({ name: d.name, budget: d.budget, spent: d.spent })),
                };
                try {
                  const res = await fetch("/api/export?XTransformPort=3001", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "full_report", data: [jsonData], format: "json" }),
                  });
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `nextmav-report-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("JSON exported", { description: "Full report downloaded." });
                  }
                } catch {
                  toast.error("Export failed");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download size={14} /> JSON
            </button>
            <button
              onClick={async () => {
                const csvData = [
                  { metric: "Total Spend YTD", value: totalSpend },
                  { metric: "Total POs", value: purchaseOrders.length },
                  { metric: "Total Vendors", value: vendors.length },
                  { metric: "Avg PO Value", value: avgPoValue.toFixed(2) },
                  { metric: "Approval Rate", value: `${approvalRate}%` },
                  { metric: "Cost Savings", value: totalSaved },
                ];
                try {
                  const res = await fetch("/api/export?XTransformPort=3001", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "report_summary", data: csvData, format: "csv" }),
                  });
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `nextmav-report-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Report exported", { description: "Executive summary downloaded as CSV" });
                  }
                } catch {
                  toast.error("Export failed");
                }
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Download size={15} /> PDF Summary
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Spend YTD" value={formatCompactCurrency(totalSpend)} icon={TrendingUp} iconBg="bg-emerald-100 dark:bg-emerald-950/40" delta="+18.2%" deltaType="up" hint="vs last year" />
        <KpiCard label="Avg PO Value" value={formatCurrency(avgPoValue)} icon={Package} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Approval Rate" value={`${approvalRate}%`} icon={Clock} iconBg="bg-amber-100 dark:bg-amber-950/40" delta="+5.2%" deltaType="up" />
        <KpiCard label="Cost Savings" value={formatCompactCurrency(totalSaved)} icon={TrendingUp} iconBg="bg-teal-100 dark:bg-teal-950/40" delta="via RFQ" deltaType="neutral" />
      </div>

      {/* Quick report types */}
      <SectionCard title="Standard Reports" description="Generate and download common procurement reports">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {reportTypes.map((r) => (
            <button
              key={r.label}
              onClick={async () => {
                const reportData = purchaseOrders.map((p) => ({
                  poNumber: p.poNumber,
                  vendor: vendors.find((v) => v.id === p.vendorId)?.companyName ?? "",
                  status: p.status,
                  total: p.totalAmount,
                  issuedAt: p.issuedAt,
                }));
                try {
                  const res = await fetch("/api/export?XTransformPort=3001", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: r.label.toLowerCase().replace(/\s+/g, "_"), data: reportData, format: "csv" }),
                  });
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${r.label.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(`${r.label} exported`, { description: `${reportData.length} records downloaded` });
                  }
                } catch {
                  toast.error("Export failed");
                }
              }}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/40 hover:border-emerald-300 transition-all text-left"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${r.color}`}>
                <r.icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground">PDF · Excel</p>
              </div>
              <Download size={14} className="text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Monthly spend trend */}
      <SectionCard
        title="Monthly Spend Trend"
        description="Total procurement spend per month over the last 7 months"
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlySpend} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
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
                }}
                formatter={(v: number) => [formatCurrency(v), "Spend"]}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ fill: "#10b981", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* Department + Vendor spend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Department Spend vs Budget"
          description="Budget utilization by department"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                <XAxis dataKey="name" stroke="oklch(0.55 0.02 160)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="oklch(0.55 0.02 160)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }}
                  formatter={(v: number, n: string) => [formatCurrency(v), n === "spent" ? "Spent" : "Budget"]}
                  labelFormatter={(l) => deptData.find((d) => d.name === l)?.fullName}
                />
                <Bar dataKey="budget" fill="oklch(0.92 0.01 150)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Vendor Spend Distribution"
          description="Top 5 vendors by total spend"
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={vendorPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {vendorPie.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }}
                  formatter={(v: number) => formatCurrency(v)}
                />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Top vendors + request status distribution */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Top Vendors by Spend"
          description="Highest-value suppliers"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {topVendors.slice(0, 6).map((v, i) => (
              <div key={v.id} className="flex items-center gap-3 px-5 py-3">
                <div className="text-sm font-semibold text-muted-foreground w-6">#{i + 1}</div>
                <div className="flex h-9 w-9 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold shrink-0">
                  {v.companyName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{v.companyName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <RatingStars rating={v.rating} size={10} />
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{v.totalOrders} orders</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-foreground tabular-nums">{formatCompactCurrency(v.totalValue)}</p>
                  <p className="text-[10px] text-muted-foreground">total spend</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Request Status Distribution"
          description="All purchase requests by current status"
        >
          <div className="space-y-3">
            {statusDist.map((s, i) => {
              const pct = (s.count / requests.length) * 100;
              return (
                <div key={s.name}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-foreground font-medium">{s.name}</span>
                    <span className="text-muted-foreground tabular-nums">{s.count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
