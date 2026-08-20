// NextMav Procure — Supplier Portal Management

"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Package,
  Plus,
  Send,
  ShoppingBag,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, SectionCard, Tag, VendorStatusBadge } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const accessStatusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  SUSPENDED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  REVOKED: "bg-muted text-muted-foreground border-border",
};

const activityTypeIcons: Record<string, any> = {
  RFQ_RECEIVED: ShoppingBag,
  QUOTE_SUBMITTED: FileText,
  PO_ACKNOWLEDGED: Package,
  DELIVERY_CONFIRMED: Check,
  INVOICE_SUBMITTED: FileText,
  PAYMENT_RECEIVED: TrendingUp,
  MESSAGE_RECEIVED: MessageSquare,
  DOCUMENT_UPLOADED: FileText,
};

export function SupplierPortalView() {
  const navigate = useStore((s) => s.navigate);
  const vendors = useStore((s) => s.vendors);
  const supplierPortalUsers = useStore((s) => s.supplierPortalUsers);
  const supplierActivities = useStore((s) => s.supplierActivities);
  const rfqs = useStore((s) => s.rfqs);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const invoices = useStore((s) => s.invoices);
  const payments = useStore((s) => s.payments);
  const grantSupplierAccess = useStore((s) => s.grantSupplierAccess);
  const suspendSupplierAccess = useStore((s) => s.suspendSupplierAccess);
  const revokeSupplierAccess = useStore((s) => s.revokeSupplierAccess);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteVendorId, setInviteVendorId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  const activeCount = supplierPortalUsers.filter((u) => u.accessStatus === "ACTIVE").length;
  const pendingCount = supplierPortalUsers.filter((u) => u.accessStatus === "PENDING").length;
  const totalSupplierValue = vendors.reduce((s, v) => s + v.totalValue, 0);

  const handleInvite = () => {
    if (!inviteVendorId || !inviteEmail || !inviteName) {
      toast.error("All fields required");
      return;
    }
    grantSupplierAccess(inviteVendorId, inviteEmail, inviteName);
    toast.success("Supplier portal access granted", { description: `${inviteName} can now log in to the supplier portal` });
    setShowInvite(false);
    setInviteVendorId("");
    setInviteEmail("");
    setInviteName("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Portal"
        description="Manage vendor portal access. Suppliers can respond to RFQs, confirm orders, submit invoices, and track payments."
        actions={
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> Grant Access
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Suppliers" value={activeCount} icon={Users} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Pending Invites" value={pendingCount} icon={Clock} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Total Supplier Spend" value={formatCompactCurrency(totalSupplierValue)} icon={TrendingUp} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Open RFQs" value={rfqs.filter((r) => r.status === "PUBLISHED" || r.status === "RESPONSE_PERIOD").length} icon={ShoppingBag} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      {/* What suppliers can do */}
      <SectionCard title="Supplier Portal Capabilities" description="Vendors with portal access can perform these actions">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: ShoppingBag, title: "View & Respond to RFQs", desc: "Receive RFQ invitations and submit quotations" },
            { icon: Package, title: "Acknowledge Purchase Orders", desc: "Confirm receipt and acceptance of POs" },
            { icon: Check, title: "Confirm Deliveries", desc: "Update delivery status and tracking" },
            { icon: FileText, title: "Submit Invoices", desc: "Upload invoices against accepted POs" },
            { icon: TrendingUp, title: "Track Payment Status", desc: "View payment history and outstanding balances" },
            { icon: FileText, title: "Upload Compliance Documents", desc: "Submit certificates, insurance, tax docs" },
          ].map((c) => (
            <div key={c.title} className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <c.icon size={15} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{c.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Supplier access table */}
      <SectionCard title="Supplier Portal Access" description={`${supplierPortalUsers.length} vendors with portal accounts`} bodyClassName="p-0">
        <div className="divide-y divide-border">
          {supplierPortalUsers.map((spu) => {
            const vendor = vendors.find((v) => v.id === spu.vendorId);
            if (!vendor) return null;
            const vendorPOs = purchaseOrders.filter((p) => p.vendorId === vendor.id);
            const vendorInvoices = invoices.filter((i) => i.vendorId === vendor.id);
            const vendorPayments = payments.filter((p) => p.vendorId === vendor.id);
            const outstandingBalance = vendorInvoices.filter((i) => i.status !== "PAID").reduce((s, i) => s + i.balance, 0);
            return (
              <div key={spu.id} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold shrink-0">
                    {vendor.companyName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">{vendor.companyName}</p>
                      <VendorStatusBadge status={vendor.status} />
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border", accessStatusColors[spu.accessStatus])}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {spu.accessStatus}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{spu.contactName} · {spu.email}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="text-center">
                      <p className="text-muted-foreground">POs</p>
                      <p className="text-sm font-semibold text-foreground">{vendorPOs.length}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Outstanding</p>
                      <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{formatCompactCurrency(outstandingBalance)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Last Login</p>
                      <p className="text-xs text-foreground">{spu.lastLoginAt ? formatRelativeTime(spu.lastLoginAt) : "Never"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {spu.accessStatus === "ACTIVE" && (
                      <button
                        onClick={() => { suspendSupplierAccess(spu.id); toast.info("Access suspended"); }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-2 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
                      >
                        Suspend
                      </button>
                    )}
                    {spu.accessStatus === "PENDING" && (
                      <button
                        onClick={() => {
                          useStore.setState((s) => ({
                            supplierPortalUsers: s.supplierPortalUsers.map((u) => u.id === spu.id ? { ...u, accessStatus: "ACTIVE" as const } : u),
                          }));
                          toast.success("Access activated");
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-950/60 transition-colors"
                      >
                        <Check size={11} /> Activate
                      </button>
                    )}
                    {(spu.accessStatus === "ACTIVE" || spu.accessStatus === "SUSPENDED") && (
                      <button
                        onClick={() => { if (confirm(`Revoke access for ${vendor.companyName}?`)) { revokeSupplierAccess(spu.id); toast.info("Access revoked"); } }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 px-2 text-xs font-medium hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                      >
                        <X size={11} /> Revoke
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Recent supplier activity */}
      <SectionCard title="Recent Supplier Activity" description="Latest actions from suppliers in the portal">
        <div className="divide-y divide-border">
          {supplierActivities.map((a) => {
            const vendor = vendors.find((v) => v.id === a.vendorId);
            const Icon = activityTypeIcons[a.type] ?? FileText;
            return (
              <div key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{a.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{vendor?.companyName} · {formatRelativeTime(a.createdAt)}</p>
                </div>
                <Tag label={a.type.replace(/_/g, " ").toLowerCase()} />
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Invite dialog */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowInvite(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Grant Supplier Portal Access</h3>
            <p className="text-xs text-muted-foreground mt-0.5">The vendor will receive an email invitation to set up their portal account.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Vendor</label>
                <select
                  value={inviteVendorId}
                  onChange={(e) => {
                    setInviteVendorId(e.target.value);
                    const v = vendors.find((x) => x.id === e.target.value);
                    if (v) {
                      setInviteEmail(v.email);
                      setInviteName(v.contactPerson);
                    }
                  }}
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                >
                  <option value="">Select vendor…</option>
                  {vendors.filter((v) => v.status !== "BLACKLISTED" && !supplierPortalUsers.some((u) => u.vendorId === v.id)).map((v) => (
                    <option key={v.id} value={v.id}>{v.companyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Contact Name</label>
                <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Email</label>
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowInvite(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleInvite} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity">
                <Send size={14} /> Send Invitation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
