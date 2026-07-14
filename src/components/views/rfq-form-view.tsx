// NextMav Procure — Create new RFQ

"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Check,
  FileText,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader, SectionCard } from "@/components/shared";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function RfqFormView() {
  const navigate = useStore((s) => s.navigate);
  const createRFQ = useStore((s) => s.createRFQ);
  const vendors = useStore((s) => s.vendors);
  const requests = useStore((s) => s.requests);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [linkedRequestId, setLinkedRequestId] = useState<string>("");

  const availableVendors = vendors.filter((v) => v.status === "ACTIVE" || v.status === "PROSPECTIVE");
  const approvableRequests = requests.filter((r) => r.status === "APPROVED");

  const toggleVendor = (id: string) => {
    setSelectedVendorIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (!description.trim()) {
      toast.error("Description required");
      return;
    }
    if (selectedVendorIds.length === 0) {
      toast.error("Select at least one vendor");
      return;
    }
    const id = createRFQ({
      title: title.trim(),
      description: description.trim(),
      deadline: new Date(deadline).toISOString(),
      invitedVendorIds: selectedVendorIds,
      requestId: linkedRequestId || undefined,
    });
    toast.success("RFQ created", {
      description: `Issued to ${selectedVendorIds.length} vendor${selectedVendorIds.length !== 1 ? "s" : ""}.`,
    });
    useStore.getState().selectRfq(id);
    navigate("rfq-detail");
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("rfqs")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Back to RFQs
      </button>

      <PageHeader
        title="New Request for Quotation"
        description="Issue an RFQ to invite vendors to submit price quotations."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <SectionCard title="RFQ Details">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Title <span className="text-rose-500">*</span></label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. PPE Supply — Q3 Restock"
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description <span className="text-rose-500">*</span></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="Describe the items, quantities, delivery requirements, and any other terms…"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Calendar size={14} /> Response Deadline <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Link to Approved Request (optional)</label>
                  <select
                    value={linkedRequestId}
                    onChange={(e) => setLinkedRequestId(e.target.value)}
                    className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  >
                    <option value="">No linked request</option>
                    {approvableRequests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.requestNumber} — {r.title.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Vendor selection */}
          <SectionCard
            title="Invite Vendors"
            description={`Select vendors to receive this RFQ. ${selectedVendorIds.length} selected.`}
          >
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {availableVendors.map((v) => {
                const isSelected = selectedVendorIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggleVendor(v.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                      isSelected
                        ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                        : "border-border bg-card hover:bg-muted/40"
                    )}
                  >
                    <div className={cn(
                      "flex h-5 w-5 items-center justify-center rounded border transition-all shrink-0",
                      isSelected ? "bg-emerald-600 border-emerald-600 text-white" : "border-border"
                    )}>
                      {isSelected && <Check size={13} />}
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold shrink-0">
                      {v.companyName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{v.companyName}</p>
                      <p className="text-xs text-muted-foreground truncate">{v.category} · {v.contactPerson}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">{v.totalOrders} orders</p>
                      <p className="text-xs font-medium text-foreground">
                        {v.rating > 0 ? `★ ${v.rating.toFixed(1)}` : "New"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>

        {/* Summary */}
        <div className="space-y-4">
          <div className="sticky top-20 space-y-4">
            <SectionCard title="Summary">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="text-foreground font-medium truncate ml-2">{title || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Deadline</dt>
                  <dd className="text-foreground">{formatDate(deadline)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Vendors invited</dt>
                  <dd className="text-foreground font-medium">{selectedVendorIds.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Linked request</dt>
                  <dd className="text-foreground truncate ml-2">
                    {linkedRequestId ? requests.find((r) => r.id === linkedRequestId)?.requestNumber : "None"}
                  </dd>
                </div>
              </dl>
            </SectionCard>

            <div className="space-y-2">
              <button
                onClick={handleSubmit}
                className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
              >
                <Send size={15} />
                Issue RFQ to Vendors
              </button>
              <button
                onClick={() => navigate("rfqs")}
                className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={15} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
