// NextMav Procure — Budget Management (Complete Module)
// Create, edit, delete budgets. Track utilization, forecasting, alerts, and analytics.

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Calendar,
  CheckCircle2,
  DollarSign,
  Edit3,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { KpiCard, PageHeader, ProgressBar, SectionCard, Tag } from "@/components/shared";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { Budget, BudgetCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PIE_COLORS = ["#10b981", "#f59e0b", "#0ea5e9", "#a855f7", "#f43f5e", "#14b8a6", "#64748b"];

export function BudgetsView() {
  const budgets = useStore((s) => s.budgets);
  const departments = useStore((s) => s.departments);
  const requests = useStore((s) => s.requests);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const createBudget = useStore((s) => s.createBudget);
  const updateBudget = useStore((s) => s.updateBudget);

  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("ALL");

  // Form state
  const [form, setForm] = useState({
    departmentId: "",
    fiscalYear: new Date().getFullYear(),
    totalAmount: 0,
    categories: [] as BudgetCategory[],
  });
  const [newCategory, setNewCategory] = useState({ name: "", allocated: 0 });

  const totalAllocated = budgets.reduce((s, b) => s + b.totalAmount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spentAmount, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.committedAmount, 0);
  const totalRemaining = budgets.reduce((s, b) => s + b.remainingAmount, 0);
  const overallUtilization = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;

  // Forecasting: projected end-of-year spend based on current run rate
  const monthsElapsed = new Date().getMonth() + 1;
  const projectedAnnualSpend = totalSpent / (monthsElapsed / 12);
  const forecastVariance = totalAllocated - projectedAnnualSpend;
  const isOverBudgetProjected = forecastVariance < 0;

  const filteredBudgets = selectedDept === "ALL" ? budgets : budgets.filter((b) => b.departmentId === selectedDept);

  // Department spend vs budget chart
  const deptChart = filteredBudgets.map((b) => {
    const dept = departments.find((d) => d.id === b.departmentId);
    return {
      name: dept?.name.split(" ")[0] ?? "Unknown",
      fullName: dept?.name ?? "Unknown",
      allocated: b.totalAmount,
      spent: b.spentAmount,
      committed: b.committedAmount,
      pct: Math.round((b.spentAmount / b.totalAmount) * 100),
    };
  });

  // Category breakdown across all budgets
  const categoryTotals = useMemo(() => {
    const totals: { name: string; spent: number; allocated: number }[] = [];
    filteredBudgets.forEach((b) => {
      b.categories.forEach((c) => {
        const existing = totals.find((ct) => ct.name === c.name);
        if (existing) {
          existing.spent += c.spent;
          existing.allocated += c.allocated;
        } else {
          totals.push({ name: c.name, spent: c.spent, allocated: c.allocated });
        }
      });
    });
    return totals.sort((a, b) => b.spent - a.spent);
  }, [filteredBudgets]);

  // Recent spend transactions (POs)
  const recentSpend = [...purchaseOrders]
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
    .slice(0, 8);

  const openNewBudget = () => {
    setEditingBudget(null);
    setForm({
      departmentId: departments[0]?.id ?? "",
      fiscalYear: new Date().getFullYear(),
      totalAmount: 0,
      categories: [],
    });
    setShowForm(true);
  };

  const openEditBudget = (b: Budget) => {
    setEditingBudget(b);
    setForm({
      departmentId: b.departmentId,
      fiscalYear: b.fiscalYear,
      totalAmount: b.totalAmount,
      categories: [...b.categories],
    });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.departmentId) {
      toast.error("Department required");
      return;
    }
    if (form.totalAmount <= 0) {
      toast.error("Total amount must be greater than zero");
      return;
    }
    if (editingBudget) {
      updateBudget(editingBudget.id, {
        totalAmount: form.totalAmount,
        categories: form.categories,
        remainingAmount: form.totalAmount - editingBudget.spentAmount - editingBudget.committedAmount,
      });
      toast.success("Budget updated", { description: `${departments.find((d) => d.id === form.departmentId)?.name} budget updated` });
    } else {
      createBudget({
        departmentId: form.departmentId,
        fiscalYear: form.fiscalYear,
        totalAmount: form.totalAmount,
        categories: form.categories,
      });
      toast.success("Budget created", { description: `${departments.find((d) => d.id === form.departmentId)?.name} budget created for FY ${form.fiscalYear}` });
    }
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    useStore.setState((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) }));
    toast.info("Budget deleted");
    setDeleteConfirm(null);
  };

  const addCategory = () => {
    if (!newCategory.name.trim() || newCategory.allocated <= 0) {
      toast.error("Category name and allocation required");
      return;
    }
    setForm({
      ...form,
      categories: [...form.categories, { name: newCategory.name.trim(), allocated: newCategory.allocated, spent: 0 }],
    });
    setNewCategory({ name: "", allocated: 0 });
  };

  const removeCategory = (idx: number) => {
    setForm({ ...form, categories: form.categories.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Management"
        description="Create and manage departmental budgets. Track utilization, forecast spend, and prevent overspending."
        actions={
          <button
            onClick={openNewBudget}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Budget
          </button>
        }
      />

      {/* Executive KPI Strip */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Allocated" value={formatCompactCurrency(totalAllocated)} icon={Wallet} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Total Spent" value={formatCompactCurrency(totalSpent)} delta={`${overallUtilization.toFixed(1)}%`} deltaType={overallUtilization > 75 ? "down" : "neutral"} hint="utilized" icon={TrendingDown} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Committed" value={formatCompactCurrency(totalCommitted)} icon={Banknote} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Remaining" value={formatCompactCurrency(totalRemaining)} icon={TrendingUp} iconBg="bg-teal-100 dark:bg-teal-950/40" />
      </div>

      {/* Forecast & Alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Forecast */}
        <SectionCard title="Spend Forecast" description="Projected annual spend based on current run rate">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Projected Annual Spend</p>
                <p className={cn("text-xl font-bold tabular-nums mt-1", isOverBudgetProjected ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
                  {formatCompactCurrency(projectedAnnualSpend)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Based on {monthsElapsed} months elapsed</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Forecast Variance</p>
                <p className={cn("text-xl font-bold tabular-nums mt-1", isOverBudgetProjected ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                  {forecastVariance >= 0 ? "+" : ""}{formatCompactCurrency(forecastVariance)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isOverBudgetProjected ? "Over budget" : "Under budget"}</p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Annual utilization projection</span>
                <span className="font-medium text-foreground tabular-nums">{((projectedAnnualSpend / totalAllocated) * 100).toFixed(1)}%</span>
              </div>
              <ProgressBar value={projectedAnnualSpend} max={totalAllocated} size="lg" />
            </div>
            {isOverBudgetProjected && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/20 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    At current spend rate, you will exceed your total budget by {formatCompactCurrency(Math.abs(forecastVariance))}. Consider reviewing discretionary spending.
                  </p>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Budget alerts */}
        {budgets.filter((b) => b.spentAmount / b.totalAmount > 0.75).length > 0 ? (
          <SectionCard title="Budget Alerts" description="Departments approaching budget limits">
            <div className="space-y-2">
              {budgets.filter((b) => b.spentAmount / b.totalAmount > 0.75).map((b) => {
                const dept = departments.find((d) => d.id === b.departmentId);
                const pct = Math.round((b.spentAmount / b.totalAmount) * 100);
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg shrink-0", pct > 90 ? "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400" : "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400")}>
                      <AlertTriangle size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{dept?.name}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(b.spentAmount)} of {formatCurrency(b.totalAmount)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold", pct > 90 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>{pct}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Budget Health" description="All departments within healthy utilization">
            <div className="text-center py-8">
              <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
              <p className="mt-2 text-sm font-medium text-foreground">All budgets healthy</p>
              <p className="text-xs text-muted-foreground mt-0.5">No departments over 75% utilization</p>
            </div>
          </SectionCard>
        )}
      </div>

      {/* Department filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filter by department:</span>
        <button
          onClick={() => setSelectedDept("ALL")}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            selectedDept === "ALL" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
          )}
        >
          All ({budgets.length})
        </button>
        {departments.map((d) => {
          const count = budgets.filter((b) => b.departmentId === d.id).length;
          if (count === 0) return null;
          return (
            <button
              key={d.id}
              onClick={() => setSelectedDept(d.id)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                selectedDept === d.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              {d.name.split(" ")[0]} ({count})
            </button>
          );
        })}
      </div>

      {/* Budget cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {filteredBudgets.map((b) => {
          const dept = departments.find((d) => d.id === b.departmentId);
          const pct = Math.round((b.spentAmount / b.totalAmount) * 100);
          const isOverBudget = pct > 90;
          const projectedDeptSpend = b.spentAmount / (monthsElapsed / 12);
          const deptForecastVariance = b.totalAmount - projectedDeptSpend;
          return (
            <SectionCard
              key={b.id}
              title={dept?.name ?? "Unknown Department"}
              description={`FY ${b.fiscalYear} · Annual budget`}
              action={
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditBudget(b)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit budget"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(b.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    title="Delete budget"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              }
            >
              <div className="space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums text-foreground">{formatCurrency(b.spentAmount)}</p>
                    <p className="text-xs text-muted-foreground">spent of {formatCurrency(b.totalAmount)}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-2xl font-semibold tabular-nums", isOverBudget ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>{pct}%</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(b.remainingAmount)} left</p>
                  </div>
                </div>
                <ProgressBar value={b.spentAmount} max={b.totalAmount} size="lg" showLabel={false} />
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Allocated</p>
                    <p className="text-sm font-medium text-foreground tabular-nums mt-0.5">{formatCompactCurrency(b.totalAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Committed</p>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400 tabular-nums mt-0.5">{formatCompactCurrency(b.committedAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Forecast</p>
                    <p className={cn("text-sm font-medium tabular-nums mt-0.5", deptForecastVariance < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {deptForecastVariance >= 0 ? "+" : ""}{formatCompactCurrency(deptForecastVariance)}
                    </p>
                  </div>
                </div>
                {/* Category breakdown */}
                <div className="space-y-2 pt-2 border-t border-border">
                  {b.categories.slice(0, 4).map((c) => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground">{c.name}</span>
                        <span className="text-muted-foreground tabular-nums">{formatCompactCurrency(c.spent)} / {formatCompactCurrency(c.allocated)}</span>
                      </div>
                      <ProgressBar value={c.spent} max={c.allocated} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Department Budget vs Spend" description="Allocation and utilization across departments">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptChart} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                <XAxis dataKey="name" stroke="oklch(0.55 0.02 160)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.55 0.02 160)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₦${(v / 1000000).toFixed(0)}M`} />
                <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }} formatter={(v: number, n: string) => [formatCurrency(v), n === "allocated" ? "Allocated" : n === "spent" ? "Spent" : "Committed"]} />
                <Bar dataKey="allocated" fill="oklch(0.92 0.01 150)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="committed" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Spend by Category" description="Top spending categories across all budgets">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryTotals.slice(0, 6)} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="spent">
                  {categoryTotals.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }} formatter={(v: number) => formatCurrency(v)} />
                <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Recent spend */}
      <SectionCard title="Recent Spend Transactions" description="Latest purchase orders affecting budgets" bodyClassName="p-0">
        <div className="divide-y divide-border">
          {recentSpend.map((po) => {
            const req = requests.find((r) => r.id === po.requestId);
            const dept = departments.find((d) => d.id === req?.departmentId);
            return (
              <div key={po.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                  po.status === "RECEIVED" || po.status === "CLOSED"
                    ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                )}>
                  {po.status === "RECEIVED" || po.status === "CLOSED" ? <CheckCircle2 size={15} /> : <Calendar size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground font-mono">{po.poNumber}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {dept?.name ?? "Uncategorized"} · {new Date(po.issuedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(po.totalAmount)}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{po.status.toLowerCase().replace("_", " ")}</p>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Budget form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{editingBudget ? "Edit Budget" : "Create New Budget"}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{editingBudget ? "Update budget allocation and categories" : "Set up a departmental budget for the fiscal year"}</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Department <span className="text-rose-500">*</span></label>
                  <select
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    disabled={!!editingBudget}
                    className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all disabled:opacity-60"
                  >
                    <option value="">Select department…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Fiscal Year <span className="text-rose-500">*</span></label>
                  <input
                    type="number"
                    value={form.fiscalYear}
                    onChange={(e) => setForm({ ...form, fiscalYear: parseInt(e.target.value) || new Date().getFullYear() })}
                    min="2024"
                    max="2030"
                    disabled={!!editingBudget}
                    className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Total Budget Amount (₦) <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  value={form.totalAmount || ""}
                  onChange={(e) => setForm({ ...form, totalAmount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
                {form.totalAmount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">≈ {formatCurrency(form.totalAmount)}</p>
                )}
              </div>

              {/* Categories */}
              <div>
                <label className="text-sm font-medium text-foreground">Budget Categories</label>
                <p className="text-xs text-muted-foreground mt-0.5">Break down the budget into categories for granular tracking</p>

                {form.categories.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {form.categories.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(c.allocated)}</p>
                        </div>
                        <button
                          onClick={() => removeCategory(i)}
                          className="text-muted-foreground hover:text-rose-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                  <input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                    placeholder="Category name (e.g. Equipment)"
                    className="flex-1 h-9 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  />
                  <input
                    type="number"
                    value={newCategory.allocated || ""}
                    onChange={(e) => setNewCategory({ ...newCategory, allocated: parseFloat(e.target.value) || 0 })}
                    placeholder="Amount"
                    className="w-32 h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  />
                  <button
                    onClick={addCategory}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity">
                <CheckCircle2 size={14} /> {editingBudget ? "Save Changes" : "Create Budget"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Delete Budget?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This will permanently delete the budget for {departments.find((d) => d.id === budgets.find((b) => b.id === deleteConfirm)?.departmentId)?.name}. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-sm font-medium text-white hover:bg-rose-700 transition-colors">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
