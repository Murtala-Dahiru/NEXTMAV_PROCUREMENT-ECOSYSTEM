// NextMav Procure — Payment Tracking

"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CreditCard,
  DollarSign,
  Download,
  Search,
  Wallet,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, PaymentStatusBadge, SectionCard } from "@/components/shared";
import { formatCompactCurrency, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const methodLabels: Record<string, string> = {
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  CASH: "Cash",
  CARD: "Card",
  MOBILE_MONEY: "Mobile Money",
  WIRE: "Wire Transfer",
};

export function PaymentsView() {
  const navigate = useStore((s) => s.navigate);
  const payments = useStore((s) => s.payments);
  const invoices = useStore((s) => s.invoices);
  const vendors = useStore((s) => s.vendors);
  const users = useStore((s) => s.users);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [methodFilter, setMethodFilter] = useState("ALL");

  const filtered = useMemo(() => {
    return payments
      .filter((p) => {
        if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
        if (methodFilter !== "ALL" && p.method !== methodFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const vendor = vendors.find((v) => v.id === p.vendorId);
          const matches = p.paymentNumber.toLowerCase().includes(q) || vendor?.companyName.toLowerCase().includes(q) || (p.reference?.toLowerCase().includes(q) ?? false);
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
  }, [payments, vendors, statusFilter, methodFilter, search]);

  const totalPaid = payments.filter((p) => p.status === "COMPLETED").reduce((s, p) => s + p.amount, 0);
  const pendingPayments = payments.filter((p) => p.status === "PENDING" || p.status === "PROCESSING").reduce((s, p) => s + p.amount, 0);
  const completedCount = payments.filter((p) => p.status === "COMPLETED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Tracking"
        description="Track all outgoing payments to vendors across all payment methods."
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Paid" value={formatCompactCurrency(totalPaid)} icon={DollarSign} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Pending" value={formatCompactCurrency(pendingPayments)} icon={Wallet} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Transactions" value={payments.length} icon={CreditCard} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Completed" value={completedCount} icon={CreditCard} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by payment number, vendor, or reference…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="PROCESSING">Processing</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="h-9 w-[160px] text-sm">
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
            <SelectItem value="CHEQUE">Cheque</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
            <SelectItem value="MOBILE_MONEY">Mobile Money</SelectItem>
            <SelectItem value="WIRE">Wire</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments found" description="Process invoice payments from the Invoices view." />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Payment #</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Vendor</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Invoice</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Method</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Status</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Amount</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-3">Date</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => {
                  const vendor = vendors.find((v) => v.id === p.vendorId);
                  const invoice = invoices.find((i) => i.id === p.invoiceId);
                  const processor = users.find((u) => u.id === p.processedById);
                  return (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-mono text-sm font-medium text-foreground">{p.paymentNumber}</p>
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
                        <span className="text-xs font-mono text-muted-foreground">{invoice?.invoiceNumber ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="inline-flex items-center gap-1 text-xs text-foreground">
                          <CreditCard size={11} className="text-muted-foreground" />
                          {methodLabels[p.method] ?? p.method}
                        </span>
                      </td>
                      <td className="px-3 py-3.5"><PaymentStatusBadge status={p.status} /></td>
                      <td className="px-3 py-3.5 text-right">
                        <p className="text-sm font-semibold text-foreground tabular-nums">{formatCurrency(p.amount, p.currency)}</p>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-muted-foreground">{formatDate(p.paymentDate)}</td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-mono text-muted-foreground">{p.reference ?? "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
