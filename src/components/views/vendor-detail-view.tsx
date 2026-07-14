// NextMav Procure — Vendor Detail with compliance, scorecard, history

"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Download,
  FileText,
  Mail,
  MapPin,
  Package,
  Phone,
  Plus,
  Shield,
  Star,
  TrendingUp,
  Truck,
  Upload,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "@/lib/store";
import { Avatar, KpiCard, PageHeader, ProgressBar, RatingStars, SectionCard, Tag, VendorStatusBadge } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function VendorDetailView() {
  const navigate = useStore((s) => s.navigate);
  const vendorId = useStore((s) => s.selectedVendorId);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const activities = useStore((s) => s.activities);
  const updateVendor = useStore((s) => s.updateVendor);
  const blacklistVendor = useStore((s) => s.blacklistVendor);
  const setPreferredVendor = useStore((s) => s.setPreferredVendor);
  const archiveVendor = useStore((s) => s.archiveVendor);
  const addVendorDocument = useStore((s) => s.addVendorDocument);

  const [showDocUpload, setShowDocUpload] = useState(false);
  const [tab, setTab] = useState<"overview" | "compliance" | "orders" | "performance" | "activity">("overview");

  const vendor = vendors.find((v) => v.id === vendorId);

  if (!vendor) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate("vendors")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to vendors
        </button>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Vendor not found.</p>
        </div>
      </div>
    );
  }

  const vendorPOs = purchaseOrders.filter((p) => p.vendorId === vendor.id);
  const vendorActivities = activities.filter((a) => a.vendorId === vendor.id);
  const expiredDocs = vendor.documents.filter((d) => d.status === "EXPIRED");
  const expiringDocs = vendor.documents.filter((d) => d.status === "EXPIRING");

  // Performance trend (simulated)
  const performanceData = Array.from({ length: 6 }).map((_, i) => ({
    month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"][i],
    onTime: Math.min(100, vendor.onTimeDeliveryRate + (Math.random() - 0.5) * 20),
    quality: Math.min(5, vendor.qualityRating + (Math.random() - 0.5) * 1),
  }));

  const handleAddDocument = (type: any, name: string, expiresAt?: string) => {
    addVendorDocument(vendor.id, {
      type,
      name,
      fileName: name.toLowerCase().replace(/\s+/g, "-") + ".pdf",
      fileSize: "245 KB",
      expiresAt,
      status: expiresAt ? (new Date(expiresAt) < new Date() ? "EXPIRED" : new Date(expiresAt) < new Date(Date.now() + 30 * 86400000) ? "EXPIRING" : "VALID") : "VALID",
    });
    toast.success("Document uploaded", { description: name });
    setShowDocUpload(false);
  };

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate("vendors")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Back to vendors
      </button>

      <PageHeader
        title={vendor.companyName}
        description={`${vendor.category} · Vendor since ${formatDate(vendor.createdAt)}`}
        actions={
          <>
            <VendorStatusBadge status={vendor.status} />
            <button
              onClick={() => {
                setPreferredVendor(vendor.id);
                toast.success("Marked as preferred", { description: vendor.companyName });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-sm font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-400 transition-colors"
            >
              <Award size={14} /> Preferred
            </button>
            <button
              onClick={() => {
                if (confirm(`Blacklist ${vendor.companyName}? This will prevent new POs.`)) {
                  blacklistVendor(vendor.id);
                  toast.error("Vendor blacklisted", { description: vendor.companyName });
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 transition-colors"
            >
              <Ban size={14} /> Blacklist
            </button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Orders" value={vendor.totalOrders} icon={Package} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Total Spend" value={formatCompactCurrency(vendor.totalValue)} icon={DollarSign} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="On-Time Delivery" value={`${vendor.onTimeDeliveryRate}%`} icon={Truck} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Compliance Score" value={`${vendor.complianceScore}/100`} icon={Shield} iconBg={vendor.complianceScore > 80 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-rose-100 dark:bg-rose-950/40"} />
      </div>

      {/* Compliance alerts */}
      {(expiredDocs.length > 0 || expiringDocs.length > 0) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Compliance attention required</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {expiredDocs.length > 0 && `${expiredDocs.length} document(s) expired. `}
                {expiringDocs.length > 0 && `${expiringDocs.length} document(s) expiring soon. `}
                Request updated copies from the vendor.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {([
          { key: "overview", label: "Overview" },
          { key: "compliance", label: `Compliance (${vendor.documents.length})` },
          { key: "orders", label: `Orders (${vendorPOs.length})` },
          { key: "performance", label: "Performance" },
          { key: "activity", label: "Activity" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 whitespace-nowrap",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <SectionCard title="Contact Information">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 text-sm">
                    <Building2 size={15} className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Contact Person</p>
                      <p className="text-foreground font-medium">{vendor.contactPerson}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <Mail size={15} className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-foreground font-medium">{vendor.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <Phone size={15} className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="text-foreground font-medium">{vendor.phone}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 text-sm">
                    <MapPin size={15} className="text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-xs text-muted-foreground">Address</p>
                      <p className="text-foreground font-medium">{vendor.address}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <FileText size={15} className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Tax Number</p>
                      <p className="text-foreground font-medium">{vendor.taxNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <DollarSign size={15} className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Payment Terms</p>
                      <p className="text-foreground font-medium">{vendor.paymentTerms}</p>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Banking Details">
              <dl className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Bank Name</dt>
                  <dd className="text-foreground font-medium mt-0.5">{vendor.bankName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Account Number</dt>
                  <dd className="text-foreground font-medium mt-0.5 font-mono">{vendor.bankAccount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Preferred Currency</dt>
                  <dd className="text-foreground font-medium mt-0.5">{vendor.preferredCurrency}</dd>
                </div>
              </dl>
            </SectionCard>

            {vendor.notes && (
              <SectionCard title="Internal Notes">
                <p className="text-sm text-foreground leading-relaxed">{vendor.notes}</p>
              </SectionCard>
            )}

            {vendor.tags.length > 0 && (
              <SectionCard title="Tags">
                <div className="flex flex-wrap gap-2">
                  {vendor.tags.map((t) => (
                    <Tag key={t} label={t} />
                  ))}
                </div>
              </SectionCard>
            )}
          </div>

          <div className="space-y-6">
            <SectionCard title="Performance Scorecard">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Overall Rating</span>
                    <RatingStars rating={vendor.rating} size={12} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">On-Time Delivery</span>
                    <span className="text-xs font-medium text-foreground tabular-nums">{vendor.onTimeDeliveryRate}%</span>
                  </div>
                  <ProgressBar value={vendor.onTimeDeliveryRate} size="sm" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Quality Rating</span>
                    <span className="text-xs font-medium text-foreground tabular-nums">{vendor.qualityRating > 0 ? vendor.qualityRating.toFixed(1) : "N/A"}/5</span>
                  </div>
                  <ProgressBar value={(vendor.qualityRating / 5) * 100} size="sm" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Compliance Score</span>
                    <span className="text-xs font-medium text-foreground tabular-nums">{vendor.complianceScore}/100</span>
                  </div>
                  <ProgressBar value={vendor.complianceScore} size="sm" />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Summary">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Total Orders</dt>
                  <dd className="text-foreground font-medium">{vendor.totalOrders}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Total Value</dt>
                  <dd className="text-foreground font-medium">{formatCurrency(vendor.totalValue)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Avg Order Value</dt>
                  <dd className="text-foreground font-medium">{vendor.totalOrders > 0 ? formatCurrency(vendor.totalValue / vendor.totalOrders) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Documents</dt>
                  <dd className="text-foreground font-medium">{vendor.documents.length}</dd>
                </div>
              </dl>
            </SectionCard>
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <SectionCard
          title="Compliance Documents"
          description="Certificates, insurance, tax documents, and other vendor credentials"
          action={
            <button
              onClick={() => setShowDocUpload(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-95 transition-opacity"
            >
              <Upload size={13} /> Upload Document
            </button>
          }
          bodyClassName="p-0"
        >
          {vendor.documents.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <FileText size={28} className="mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-foreground">No documents on file</p>
              <p className="text-xs text-muted-foreground mt-1">Upload compliance documents, certificates, and insurance proofs.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vendor.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                    doc.status === "VALID" && "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
                    doc.status === "EXPIRING" && "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400",
                    doc.status === "EXPIRED" && "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400",
                    doc.status === "PENDING_REVIEW" && "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400"
                  )}>
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                      <Tag label={doc.type.replace("_", " ")} color={doc.type === "CERTIFICATE" ? "emerald" : doc.type === "INSURANCE" ? "amber" : "default"} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {doc.fileName} · {doc.fileSize} · Uploaded {formatRelativeTime(doc.uploadedAt)}
                      {doc.expiresAt && ` · Expires ${formatDate(doc.expiresAt)}`}
                    </p>
                  </div>
                  <span className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap",
                    doc.status === "VALID" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                    doc.status === "EXPIRING" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                    doc.status === "EXPIRED" && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                    doc.status === "PENDING_REVIEW" && "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                  )}>
                    {doc.status.replace("_", " ")}
                  </span>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <Download size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {tab === "orders" && (
        <SectionCard title="Purchase Orders" description={`${vendorPOs.length} POs issued to this vendor`} bodyClassName="p-0">
          {vendorPOs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Package size={28} className="mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">No purchase orders yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vendorPOs.map((po) => (
                <button
                  key={po.id}
                  onClick={() => {
                    useStore.getState().selectPo(po.id);
                    navigate("po-detail");
                  }}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                    <Package size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground font-mono">{po.poNumber}</p>
                    <p className="text-xs text-muted-foreground">Issued {formatDate(po.issuedAt)} · {po.lineItems.length} items</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(po.totalAmount)}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{po.status.toLowerCase().replace("_", " ")}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {tab === "performance" && (
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <KpiCard label="On-Time Delivery" value={`${vendor.onTimeDeliveryRate}%`} icon={Truck} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
            <KpiCard label="Quality Rating" value={vendor.qualityRating > 0 ? vendor.qualityRating.toFixed(1) : "N/A"} icon={Star} iconBg="bg-amber-100 dark:bg-amber-950/40" />
            <KpiCard label="Avg Order Value" value={vendor.totalOrders > 0 ? formatCompactCurrency(vendor.totalValue / vendor.totalOrders) : "—"} icon={DollarSign} iconBg="bg-sky-100 dark:bg-sky-950/40" />
            <KpiCard label="Total Orders" value={vendor.totalOrders} icon={Package} iconBg="bg-violet-100 dark:bg-violet-950/40" />
          </div>

          <SectionCard title="Delivery Performance Trend" description="On-time delivery rate over the last 6 months">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 150)" vertical={false} />
                  <XAxis dataKey="month" stroke="oklch(0.55 0.02 160)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="oklch(0.55 0.02 160)" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.008 150)", borderRadius: "0.5rem", fontSize: "12px" }} formatter={(v: number) => [`${v.toFixed(1)}%`, "On-time"]} />
                  <Area type="monotone" dataKey="onTime" stroke="#10b981" strokeWidth={2.5} fill="url(#perfGrad)" dot={{ fill: "#10b981", r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "activity" && (
        <SectionCard title="Vendor Activity" description="All events related to this vendor" bodyClassName="p-0">
          {vendorActivities.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Clock size={28} className="mx-auto text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">No activity recorded.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {vendorActivities.map((a) => (
                <div key={a.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                  <p className="text-sm text-foreground">{a.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(a.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* Document upload dialog */}
      {showDocUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowDocUpload(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Upload Document</h3>
              <button onClick={() => setShowDocUpload(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {[
                { type: "CERTIFICATE", label: "Certificate", desc: "ISO, HSE, quality certifications" },
                { type: "INSURANCE", label: "Insurance", desc: "Liability, workers comp" },
                { type: "TAX", label: "Tax Document", desc: "Tax clearance, VAT certificate" },
                { type: "BANK_PROOF", label: "Bank Proof", desc: "Account verification" },
              ].map((d) => (
                <button
                  key={d.type}
                  onClick={() => handleAddDocument(d.type as any, d.label)}
                  className="w-full flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                    <FileText size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{d.label}</p>
                    <p className="text-xs text-muted-foreground">{d.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
