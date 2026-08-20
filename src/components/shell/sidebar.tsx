// NextMav Procure — Sidebar navigation

"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Brain,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GitBranch,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Package,
  Plug,
  Receipt,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useStore, useUnreadNotificationCount, type ViewKey } from "@/lib/store";
import { cn } from "@/lib/utils";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
  badge?: () => number;
  permission?: import("@/lib/types").Permission;
}

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useStore((s) => s.navigate);
  const currentView = useStore((s) => s.view);
  const organization = useStore((s) => s.organization);
  const requests = useStore((s) => s.requests);
  const rfqs = useStore((s) => s.rfqs);
  const unreadNtf = useUnreadNotificationCount();
  const hasPermission = useStore((s) => s.hasPermission);

  // Pending approvals
  const pendingApprovals = requests.filter(
    (r) => r.approvals.some((a) => a.decision === "PENDING") && (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW")
  ).length;

  // RFQs out with suppliers and still open for responses.
  const liveRfqs = rfqs.filter(
    (r) => r.status === "PUBLISHED" || r.status === "RESPONSE_PERIOD"
  ).length;

  const navSections: { label: string; items: NavItem[] }[] = [
    {
      label: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { key: "command-center", label: "Command Center", icon: BarChart3 },
        { key: "requests", label: "Purchase Requests", icon: ClipboardList },
        { key: "approvals", label: "Approvals", icon: ClipboardCheck, badge: () => pendingApprovals, permission: "requests.approve" },
        { key: "vendors", label: "Vendors", icon: Users, permission: "vendors.view" },
        { key: "supplier-portal", label: "Supplier Portal", icon: Users },
        { key: "request-templates", label: "Templates", icon: FileText },
      ],
    },
    {
      label: "Procurement",
      items: [
        { key: "rfqs", label: "Sourcing", icon: FileText, badge: () => liveRfqs, permission: "rfqs.view" },
        { key: "quotations", label: "Quotations", icon: Receipt, permission: "rfqs.view" },
        { key: "purchase-orders", label: "Purchase Orders", icon: Package, permission: "purchaseOrders.view" },
        { key: "goods-receipts", label: "Goods Receiving", icon: Package },
        { key: "contracts", label: "Contracts", icon: FileText },
        { key: "budgets", label: "Budgets", icon: Wallet, permission: "budgets.view" },
        { key: "reports", label: "Reports", icon: TrendingUp, permission: "reports.view" },
      ],
    },
    {
      label: "Finance",
      items: [
        { key: "invoices", label: "Invoices", icon: Receipt },
        { key: "payments", label: "Payments", icon: Wallet },
      ],
    },
    {
      label: "Operations",
      items: [
        { key: "assets", label: "Assets", icon: Package },
        { key: "inventory", label: "Inventory", icon: Boxes },
        { key: "documents", label: "Documents", icon: FileText },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { key: "ai-assistant", label: "AI Assistant", icon: Bot, permission: "ai.assistant" },
        { key: "integrations", label: "Integrations", icon: Plug, permission: "settings.integrations" },
      ],
    },
    {
      label: "Administration",
      items: [
        { key: "activity", label: "Activity Timeline", icon: Bell },
        { key: "audit", label: "Audit & Security", icon: ShieldCheck, permission: "audit.view" },
        { key: "notifications", label: "Notifications", icon: Bell, badge: () => unreadNtf },
      ],
    },
  ];

  const handleNav = (view: ViewKey) => {
    navigate(view);
    onClose();
  };

  const isActive = (key: ViewKey) => {
    if (currentView === key) return true;
    if (key === "requests" && (currentView === "request-detail" || currentView === "request-new")) return true;
    if (key === "vendors" && currentView === "vendor-detail") return true;
    if (key === "rfqs" && (currentView === "rfq-detail" || currentView === "rfq-new")) return true;
    if (key === "purchase-orders" && currentView === "po-detail") return true;
    return false;
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col transition-transform lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center justify-between px-5 border-b border-sidebar-border">
          <button
            onClick={() => handleNav("dashboard")}
            className="flex items-center gap-2.5 group"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-transform group-hover:scale-105">
              <Sparkles size={16} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold tracking-tight text-sidebar-foreground leading-none">NextMav</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Procure</p>
            </div>
          </button>
          <button onClick={onClose} className="lg:hidden text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Org switcher */}
        <div className="px-3 py-3 border-b border-sidebar-border">
          <button className="group w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-sidebar-accent transition-colors text-left">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-bold shrink-0">
              {organization.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{organization.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{organization.industry} · {organization.plan}</p>
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navSections.map((section) => {
            const visibleItems = section.items.filter((item) => !item.permission || hasPermission(item.permission));
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label}>
                <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = isActive(item.key);
                    const badge = item.badge?.();
                    return (
                      <button
                        key={item.key}
                        onClick={() => handleNav(item.key)}
                        className={cn(
                          "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all",
                          active
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                      >
                        {active && (
                          <motion.div
                            layoutId="sidebar-active"
                            className="absolute inset-0 rounded-lg"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                          />
                        )}
                        <item.icon
                          size={16}
                          className={cn("relative z-10 shrink-0", active ? "text-sidebar-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground")}
                        />
                        <span className="relative z-10 flex-1 text-left">{item.label}</span>
                        {badge ? (
                          <span
                            className={cn(
                              "relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
                              active
                                ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                                : "bg-emerald-500 text-white"
                            )}
                          >
                            {badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border p-3 space-y-0.5">
          <button
            onClick={() => handleNav("settings")}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <Settings size={16} className="text-muted-foreground" />
            <span>Settings</span>
          </button>
          <button
            onClick={() => handleNav("settings-roles")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              isActive("settings-roles") || isActive("settings-workflows") || isActive("settings-team") || isActive("settings-branding") || isActive("settings-integrations") || isActive("settings-security")
                ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <ShieldCheck size={16} className="text-muted-foreground" />
            <span>Roles & Permissions</span>
          </button>
          <button
            onClick={() => handleNav("settings-workflows")}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <GitBranch size={16} className="text-muted-foreground" />
            <span>Workflows</span>
          </button>
          <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors">
            <LifeBuoy size={16} className="text-muted-foreground" />
            <span>Help & Support</span>
          </button>
        </div>
      </aside>
    </>
  );
}
