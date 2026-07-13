// NextMav Procure — Global command palette / search

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  FileText,
  Package,
  Search,
  Users,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useStore, type ViewKey } from "@/lib/store";
import { formatCurrency, formatRelativeTime } from "@/lib/format";
import { Avatar, PriorityBadge, StatusBadge } from "@/components/shared";

interface SearchResult {
  id: string;
  type: "request" | "vendor" | "po" | "rfq" | "navigation";
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void;
  badge?: React.ReactNode;
  meta?: string;
}

export function CommandPalette() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const navigate = useStore((s) => s.navigate);
  const selectRequest = useStore((s) => s.selectRequest);
  const selectRfq = useStore((s) => s.selectRfq);
  const selectPo = useStore((s) => s.selectPo);
  const requests = useStore((s) => s.requests);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const rfqs = useStore((s) => s.rfqs);
  const users = useStore((s) => s.users);

  // Keyboard shortcut
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
    { label: "Create new Purchase Request", view: "request-new", icon: ArrowRight, hint: "Start a new requisition" },
    { label: "Create new RFQ", view: "rfq-new", icon: ArrowRight, hint: "Solicit vendor quotations" },
    { label: "View Vendors", view: "vendors", icon: ArrowRight, hint: "Manage vendor directory" },
    { label: "View Purchase Orders", view: "purchase-orders", icon: ArrowRight, hint: "All POs" },
    { label: "View Reports", view: "reports", icon: ArrowRight, hint: "Spend analytics" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-2xl">
      <CommandInput placeholder="Search requests, vendors, POs, RFQs… or jump to a page" />
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
                  navigate("vendors");
                  setOpen(false);
                }}
              >
                <Users size={15} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">{v.companyName}</p>
                  <p className="text-xs text-muted-foreground truncate">{v.category} · {v.contactPerson}</p>
                </div>
                <span className="text-xs text-muted-foreground">{v.rating > 0 ? v.rating.toFixed(1) : "New"}</span>
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
