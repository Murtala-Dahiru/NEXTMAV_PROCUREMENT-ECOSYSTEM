// NextMav Procure — Global command palette / search

"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  ClipboardList,
  FileText,
  GitBranch,
  Package,
  Plug,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useStore, type ViewKey } from "@/lib/store";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import { Avatar, PriorityBadge, StatusBadge } from "@/components/shared";

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const navigate = useStore((s) => s.navigate);
  const selectRequest = useStore((s) => s.selectRequest);
  const selectRfq = useStore((s) => s.selectRfq);
  const selectPo = useStore((s) => s.selectPo);
  const selectVendor = useStore((s) => s.selectVendor);
  const requests = useStore((s) => s.requests);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const rfqs = useStore((s) => s.rfqs);
  const users = useStore((s) => s.users);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  const navItems: { label: string; view: ViewKey; icon: LucideIcon; hint: string }[] = [
    { label: "Dashboard", view: "dashboard", icon: ArrowRight, hint: "Go to overview" },
    { label: "Executive Command Center", view: "command-center", icon: BarChart3, hint: "Executive workspace" },
    { label: "Create new Purchase Request", view: "request-new", icon: ArrowRight, hint: "Start a new requisition" },
    { label: "Create new RFQ", view: "rfq-new", icon: ArrowRight, hint: "Solicit vendor quotations" },
    { label: "Request Templates", view: "request-templates", icon: FileText, hint: "Reusable templates" },
    { label: "Approvals Queue", view: "approvals", icon: ArrowRight, hint: "Pending approvals" },
    { label: "Supplier Portal", view: "supplier-portal", icon: Users, hint: "Vendor portal access" },
    { label: "Goods Receiving", view: "goods-receipts", icon: Package, hint: "Receive deliveries" },
    { label: "Invoices", view: "invoices", icon: FileText, hint: "Invoice tracking" },
    { label: "Payments", view: "payments", icon: Wallet, hint: "Payment tracking" },
    { label: "Contracts", view: "contracts", icon: FileText, hint: "Contract management" },
    { label: "Assets", view: "assets", icon: Package, hint: "Asset management" },
    { label: "Inventory", view: "inventory", icon: Package, hint: "Stock management" },
    { label: "Documents", view: "documents", icon: FileText, hint: "Document repository" },
    { label: "Budget Management", view: "budgets", icon: Wallet, hint: "Track spend" },
    { label: "AI Procurement Assistant", view: "ai-assistant", icon: Bot, hint: "Ask AI anything" },
    { label: "Audit & Security Center", view: "audit", icon: ShieldCheck, hint: "Audit trail" },
    { label: "Approval Workflows", view: "settings-workflows", icon: GitBranch, hint: "Configure workflows" },
    { label: "Roles & Permissions", view: "settings-roles", icon: Users, hint: "Manage access" },
    { label: "Integrations", view: "integrations", icon: Plug, hint: "Connect tools" },
    { label: "Reports & Analytics", view: "reports", icon: ArrowRight, hint: "Spend analytics" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-2xl">
      <CommandInput placeholder="Search requests, vendors, POs, RFQs, or jump to a page… (Press ? for shortcuts)" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick Actions">
          {navItems.map((item) => (
            <CommandItem
              key={item.label}
              onSelect={() => {
                navigate(item.view);
                setOpen(false);
              }}
              className="group"
            >
              <item.icon size={15} className="text-muted-foreground" />
              <span className="flex-1">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {requests.length > 0 && (
          <CommandGroup heading="Purchase Requests">
            {requests.slice(0, 5).map((r) => {
              const requester = users.find((u) => u.id === r.requestedById);
              return (
                <CommandItem
                  key={r.id}
                  onSelect={() => {
                    selectRequest(r.id);
                    navigate("request-detail");
                    setOpen(false);
                  }}
                >
                  <ClipboardList size={15} className="text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{r.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.requestNumber} · {requester?.name} · {formatRelativeTime(r.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {vendors.length > 0 && (
          <CommandGroup heading="Vendors">
            {vendors.slice(0, 5).map((v) => (
              <CommandItem
                key={v.id}
                onSelect={() => {
                  selectVendor(v.id);
                  navigate("vendor-detail");
                  setOpen(false);
                }}
              >
                <Users size={15} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">{v.companyName}</p>
                  <p className="text-xs text-muted-foreground truncate">{v.category} · {v.contactPerson}</p>
                </div>
                <span className="text-xs text-muted-foreground">{v.rating > 0 ? `★ ${v.rating.toFixed(1)}` : "New"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {purchaseOrders.length > 0 && (
          <CommandGroup heading="Purchase Orders">
            {purchaseOrders.slice(0, 5).map((po) => {
              const vendor = vendors.find((v) => v.id === po.vendorId);
              return (
                <CommandItem
                  key={po.id}
                  onSelect={() => {
                    selectPo(po.id);
                    navigate("po-detail");
                    setOpen(false);
                  }}
                >
                  <Package size={15} className="text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{po.poNumber}</p>
                    <p className="text-xs text-muted-foreground truncate">{vendor?.companyName}</p>
                  </div>
                  <span className="text-xs font-medium text-foreground tabular-nums">
                    {formatCurrency(po.totalAmount, po.currency)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {rfqs.length > 0 && (
          <CommandGroup heading="RFQs">
            {rfqs.slice(0, 5).map((rfq) => (
              <CommandItem
                key={rfq.id}
                onSelect={() => {
                  selectRfq(rfq.id);
                  navigate("rfq-detail");
                  setOpen(false);
                }}
              >
                <FileText size={15} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">{rfq.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{rfq.rfqNumber} · {rfq.quotations.length} quotations</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
