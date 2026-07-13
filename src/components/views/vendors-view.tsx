// NextMav Procure — Vendor Management

"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Filter,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Star,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, KpiCard, PageHeader, RatingStars, SectionCard, VendorStatusBadge } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { type Vendor, type VendorStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function VendorsView() {
  const navigate = useStore((s) => s.navigate);
  const vendors = useStore((s) => s.vendors);
  const createVendor = useStore((s) => s.createVendor);
  const updateVendor = useStore((s) => s.updateVendor);
  const archiveVendor = useStore((s) => s.archiveVendor);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(vendors.map((v) => v.category))).filter(Boolean).sort(),
    [vendors]
  );

  const filtered = useMemo(() => {
    return vendors
      .filter((v) => {
        if (statusFilter !== "ALL" && v.status !== statusFilter) return false;
        if (categoryFilter !== "ALL" && v.category !== categoryFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const matches =
            v.companyName.toLowerCase().includes(q) ||
            v.contactPerson.toLowerCase().includes(q) ||
            v.email.toLowerCase().includes(q) ||
            v.category.toLowerCase().includes(q);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => b.rating - a.rating || b.totalValue - a.totalValue);
  }, [vendors, statusFilter, categoryFilter, search]);

  const activeCount = vendors.filter((v) => v.status === "ACTIVE").length;
  const prospectiveCount = vendors.filter((v) => v.status === "PROSPECTIVE").length;
  const avgRating = vendors.filter((v) => v.rating > 0).reduce((s, v) => s + v.rating, 0) / (vendors.filter((v) => v.rating > 0).length || 1);
  const totalSpend = vendors.reduce((s, v) => s + v.totalValue, 0);

  const openNewVendor = () => {
    setEditingVendor(null);
    setShowForm(true);
  };

  const openEditVendor = (v: Vendor) => {
    setEditingVendor(v);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Manage your supplier directory. Add new vendors, track ratings, and view order history."
        actions={
          <button
            onClick={openNewVendor}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">Add Vendor</span>
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Vendors" value={vendors.length} icon={Users} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Active" value={activeCount} icon={Building2} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Avg Rating" value={avgRating.toFixed(1)} icon={Star} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Total Spend" value={formatCompactCurrency(totalSpend)} icon={Users} iconBg="bg-teal-100 dark:bg-teal-950/40" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, contact, email, or category…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PROSPECTIVE">Prospective</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
              <SelectItem value="BLACKLISTED">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Vendor grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No vendors found"
          description="Try adjusting filters or add a new vendor."
          action={
            <button
              onClick={openNewVendor}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95"
            >
              <Plus size={15} /> Add Vendor
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((v) => (
            <div
              key={v.id}
              className="group rounded-xl border border-border bg-card p-5 hover:shadow-md hover:shadow-foreground/[0.03] hover:-translate-y-0.5 transition-all cursor-pointer"
              onClick={() => openEditVendor(v)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold text-sm shrink-0">
                    {v.companyName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {v.companyName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{v.category}</p>
                  </div>
                </div>
                <VendorStatusBadge status={v.status} />
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users size={13} className="shrink-0" />
                  <span className="truncate">{v.contactPerson}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail size={13} className="shrink-0" />
                  <span className="truncate">{v.email}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone size={13} className="shrink-0" />
                  <span className="truncate">{v.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin size={13} className="shrink-0" />
                  <span className="truncate">{v.address}</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <RatingStars rating={v.rating} />
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{v.totalOrders} orders</p>
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {formatCompactCurrency(v.totalValue)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vendor form dialog */}
      {showForm && (
        <VendorForm
          vendor={editingVendor}
          onClose={() => setShowForm(false)}
          onSave={(data) => {
            if (editingVendor) {
              updateVendor(editingVendor.id, data);
              toast.success("Vendor updated", { description: `${data.companyName} has been updated.` });
            } else {
              createVendor(data);
              toast.success("Vendor added", { description: `${data.companyName} has been added to your directory.` });
            }
            setShowForm(false);
          }}
          onArchive={editingVendor ? () => {
            archiveVendor(editingVendor.id);
            toast.info(editingVendor.status === "ARCHIVED" ? "Vendor restored" : "Vendor archived", {
              description: editingVendor.companyName,
            });
            setShowForm(false);
          } : undefined}
        />
      )}
    </div>
  );
}

function VendorForm({
  vendor,
  onClose,
  onSave,
  onArchive,
}: {
  vendor: Vendor | null;
  onClose: () => void;
  onSave: (data: Partial<Vendor>) => void;
  onArchive?: () => void;
}) {
  const [form, setForm] = useState({
    companyName: vendor?.companyName ?? "",
    contactPerson: vendor?.contactPerson ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    address: vendor?.address ?? "",
    category: vendor?.category ?? "",
    taxNumber: vendor?.taxNumber ?? "",
    bankName: vendor?.bankName ?? "",
    bankAccount: vendor?.bankAccount ?? "",
    rating: vendor?.rating ?? 0,
  });

  const handleSave = () => {
    if (!form.companyName.trim()) {
      toast.error("Company name required");
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4 z-10">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {vendor ? "Edit Vendor" : "Add New Vendor"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {vendor ? vendor.companyName : "Add a new supplier to your directory"}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-foreground">Company Name <span className="text-rose-500">*</span></label>
              <input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Contact Person</label>
              <input
                value={form.contactPerson}
                onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Category</label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. IT Equipment"
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-foreground">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Tax Number</label>
              <input
                value={form.taxNumber}
                onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Rating (0-5)</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: parseFloat(e.target.value) || 0 })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Bank Name</label>
              <input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Bank Account</label>
              <input
                value={form.bankAccount}
                onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-card px-6 py-4">
          <div>
            {onArchive && vendor && (
              <button
                onClick={onArchive}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {vendor.status === "ARCHIVED" ? "Restore" : "Archive"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              {vendor ? "Save Changes" : "Add Vendor"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
