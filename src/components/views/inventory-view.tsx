// NextMav Procure — Inventory Management

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Boxes,
  Package,
  Plus,
  Search,
  TrendingDown,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, ProgressBar, SectionCard, Tag } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InventoryView() {
  const navigate = useStore((s) => s.navigate);
  const inventory = useStore((s) => s.inventory);
  const vendors = useStore((s) => s.vendors);
  const users = useStore((s) => s.users);
  const addStockMovement = useStore((s) => s.addStockMovement);
  const createInventoryItem = useStore((s) => s.createInventoryItem);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [showMovement, setShowMovement] = useState<string | null>(null);
  const [showNewItem, setShowNewItem] = useState(false);
  const [movementType, setMovementType] = useState<"RECEIPT" | "ISSUE" | "TRANSFER" | "ADJUSTMENT" | "RETURN" | "DISPOSAL">("ISSUE");
  const [movementQty, setMovementQty] = useState(1);
  const [movementNotes, setMovementNotes] = useState("");
  const [itemForm, setItemForm] = useState({ sku: "", name: "", category: "", unit: "pcs", quantity: 0, reorderLevel: 10, reorderQty: 50, unitCost: 0, location: "" });

  const categories = useMemo(() => Array.from(new Set(inventory.map((i) => i.category))).sort(), [inventory]);

  const filtered = useMemo(() => {
    return inventory
      .filter((i) => {
        if (categoryFilter !== "ALL" && i.category !== categoryFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, categoryFilter, search]);

  const totalItems = inventory.length;
  const totalValue = inventory.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const lowStockCount = inventory.filter((i) => i.quantity <= i.reorderLevel).length;
  const outOfStockCount = inventory.filter((i) => i.quantity === 0).length;

  const handleMovement = (itemId: string) => {
    const item = inventory.find((i) => i.id === itemId);
    if (!item) return;
    addStockMovement(itemId, { type: movementType, quantity: movementQty, notes: movementNotes });
    toast.success("Stock movement recorded", { description: `${movementType.toLowerCase()} ${movementQty} ${item.unit} of ${item.name}` });
    setShowMovement(null);
    setMovementQty(1);
    setMovementNotes("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory Management"
        description="Track stock levels, movements, reorder points, and inventory value across all locations."
        actions={
          <button
            onClick={() => setShowNewItem(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Item
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total SKUs" value={totalItems} icon={Boxes} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Inventory Value" value={formatCompactCurrency(totalValue)} icon={TrendingDown} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Low Stock" value={lowStockCount} delta="Reorder needed" deltaType={lowStockCount > 0 ? "down" : "neutral"} icon={AlertTriangle} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Out of Stock" value={outOfStockCount} icon={Package} iconBg="bg-rose-100 dark:bg-rose-950/40" />
      </div>

      {/* Low stock alerts */}
      {lowStockCount > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Low stock alerts</p>
              <div className="mt-1.5 space-y-1 text-xs text-amber-700 dark:text-amber-300">
                {inventory.filter((i) => i.quantity <= i.reorderLevel).map((i) => (
                  <p key={i.id}>• <strong>{i.name}</strong> ({i.sku}): {i.quantity} {i.unit} remaining — reorder at {i.reorderLevel} {i.unit}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or SKU…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-[180px] text-sm">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Boxes} title="No inventory items" description="Inventory items are created when goods are received, or add them manually." />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">SKU / Name</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Category</th>
                  <th className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Quantity</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Stock Level</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Unit Cost</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Total Value</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Location</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Updated</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((i) => {
                  const isLowStock = i.quantity <= i.reorderLevel;
                  const isOutOfStock = i.quantity === 0;
                  const stockPct = Math.min((i.quantity / (i.reorderLevel * 3)) * 100, 100);
                  const supplier = vendors.find((v) => v.id === i.supplierId);
                  return (
                    <tr key={i.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-foreground">{i.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{i.sku}</p>
                      </td>
                      <td className="px-3 py-3.5">
                        <Tag label={i.category} />
                      </td>
                      <td className="px-3 py-3.5 text-center">
                        <p className={cn("text-sm font-semibold tabular-nums", isOutOfStock ? "text-rose-600 dark:text-rose-400" : isLowStock ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                          {i.quantity} {i.unit}
                        </p>
                      </td>
                      <td className="px-3 py-3.5 min-w-[120px]">
                        <ProgressBar value={stockPct} size="sm" color={isOutOfStock ? "bg-rose-500" : isLowStock ? "bg-amber-500" : "bg-emerald-500"} />
                        <p className="text-[10px] text-muted-foreground mt-1">Reorder at {i.reorderLevel}</p>
                      </td>
                      <td className="px-3 py-3.5 text-right text-sm text-foreground tabular-nums">{formatCurrency(i.unitCost, i.currency)}</td>
                      <td className="px-3 py-3.5 text-right text-sm font-semibold text-foreground tabular-nums">{formatCurrency(i.quantity * i.unitCost, i.currency)}</td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">
                        {i.location ?? "—"}
                        {i.binLocation && <span className="block text-[10px] font-mono">{i.binLocation}</span>}
                      </td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">{formatRelativeTime(i.updatedAt)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setShowMovement(i.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 text-xs font-medium hover:opacity-95 transition-opacity"
                        >
                          <Plus size={11} /> Movement
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* Stock movement dialog */}
      {showMovement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowMovement(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const item = inventory.find((i) => i.id === showMovement);
              if (!item) return null;
              return (
                <>
                  <h3 className="text-base font-semibold text-foreground">Stock Movement</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.name} ({item.sku}) · Current: {item.quantity} {item.unit}</p>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-sm font-medium text-foreground">Movement Type</label>
                      <select
                        value={movementType}
                        onChange={(e) => setMovementType(e.target.value as any)}
                        className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      >
                        <option value="RECEIPT">Receipt (Stock in)</option>
                        <option value="ISSUE">Issue (Stock out)</option>
                        <option value="TRANSFER">Transfer</option>
                        <option value="ADJUSTMENT">Adjustment</option>
                        <option value="RETURN">Return</option>
                        <option value="DISPOSAL">Disposal</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={movementQty}
                        onChange={(e) => setMovementQty(parseInt(e.target.value) || 1)}
                        className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Notes (optional)</label>
                      <textarea
                        value={movementNotes}
                        onChange={(e) => setMovementNotes(e.target.value)}
                        rows={2}
                        placeholder="Reason for movement…"
                        className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-none"
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setShowMovement(null)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => handleMovement(showMovement)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity">
                      Record Movement
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* New Item dialog */}
      {showNewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowNewItem(false)}>
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Add Inventory Item</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Create a new stock-keeping unit (SKU) in the inventory.</p>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">SKU <span className="text-rose-500">*</span></label>
                  <input value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} placeholder="e.g. PPE-HELM-001" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Category</label>
                  <input value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} placeholder="e.g. Safety Equipment" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Item Name <span className="text-rose-500">*</span></label>
                <input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="e.g. Safety Helmet" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Unit</label>
                  <input value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Qty</label>
                  <input type="number" value={itemForm.quantity || ""} onChange={(e) => setItemForm({ ...itemForm, quantity: parseInt(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Unit Cost (₦)</label>
                  <input type="number" value={itemForm.unitCost || ""} onChange={(e) => setItemForm({ ...itemForm, unitCost: parseFloat(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Reorder Level</label>
                  <input type="number" value={itemForm.reorderLevel} onChange={(e) => setItemForm({ ...itemForm, reorderLevel: parseInt(e.target.value) || 10 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Reorder Qty</label>
                  <input type="number" value={itemForm.reorderQty} onChange={(e) => setItemForm({ ...itemForm, reorderQty: parseInt(e.target.value) || 50 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Location</label>
                <input value={itemForm.location} onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })} placeholder="e.g. Store A — Plant 2" className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowNewItem(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!itemForm.sku.trim()) { toast.error("SKU required"); return; }
                  if (!itemForm.name.trim()) { toast.error("Item name required"); return; }
                  createInventoryItem({
                    sku: itemForm.sku.trim(),
                    name: itemForm.name.trim(),
                    category: itemForm.category || "General",
                    unit: itemForm.unit,
                    quantity: itemForm.quantity,
                    reorderLevel: itemForm.reorderLevel,
                    reorderQty: itemForm.reorderQty,
                    unitCost: itemForm.unitCost,
                    currency: "NGN",
                    location: itemForm.location || undefined,
                  } as any);
                  toast.success("Inventory item created", { description: `${itemForm.name} (${itemForm.sku}) added to inventory` });
                  setShowNewItem(false);
                  setItemForm({ sku: "", name: "", category: "", unit: "pcs", quantity: 0, reorderLevel: 10, reorderQty: 50, unitCost: 0, location: "" });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={14} /> Add Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
