// NextMav Procure — Main application shell

"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { useStore } from "@/lib/store";
import { useRealtimeNotifications } from "@/hooks/use-realtime";
import { DashboardView } from "@/components/views/dashboard-view";
import { CommandCenterView } from "@/components/views/command-center-view";
import { RequestsView } from "@/components/views/requests-view";
import { RequestDetailView } from "@/components/views/request-detail-view";
import { RequestFormView } from "@/components/views/request-form-view";
import { TemplatesView } from "@/components/views/templates-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { VendorsView } from "@/components/views/vendors-view";
import { VendorDetailView } from "@/components/views/vendor-detail-view";
import { SupplierPortalView } from "@/components/views/supplier-portal-view";
import { RfqsView } from "@/components/views/rfqs-view";
import { RfqDetailView } from "@/components/views/rfq-detail-view";
import { RfqFormView } from "@/components/views/rfq-form-view";
import { PurchaseOrdersView } from "@/components/views/purchase-orders-view";
import { PoDetailView } from "@/components/views/po-detail-view";
import { GoodsReceiptsView } from "@/components/views/goods-receipts-view";
import { InvoicesView } from "@/components/views/invoices-view";
import { PaymentsView } from "@/components/views/payments-view";
import { ContractsView } from "@/components/views/contracts-view";
import { AssetsView } from "@/components/views/assets-view";
import { InventoryView } from "@/components/views/inventory-view";
import { DocumentsView } from "@/components/views/documents-view";
import { BudgetsView } from "@/components/views/budgets-view";
import { ActivityView } from "@/components/views/activity-view";
import { AuditView } from "@/components/views/audit-view";
import { NotificationsView } from "@/components/views/notifications-view";
import { ReportsView } from "@/components/views/reports-view";
import { AiAssistantView } from "@/components/views/ai-assistant-view";
import { IntegrationsView } from "@/components/views/integrations-view";
import { SettingsView } from "@/components/views/settings-view";
import { RolesPermissionsView } from "@/components/views/roles-permissions-view";
import { WorkflowsView } from "@/components/views/workflows-view";

export function AppShell() {
  const view = useStore((s) => s.view);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isConnected } = useRealtimeNotifications();

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardView />;
      case "command-center": return <CommandCenterView />;
      case "requests": return <RequestsView />;
      case "request-detail": return <RequestDetailView />;
      case "request-new": return <RequestFormView />;
      case "request-templates": return <TemplatesView />;
      case "approvals": return <ApprovalsView />;
      case "vendors": return <VendorsView />;
      case "vendor-detail": return <VendorDetailView />;
      case "supplier-portal": return <SupplierPortalView />;
      case "rfqs": return <RfqsView />;
      case "rfq-detail": return <RfqDetailView />;
      case "rfq-new": return <RfqFormView />;
      case "purchase-orders": return <PurchaseOrdersView />;
      case "po-detail": return <PoDetailView />;
      case "goods-receipts": return <GoodsReceiptsView />;
      case "invoices": return <InvoicesView />;
      case "payments": return <PaymentsView />;
      case "contracts": return <ContractsView />;
      case "assets": return <AssetsView />;
      case "inventory": return <InventoryView />;
      case "documents": return <DocumentsView />;
      case "budgets": return <BudgetsView />;
      case "activity": return <ActivityView />;
      case "audit": return <AuditView />;
      case "notifications": return <NotificationsView />;
      case "reports": return <ReportsView />;
      case "ai-assistant": return <AiAssistantView />;
      case "integrations": return <IntegrationsView />;
      case "settings":
      case "settings-branding":
      case "settings-security":
        return <SettingsView />;
      case "settings-roles":
      case "settings-team":
        return <RolesPermissionsView />;
      case "settings-workflows":
        return <WorkflowsView />;
      case "settings-integrations":
        return <IntegrationsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mx-auto max-w-7xl animate-fade-up"
            >
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="border-t border-border px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span>© 2026 NextMav Procure</span>
            <span className="opacity-40">·</span>
            <span>v2.0.0 Enterprise</span>
            <span className="opacity-40">·</span>
            <span className="flex items-center gap-1">
              <span className={isConnected ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"} />
              {isConnected ? "Real-time connected" : "Connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => useStore.getState().setShortcutsOpen(true)}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Keyboard size={12} /> Shortcuts
            </button>
            <button className="hover:text-foreground transition-colors">Privacy</button>
            <button className="hover:text-foreground transition-colors">Terms</button>
            <button className="hover:text-foreground transition-colors">Status</button>
            <button className="hover:text-foreground transition-colors">Docs</button>
          </div>
        </footer>
      </div>
      <CommandPalette />
      <KeyboardShortcutsOverlay />
    </div>
  );
}

function KeyboardShortcutsOverlay() {
  const shortcutsOpen = useStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const navigate = useStore((s) => s.navigate);

  // Global keyboard shortcuts
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "g": navigate("dashboard"); break;
        case "r": navigate("requests"); break;
        case "a": navigate("approvals"); break;
        case "v": navigate("vendors"); break;
        case "f": navigate("rfqs"); break;
        case "p": navigate("purchase-orders"); break;
        case "b": navigate("budgets"); break;
        case "n": navigate("request-new"); break;
        case "?": setShortcutsOpen(true); break;
        case "escape": setShortcutsOpen(false); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, setShortcutsOpen]);

  if (!shortcutsOpen) return null;

  const shortcuts = [
    { keys: ["⌘", "K"], desc: "Open command palette" },
    { keys: ["?"], desc: "Show this help" },
    { keys: ["G"], desc: "Go to Dashboard" },
    { keys: ["R"], desc: "Go to Requests" },
    { keys: ["A"], desc: "Go to Approvals" },
    { keys: ["V"], desc: "Go to Vendors" },
    { keys: ["F"], desc: "Go to RFQs" },
    { keys: ["P"], desc: "Go to Purchase Orders" },
    { keys: ["B"], desc: "Go to Budgets" },
    { keys: ["N"], desc: "New Purchase Request" },
    { keys: ["Esc"], desc: "Close dialogs" },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShortcutsOpen(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Keyboard size={18} className="text-emerald-500" />
          <h3 className="text-base font-semibold text-foreground">Keyboard Shortcuts</h3>
        </div>
        <div className="space-y-1.5">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground">{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="inline-flex items-center justify-center min-w-6 h-6 rounded border border-border bg-muted px-1.5 text-[10px] font-mono font-medium text-foreground">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground text-center">Shortcuts are disabled while typing in inputs.</p>
      </motion.div>
    </div>
  );
}
