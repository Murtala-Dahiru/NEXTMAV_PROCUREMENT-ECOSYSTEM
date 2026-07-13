// NextMav Procure — Create new purchase request

"use client";

import { useState } from "react";
import {
  ArrowLeft,
  FileText,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader, SectionCard } from "@/components/shared";
import { type Priority } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LineItemDraft {
  id: string;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
}

export function RequestFormView() {
  const navigate = useStore((s) => s.navigate);
  const createRequest = useStore((s) => s.createRequest);
  const departments = useStore((s) => s.departments);

  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [businessJustification, setBusinessJustification] = useState("");
  const [neededByDate, setNeededByDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { id: "li_1", itemName: "", description: "", quantity: 1, unit: "units", estimatedCost: 0 },
  ]);

  const total = lineItems.reduce((s, li) => s + li.quantity * li.estimatedCost, 0);

  const updateItem = (id: string, field: keyof LineItemDraft, value: string | number) => {
    setLineItems((items) =>
      items.map((li) => (li.id === id ? { ...li, [field]: value } : li))
    );
  };

  const addItem = () =>
    setLineItems((items) => [
      ...items,
      { id: `li_${Date.now()}`, itemName: "", description: "", quantity: 1, unit: "units", estimatedCost: 0 },
    ]);

  const removeItem = (id: string) =>
    setLineItems((items) => items.filter((li) => li.id !== id));

  const validate = () => {
    if (!title.trim()) {
      toast.error("Title required", { description: "Please enter a title for this request." });
      return false;
    }
    if (!businessJustification.trim()) {
      toast.error("Justification required", { description: "Please provide a business justification." });
      return false;
    }
    const validItems = lineItems.filter((li) => li.itemName.trim() && li.quantity > 0);
    if (validItems.length === 0) {
      toast.error("At least one line item", { description: "Add at least one item with a name and quantity." });
      return false;
    }
    return true;
  };

  const handleSubmit = (submit: boolean) => {
    if (!validate()) return;
    const validItems = lineItems.filter((li) => li.itemName.trim() && li.quantity > 0);
    const id = createRequest({
      title: title.trim(),
      departmentId,
      priority,
      businessJustification: businessJustification.trim(),
      neededByDate: new Date(neededByDate).toISOString(),
      lineItems: validItems.map(({ id: _id, ...rest }) => rest),
      submit,
    });
    toast.success(submit ? "Request submitted" : "Draft saved", {
      description: `${title} has been ${submit ? "submitted for approval" : "saved as draft"}.`,
    });
    useStore.getState().selectRequest(id);
    navigate("request-detail");
  };

  const priorityOptions: { value: Priority; label: string; color: string }[] = [
    { value: "LOW", label: "Low", color: "bg-muted text-muted-foreground border-border" },
    { value: "MEDIUM", label: "Medium", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900" },
    { value: "HIGH", label: "High", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
    { value: "URGENT", label: "Urgent", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900" },
  ];

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("requests")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Back to requests
      </button>

      <PageHeader
        title="New Purchase Request"
        description="Create a new requisition. Add line items, justify the business need, and submit for approval."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic info */}
          <SectionCard title="Request Details" description="Basic information about this purchase request">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Title <span className="text-rose-500">*</span></label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Industrial Laptops for Engineering Team"
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Department</label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger className="mt-1.5 h-10">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Needed by date</label>
                  <input
                    type="date"
                    value={neededByDate}
                    onChange={(e) => setNeededByDate(e.target.value)}
                    className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Priority</label>
                <div className="mt-1.5 flex gap-2 flex-wrap">
                  {priorityOptions.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPriority(p.value)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
                        priority === p.value ? p.color : "bg-card text-muted-foreground border-border hover:bg-muted"
                      )}
                    >
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        p.value === "LOW" && "bg-muted-foreground",
                        p.value === "MEDIUM" && "bg-sky-500",
                        p.value === "HIGH" && "bg-amber-500",
                        p.value === "URGENT" && "bg-rose-500"
                      )} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Business Justification <span className="text-rose-500">*</span></label>
                <textarea
                  value={businessJustification}
                  onChange={(e) => setBusinessJustification(e.target.value)}
                  rows={4}
                  placeholder="Explain the business need, impact of not purchasing, and any relevant context…"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
                />
              </div>
            </div>
          </SectionCard>

          {/* Line items */}
          <SectionCard
            title="Line Items"
            description="Add items to be procured. Quantity × Estimated cost = line total."
            action={
              <button
                onClick={addItem}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted transition-colors"
              >
                <Plus size={13} /> Add item
              </button>
            }
            bodyClassName="p-0"
          >
            <div className="divide-y divide-border">
              {lineItems.map((li, idx) => (
                <div key={li.id} className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Item {idx + 1}
                    </span>
                    {lineItems.length > 1 && (
                      <button
                        onClick={() => removeItem(li.id)}
                        className="text-muted-foreground hover:text-rose-500 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <input
                        value={li.itemName}
                        onChange={(e) => updateItem(li.id, "itemName", e.target.value)}
                        placeholder="Item name"
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        value={li.description}
                        onChange={(e) => updateItem(li.id, "description", e.target.value)}
                        placeholder="Description (optional)"
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={li.quantity}
                          onChange={(e) => updateItem(li.id, "quantity", parseFloat(e.target.value) || 0)}
                          className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Unit</label>
                        <input
                          value={li.unit}
                          onChange={(e) => updateItem(li.id, "unit", e.target.value)}
                          placeholder="units"
                          className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-medium text-muted-foreground uppercase">Cost</label>
                        <input
                          type="number"
                          min="0"
                          value={li.estimatedCost}
                          onChange={(e) => updateItem(li.id, "estimatedCost", parseFloat(e.target.value) || 0)}
                          className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex items-end justify-end">
                      <div className="text-right">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase">Line Total</p>
                        <p className="text-base font-semibold tabular-nums text-foreground">
                          {formatCurrency(li.quantity * li.estimatedCost)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-t border-border">
              <span className="text-sm font-medium text-foreground">Total Estimated</span>
              <span className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(total)}</span>
            </div>
          </SectionCard>

          {/* Attachments placeholder */}
          <SectionCard title="Attachments" description="Upload supporting documents (specs, quotes, etc.)">
            <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 py-8 cursor-pointer hover:bg-muted/40 transition-colors">
              <FileText size={22} className="text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">Click to upload or drag and drop</p>
              <p className="text-xs text-muted-foreground mt-0.5">PDF, DOC, XLS, PNG up to 10MB</p>
              <input type="file" className="hidden" multiple />
            </label>
          </SectionCard>
        </div>

        {/* Right — summary & actions */}
        <div className="space-y-6">
          <div className="sticky top-20 space-y-4">
            <SectionCard title="Summary">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="text-foreground">{lineItems.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Priority</dt>
                  <dd className="text-foreground capitalize">{priority.toLowerCase()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Needed by</dt>
                  <dd className="text-foreground">{new Date(neededByDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
                </div>
                <div className="flex justify-between pt-3 border-t border-border">
                  <dt className="font-medium text-foreground">Total</dt>
                  <dd className="font-semibold text-foreground tabular-nums">{formatCurrency(total)}</dd>
                </div>
              </dl>
            </SectionCard>

            <div className="space-y-2">
              <button
                onClick={() => handleSubmit(true)}
                className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-opacity"
              >
                <Send size={15} />
                Submit for Approval
              </button>
              <button
                onClick={() => handleSubmit(false)}
                className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Save size={15} />
                Save as Draft
              </button>
              <button
                onClick={() => navigate("requests")}
                className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={15} />
                Cancel
              </button>
            </div>

            <p className="text-xs text-muted-foreground text-center px-4">
              Submitting will trigger the multi-stage approval workflow: Department → Finance → Procurement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
