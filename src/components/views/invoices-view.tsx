// NextMav Procure — Invoice Tracking

"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  Clock,
  DollarSign,
  Download,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, Pagination, SectionCard, InvoiceStatusBadge, SortableHeader } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InvoicesView() {
  const navigate = useStore((s) => s.navigate);
  const invoices = useStore((s) => s.invoices);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const approveInvoice = useStore((s) => s.approveInvoice);
  const rejectInvoice = useStore((s) => s.rejectInvoice);
  const createPayment = useStore((s) => s.createPayment);
  const createInvoice = useStore((s) => s.createInvoice);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showPayDialog, setShowPayDialog] = useState<string | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"BANK_TRANSFER" | "CHEQUE" | "CASH" | "CARD" | "MOBILE_MONEY" | "WIRE">("BANK_TRANSFER");
  const [paymentReference, setPaymentReference] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "issueDate", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // New invoice form state
  const [invForm, setInvForm] = useState({ vendorId: "", poId: "", issueDate: new Date().toISOString().slice(0, 10), dueDate: "", subtotal: 0, taxAmount: 0, notes: "" });

  const filtered = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const vendor = vendors.find((v) => v.id === inv.vendorId);
          const matches = inv.invoiceNumber.toLowerCase().includes(q) || vendor?.companyName.toLowerCase().includes(q) || (inv.notes?.toLowerCase().includes(q) ?? false);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
  }, [invoices, vendors, statusFilter, search]);

  const handleSort = (key: string) => {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  };

  const sorted = useMemo(() => {
    const sortedArr = [...filtered];
    sortedArr.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "invoiceNumber": cmp = a.invoiceNumber.localeCompare(b.invoiceNumber); break;
        case "totalAmount": cmp = a.totalAmount - b.totalAmount; break;
        case "balance": cmp = a.balance - b.balance; break;
        case "dueDate": cmp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(); break;
        case "issueDate": cmp = new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime(); break;
        default: cmp = 0;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return sortedArr;
  }, [filtered, sort]);

  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const totalOutstanding = invoices.filter((i) => i.status !== "PAID" && i.status !== "CANCELLED").reduce((s, i) => s + i.balance, 0);
  const totalOverdue = invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + i.balance, 0);
  const totalPaid = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + i.totalAmount, 0);
  const pendingApproval = invoices.filter((i) => i.status === "SUBMITTED").length;

  const handlePay = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    const vendor = vendors.find((v) => v.id === inv.vendorId);
    createPayment({
      invoiceId,
      vendorId: inv.vendorId,
      amount: inv.balance,
      method: paymentMethod,
      paymentDate: new Date().toISOString(),
      reference: paymentReference || undefined,
    });
    toast.success("Payment processed", { description: `${formatCurrency(inv.balance)} paid to ${vendor?.companyName}` });
    setShowPayDialog(null);
    setPaymentReference("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice Tracking"
        description="Manage vendor invoices, approvals, and payments."
        actions={
          <button
            onClick={() => setShowNewInvoice(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <Plus size={15} /> New Invoice
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Outstanding" value={formatCompactCurrency(totalOutstanding)} icon={DollarSign} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Overdue" value={formatCompactCurrency(totalOverdue)} delta={`${invoices.filter((i) => i.status === "OVERDUE").length} invoices`} deltaType="down" icon={AlertTriangle} iconBg="bg-rose-100 dark:bg-rose-950/40" />
        <KpiCard label="Paid (YTD)" value={formatCompactCurrency(totalPaid)} icon={Check} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Pending Approval" value={pendingApproval} icon={Clock} iconBg="bg-sky-100 dark:bg-sky-950/40" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice number, vendor, or notes…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SUBMITTED">Submitted</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices found" description="Try adjusting your filters." />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3"><SortableHeader label="Invoice #" sortKey="invoiceNumber" currentSort={sort} onSort={handleSort} /></th>
                  <th className="text-left px-3 py-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vendor</span></th>
                  <th className="text-left px-3 py-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PO</span></th>
                  <th className="text-left px-3 py-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span></th>
                  <th className="text-right px-3 py-3"><SortableHeader label="Total" sortKey="totalAmount" currentSort={sort} onSort={handleSort} align="right" /></th>
                  <th className="text-right px-3 py-3"><SortableHeader label="Balance" sortKey="balance" currentSort={sort} onSort={handleSort} align="right" /></th>
                  <th className="text-left px-3 py-3"><SortableHeader label="Due Date" sortKey="dueDate" currentSort={sort} onSort={handleSort} /></th>
                  <th className="text-right px-5 py-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((inv) => {
                  const vendor = vendors.find((v) => v.id === inv.vendorId);
                  const po = purchaseOrders.find((p) => p.id === inv.poId);
                  const isOverdue = inv.status === "OVERDUE" || (inv.status !== "PAID" && new Date(inv.dueDate) < new Date());
                  return (
                    <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-sm font-medium text-foreground">{inv.invoiceNumber}</p>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-[10px] font-semibold shrink-0">
                            {vendor?.companyName.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="text-sm text-foreground truncate">{vendor?.companyName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-xs font-mono text-muted-foreground">{po?.poNumber ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3.5"><InvoiceStatusBadge status={inv.status} /></td>
                      <td className="px-3 py-3.5 text-right">
                        <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(inv.totalAmount, inv.currency)}</p>
                      </td>
                      <td className="px-3 py-3.5 text-right">
                        <p className={cn("text-sm font-medium tabular-nums", inv.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                          {formatCurrency(inv.balance, inv.currency)}
                        </p>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={cn("text-xs", isOverdue ? "text-rose-600 dark:text-rose-400 font-medium" : "text-muted-foreground")}>
                          {formatDate(inv.dueDate)}
                          {isOverdue && inv.status !== "PAID" && " ⚠"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.status === "SUBMITTED" && (
                            <>
                              <button
                                onClick={() => { approveInvoice(inv.id); toast.success("Invoice approved"); }}
                                className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-950/60 transition-colors"
                              >
                                <Check size={12} /> Approve
                              </button>
                              <button
                                onClick={() => { rejectInvoice(inv.id, "Rejected by reviewer"); toast.info("Invoice rejected"); }}
                                className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-2 text-xs font-medium hover:bg-rose-200 dark:hover:bg-rose-950/60 transition-colors"
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}
                          {(inv.status === "APPROVED" || inv.status === "OVERDUE") && (
                            <button
                              onClick={() => setShowPayDialog(inv.id)}
                              className="inline-flex h-7 items-center gap-1 rounded-md bg-primary text-primary-foreground px-2.5 text-xs font-medium hover:opacity-95 transition-opacity"
                            >
                              <DollarSign size={12} /> Pay
                            </button>
                          )}
                          <button className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                            <Download size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </SectionCard>
      )}

      {/* Payment dialog */}
      {showPayDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowPayDialog(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const inv = invoices.find((i) => i.id === showPayDialog);
              const vendor = vendors.find((v) => v.id === inv?.vendorId);
              return (
                <>
                  <h3 className="text-base font-semibold text-foreground">Process Payment</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Pay invoice {inv?.invoiceNumber} from {vendor?.companyName}</p>
                  <div className="mt-4 rounded-lg bg-muted/30 p-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Outstanding Balance</span>
                      <span className="font-semibold text-foreground tabular-nums">{formatCurrency(inv?.balance ?? 0)}</span>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-sm font-medium text-foreground">Payment Method</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as any)}
                        className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      >
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="MOBILE_MONEY">Mobile Money</option>
                        <option value="WIRE">Wire Transfer</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Reference (optional)</label>
                      <input
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        placeholder="Transaction reference"
                        className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setShowPayDialog(null)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => handlePay(showPayDialog)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
                      <DollarSign size={14} /> Confirm Payment
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* New Invoice dialog */}
      {showNewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowNewInvoice(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Create New Invoice</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Record a vendor invoice for tracking and payment.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-foreground">Vendor <span className="text-rose-500">*</span></label>
                <select
                  value={invForm.vendorId}
                  onChange={(e) => setInvForm({ ...invForm, vendorId: e.target.value })}
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                >
                  <option value="">Select vendor…</option>
                  {vendors.filter((v) => v.status !== "BLACKLISTED").map((v) => (
                    <option key={v.id} value={v.id}>{v.companyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Linked PO (optional)</label>
                <select
                  value={invForm.poId}
                  onChange={(e) => setInvForm({ ...invForm, poId: e.target.value })}
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                >
                  <option value="">No linked PO</option>
                  {purchaseOrders.filter((p) => !invForm.vendorId || p.vendorId === invForm.vendorId).map((p) => (
                    <option key={p.id} value={p.id}>{p.poNumber}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Issue Date</label>
                  <input type="date" value={invForm.issueDate} onChange={(e) => setInvForm({ ...invForm, issueDate: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Due Date <span className="text-rose-500">*</span></label>
                  <input type="date" value={invForm.dueDate} onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Subtotal (₦)</label>
                  <input type="number" value={invForm.subtotal || ""} onChange={(e) => setInvForm({ ...invForm, subtotal: parseFloat(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Tax (₦)</label>
                  <input type="number" value={invForm.taxAmount || ""} onChange={(e) => setInvForm({ ...invForm, taxAmount: parseFloat(e.target.value) || 0 })} className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all" />
                </div>
              </div>
              {invForm.subtotal > 0 && (
                <div className="rounded-lg bg-muted/30 p-2.5 flex justify-between text-sm">
                  <span className="text-muted-foreground">Total (Subtotal + Tax)</span>
                  <span className="font-semibold text-foreground tabular-nums">{formatCurrency(invForm.subtotal + invForm.taxAmount)}</span>
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowNewInvoice(false)} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!invForm.vendorId) { toast.error("Vendor required"); return; }
                  if (!invForm.dueDate) { toast.error("Due date required"); return; }
                  if (invForm.subtotal <= 0) { toast.error("Subtotal must be greater than zero"); return; }
                  createInvoice({
                    vendorId: invForm.vendorId,
                    poId: invForm.poId || undefined,
                    issueDate: new Date(invForm.issueDate).toISOString(),
                    dueDate: new Date(invForm.dueDate).toISOString(),
                    subtotal: invForm.subtotal,
                    taxAmount: invForm.taxAmount,
                    notes: invForm.notes || undefined,
                  });
                  toast.success("Invoice created", { description: `Invoice for ${vendors.find((v) => v.id === invForm.vendorId)?.companyName}` });
                  setShowNewInvoice(false);
                  setInvForm({ vendorId: "", poId: "", issueDate: new Date().toISOString().slice(0, 10), dueDate: "", subtotal: 0, taxAmount: 0, notes: "" });
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
              >
                <Plus size={14} /> Create Invoice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
