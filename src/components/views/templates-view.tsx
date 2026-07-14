// NextMav Procure — Request Templates

"use client";

import { useState } from "react";
import {
  ArrowRight,
  Copy,
  FileText,
  Plus,
  Repeat,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, SectionCard, Tag } from "@/components/shared";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function TemplatesView() {
  const templates = useStore((s) => s.templates);
  const departments = useStore((s) => s.departments);
  const users = useStore((s) => s.users);
  const applyTemplate = useStore((s) => s.useTemplate);
  const createTemplate = useStore((s) => s.createTemplate);
  const navigate = useStore((s) => s.navigate);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  const filtered = templates.filter((t) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleUse = (id: string) => {
    applyTemplate(id);
    toast.success("Template applied", { description: "A new draft request has been created from the template." });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request Templates"
        description="Pre-configure common purchase requests to save time and ensure consistency."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Template
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Templates" value={templates.length} icon={FileText} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Total Uses" value={templates.reduce((s, t) => s + t.usageCount, 0)} icon={Repeat} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Categories" value={new Set(templates.map((t) => t.category)).size} icon={FileText} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Most Used" value={templates.sort((a, b) => b.usageCount - a.usageCount)[0]?.name.split(" ")[0] ?? "—"} icon={Plus} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Create templates for recurring purchases like PPE restocks, laptop requests, or monthly supplies."
          action={
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
            >
              <Plus size={15} /> Create Template
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const dept = departments.find((d) => d.id === t.departmentId);
            const creator = users.find((u) => u.id === t.createdBy);
            const total = t.defaultLineItems.reduce((s, li) => s + li.quantity * li.estimatedCost, 0);
            return (
              <div
                key={t.id}
                className="group rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                    <FileText size={18} />
                  </div>
                  <Tag label={`${t.usageCount} uses`} color="emerald" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{t.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>

                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <span className="text-foreground font-medium">{t.category}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Department</span>
                    <span className="text-foreground font-medium truncate ml-2">{dept?.name ?? "Any"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Items</span>
                    <span className="text-foreground font-medium">{t.defaultLineItems.length}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-border">
                    <span className="text-muted-foreground">Est. total</span>
                    <span className="text-foreground font-semibold tabular-nums">{formatCurrency(total)}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={() => handleUse(t.id)}
                    className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-95 transition-opacity"
                  >
                    Use Template <ArrowRight size={12} />
                  </button>
                  <button
                    onClick={() => {
                      createTemplate({
                        name: `${t.name} (Copy)`,
                        description: t.description,
                        category: t.category,
                        departmentId: t.departmentId,
                        priority: t.priority,
                        defaultLineItems: t.defaultLineItems,
                        defaultJustification: t.defaultJustification,
                      });
                      toast.success("Template duplicated", { description: `${t.name} has been duplicated` });
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New template dialog */}
      {showNew && (
        <NewTemplateDialog
          onClose={() => setShowNew(false)}
          onCreate={(data) => {
            createTemplate(data);
            toast.success("Template created", { description: data.name });
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function NewTemplateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: any) => void;
}) {
  const departments = useStore((s) => s.departments);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [justification, setJustification] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground">New Request Template</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Pre-configure a reusable purchase request.</p>
        <div className="mt-5 space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground">Template Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly Office Supplies" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this template for?" className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-foreground">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Office Supplies" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Department</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all">
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Default Justification</label>
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Default business justification…" className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onCreate({ name, description, category, departmentId, priority, defaultJustification: justification, defaultLineItems: [] })}
            disabled={!name.trim()}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            Create Template
          </button>
        </div>
      </div>
    </div>
  );
}
