// NextMav Procure — Approval Workflow Builder

"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  GitBranch,
  Plus,
  Power,
  Settings2,
  Shield,
  Workflow,
  Zap,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { KpiCard, PageHeader, ProgressBar, SectionCard, Tag } from "@/components/shared";
import { formatCurrency } from "@/lib/format";
import { ROLE_LABELS, type ApprovalStage, type UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const stageColors: Record<ApprovalStage, string> = {
  DEPARTMENT_MANAGER: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900",
  FINANCE: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900",
  PROCUREMENT: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900",
  EXECUTIVE: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900",
};

export function WorkflowsView() {
  const workflows = useStore((s) => s.workflows);
  const toggleWorkflow = useStore((s) => s.toggleWorkflow);
  const [selectedWf, setSelectedWf] = useState<string | null>(workflows[0]?.id ?? null);

  const activeCount = workflows.filter((w) => w.isActive).length;
  const totalStages = workflows.reduce((s, w) => s + w.stages.length, 0);

  const wf = workflows.find((w) => w.id === selectedWf);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Workflows"
        description="Configure multi-stage approval chains, SLAs, escalation rules, and conditional logic."
        actions={
          <button
            onClick={() => {
              useStore.getState().createWorkflow({
                name: "New Custom Workflow",
                description: "Configure a custom approval workflow with your own stages and rules.",
                isActive: false,
                stages: [
                  { id: `ws_${Date.now()}`, name: "Department Approval", stage: "DEPARTMENT_MANAGER", approverRole: "DEPARTMENT_MANAGER", slaHours: 48, allowDelegation: true, isParallel: false },
                ],
              });
              toast.success("Workflow created", { description: "New custom workflow added. Configure stages to activate." });
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Workflow
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Workflows" value={workflows.length} icon={Workflow} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Active" value={activeCount} icon={Power} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Total Stages" value={totalStages} icon={GitBranch} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Avg SLA" value="36h" icon={Clock} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Workflow list */}
        <div className="space-y-3">
          {workflows.map((w) => (
            <button
              key={w.id}
              onClick={() => setSelectedWf(w.id)}
              className={cn(
                "w-full text-left rounded-xl border bg-card p-4 transition-all",
                selectedWf === w.id ? "border-primary ring-2 ring-ring" : "border-border hover:border-emerald-300"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{w.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{w.description}</p>
                </div>
                <span className={cn(
                  "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                  w.isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"
                )}>
                  {w.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Tag label={`${w.stages.length} stages`} color="emerald" />
                {w.thresholdMin !== undefined && w.thresholdMax !== undefined && (
                  <Tag label={`${formatCurrency(w.thresholdMin)} - ${formatCurrency(w.thresholdMax)}`} color="amber" />
                )}
                {w.priorityFilter && w.priorityFilter.length > 0 && (
                  <Tag label={w.priorityFilter.join(", ")} color="rose" />
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Workflow detail */}
        <div className="lg:col-span-2">
          {wf && (
            <SectionCard
              title={wf.name}
              description={wf.description}
              action={
                <button
                  onClick={() => {
                    toggleWorkflow(wf.id);
                    toast.success(`Workflow ${wf.isActive ? "deactivated" : "activated"}`);
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                    wf.isActive
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  <Power size={13} />
                  {wf.isActive ? "Active" : "Inactive"}
                </button>
              }
            >
              {/* Stages visualization */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Approval Chain</p>
                <div className="space-y-3">
                  {wf.stages.map((stage, idx) => (
                    <div key={stage.id}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg border-2 font-semibold text-sm shrink-0",
                          stageColors[stage.stage]
                        )}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground">{stage.name}</p>
                            <Tag label={ROLE_LABELS[stage.approverRole]} />
                            {stage.isParallel && <Tag label="Parallel" color="violet" />}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock size={11} /> SLA: {stage.slaHours}h
                            </span>
                            {stage.escalationRole && (
                              <span className="flex items-center gap-1">
                                <Zap size={11} className="text-amber-500" /> Escalates to {ROLE_LABELS[stage.escalationRole]}
                              </span>
                            )}
                            {stage.allowDelegation && (
                              <span className="flex items-center gap-1">
                                <Shield size={11} className="text-sky-500" /> Delegation allowed
                              </span>
                            )}
                          </div>
                        </div>
                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                          <Settings2 size={14} />
                        </button>
                      </div>
                      {idx < wf.stages.length - 1 && (
                        <div className="ml-5 my-2 h-6 w-px bg-border" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Conditions */}
              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Trigger Conditions</p>
                <div className="space-y-2">
                  {wf.thresholdMin !== undefined && wf.thresholdMax !== undefined && (
                    <div className="flex items-center gap-2 text-sm">
                      <ArrowRight size={14} className="text-muted-foreground" />
                      <span className="text-foreground">Amount between</span>
                      <span className="font-medium text-foreground">{formatCurrency(wf.thresholdMin)}</span>
                      <span className="text-muted-foreground">and</span>
                      <span className="font-medium text-foreground">{formatCurrency(wf.thresholdMax)}</span>
                    </div>
                  )}
                  {wf.priorityFilter && wf.priorityFilter.length > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <ArrowRight size={14} className="text-muted-foreground" />
                      <span className="text-foreground">Priority in:</span>
                      {wf.priorityFilter.map((p) => (
                        <Tag key={p} label={p} color="rose" />
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight size={14} className="text-muted-foreground" />
                    <span className="text-foreground">All new requests matching criteria</span>
                  </div>
                </div>
              </div>

              {/* SLA tracking */}
              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">SLA Performance (Last 30 days)</p>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Avg Completion</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums mt-1">18.4h</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400">-23% vs last month</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">SLA Compliance</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums mt-1">94%</p>
                    <ProgressBar value={94} size="sm" />
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Escalations</p>
                    <p className="text-lg font-semibold text-foreground tabular-nums mt-1">2</p>
                    <p className="text-[10px] text-muted-foreground">in last 30 days</p>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <SectionCard title="Workflow Engine Features" description="Capabilities of the NextMav approval engine">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: GitBranch, title: "Unlimited stages", desc: "Configure as many approval levels as needed" },
            { icon: Zap, title: "Conditional logic", desc: "Routes based on amount, priority, department" },
            { icon: Shield, title: "Delegation", desc: "Approvers can delegate during absence" },
            { icon: Clock, title: "SLA enforcement", desc: "Automatic escalation on breach" },
            { icon: Power, title: "Parallel approvals", desc: "Multiple approvers in one stage" },
            { icon: Workflow, title: "Visual builder", desc: "Drag-and-drop workflow design" },
            { icon: CheckCircle2, title: "Digital signatures", desc: "Architecture-ready for e-sign" },
            { icon: Settings2, title: "Per-department rules", desc: "Different workflows per department" },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-muted/30 p-3">
              <f.icon size={16} className="text-emerald-500" />
              <p className="text-sm font-medium text-foreground mt-2">{f.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
