// NextMav Procure — Document Management

"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Filter,
  FolderTree,
  Plus,
  Search,
  Trash2,
  Upload,
  Download,
  File,
  FileCheck,
  FilePlus,
  Shield,
  Clock,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, KpiCard, PageHeader, SectionCard, Tag } from "@/components/shared";
import { formatRelativeTime } from "@/lib/format";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const categoryIcons: Record<DocumentCategory, any> = {
  PURCHASE_ORDER: FileCheck,
  CONTRACT: FileText,
  INVOICE: FileText,
  QUOTATION: FileText,
  DELIVERY_NOTE: FilePlus,
  CERTIFICATE: Shield,
  POLICY: FileText,
  ATTACHMENT: File,
  OTHER: File,
};

const categoryColors: Record<DocumentCategory, string> = {
  PURCHASE_ORDER: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
  CONTRACT: "bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400",
  INVOICE: "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
  QUOTATION: "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400",
  DELIVERY_NOTE: "bg-teal-100 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400",
  CERTIFICATE: "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
  POLICY: "bg-slate-100 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400",
  ATTACHMENT: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground",
};

export function DocumentsView() {
  const navigate = useStore((s) => s.navigate);
  const documents = useStore((s) => s.documents);
  const users = useStore((s) => s.users);
  const uploadDocument = useStore((s) => s.uploadDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("ATTACHMENT");
  const [uploadDescription, setUploadDescription] = useState("");

  const filtered = useMemo(() => {
    return documents
      .filter((d) => {
        if (categoryFilter !== "ALL" && d.category !== categoryFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return d.name.toLowerCase().includes(q) || (d.description?.toLowerCase().includes(q) ?? false) || d.tags.some((t) => t.toLowerCase().includes(q));
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [documents, categoryFilter, search]);

  const handleUpload = () => {
    if (!uploadName.trim()) {
      toast.error("Document name required");
      return;
    }
    uploadDocument({
      name: uploadName,
      category: uploadCategory,
      fileSize: "245 KB",
      mimeType: "application/pdf",
      tags: [],
      description: uploadDescription,
    });
    toast.success("Document uploaded", { description: uploadName });
    setShowUpload(false);
    setUploadName("");
    setUploadDescription("");
  };

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    documents.forEach((d) => {
      counts[d.category] = (counts[d.category] ?? 0) + 1;
    });
    return counts;
  }, [documents]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Management"
        description="Central repository for all procurement documents — POs, contracts, invoices, certificates, and policies."
        actions={
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Upload size={15} /> Upload Document
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Documents" value={documents.length} icon={FileText} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Categories" value={Object.keys(categoryCounts).length} icon={FolderTree} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="With Versions" value={documents.filter((d) => d.versions.length > 1).length} icon={Clock} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Linked to Entities" value={documents.filter((d) => d.linkedEntityId).length} icon={FileCheck} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      {/* Category quick filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter("ALL")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            categoryFilter === "ALL" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
          )}
        >
          <FolderTree size={12} /> All ({documents.length})
        </button>
        {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([key, label]) => {
          const count = categoryCounts[key] ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={key}
              onClick={() => setCategoryFilter(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                categoryFilter === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, description, or tag…"
          className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No documents found" description="Upload documents or adjust your filters." action={
          <button onClick={() => setShowUpload(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95">
            <Upload size={15} /> Upload
          </button>
        } />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => {
            const Icon = categoryIcons[d.category] ?? File;
            const uploader = users.find((u) => u.id === d.uploadedById);
            return (
              <div key={d.id} className="group rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0", categoryColors[d.category])}>
                    <Icon size={18} />
                  </div>
                  <div className="flex items-center gap-1">
                    {d.versions.length > 1 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-full">
                        v{d.currentVersion}
                      </span>
                    )}
                    <button
                      onClick={() => { if (confirm(`Delete ${d.name}?`)) { deleteDocument(d.id); toast.info("Document deleted"); } }}
                      className="text-muted-foreground hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground truncate">{d.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{d.description ?? DOCUMENT_CATEGORY_LABELS[d.category]}</p>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Tag label={DOCUMENT_CATEGORY_LABELS[d.category]} />
                  <span className="text-xs text-muted-foreground">{d.fileSize}</span>
                </div>

                {d.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.tags.slice(0, 3).map((t) => <Tag key={t} label={t} color="sky" />)}
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    {uploader && <Avatar initials={uploader.initials} color={uploader.avatarColor} size="sm" />}
                    <span className="truncate">{uploader?.name ?? "Unknown"}</span>
                  </div>
                  <span className="text-muted-foreground">{formatRelativeTime(d.updatedAt)}</span>
                </div>

                <button
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/export?XTransformPort=3001", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ type: "document", data: [{ name: d.name, category: d.category, size: d.fileSize, uploaded: d.createdAt }], format: "csv" }),
                      });
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${d.name.replace(/\.[^/.]+$/, "")}-metadata.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success("Document metadata exported");
                      }
                    } catch {
                      toast.error("Export failed");
                    }
                  }}
                  className="mt-3 w-full inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Download size={11} /> Export Metadata
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload dialog */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Upload Document</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Document Name</label>
                <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="e.g. Q1 2026 Audit Report" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as DocumentCategory)}
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                >
                  {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description (optional)</label>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none" />
              </div>
              <div className="rounded-lg border-2 border-dashed border-border bg-muted/20 py-6 text-center">
                <Upload size={22} className="mx-auto text-muted-foreground" />
                <p className="mt-1.5 text-xs font-medium text-foreground">Click to upload or drag and drop</p>
                <p className="text-[10px] text-muted-foreground">PDF, DOC, XLS, PNG up to 10MB</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowUpload(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleUpload} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity">
                <Upload size={14} /> Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
