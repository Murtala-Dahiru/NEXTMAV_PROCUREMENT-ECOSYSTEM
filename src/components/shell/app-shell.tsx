// NextMav Procure — Main application shell

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { useStore } from "@/lib/store";
import { DashboardView } from "@/components/views/dashboard-view";
import { RequestsView } from "@/components/views/requests-view";
import { RequestDetailView } from "@/components/views/request-detail-view";
import { RequestFormView } from "@/components/views/request-form-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { VendorsView } from "@/components/views/vendors-view";
import { RfqsView } from "@/components/views/rfqs-view";
import { RfqDetailView } from "@/components/views/rfq-detail-view";
import { RfqFormView } from "@/components/views/rfq-form-view";
import { PurchaseOrdersView } from "@/components/views/purchase-orders-view";
import { PoDetailView } from "@/components/views/po-detail-view";
import { ActivityView } from "@/components/views/activity-view";
import { NotificationsView } from "@/components/views/notifications-view";
import { ReportsView } from "@/components/views/reports-view";
import { SettingsView } from "@/components/views/settings-view";

export function AppShell() {
  const view = useStore((s) => s.view);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderView = () => {
    switch (view) {
      case "dashboard": return <DashboardView />;
      case "requests": return <RequestsView />;
      case "request-detail": return <RequestDetailView />;
      case "request-new": return <RequestFormView />;
      case "approvals": return <ApprovalsView />;
      case "vendors": return <VendorsView />;
      case "rfqs": return <RfqsView />;
      case "rfq-detail": return <RfqDetailView />;
      case "rfq-new": return <RfqFormView />;
      case "purchase-orders": return <PurchaseOrdersView />;
      case "po-detail": return <PoDetailView />;
      case "activity": return <ActivityView />;
      case "notifications": return <NotificationsView />;
      case "reports": return <ReportsView />;
      case "settings": return <SettingsView />;
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
            <span>v1.0.0</span>
            <span className="opacity-40">·</span>
            <span>All systems operational</span>
          </div>
          <div className="flex items-center gap-4">
            <button className="hover:text-foreground transition-colors">Privacy</button>
            <button className="hover:text-foreground transition-colors">Terms</button>
            <button className="hover:text-foreground transition-colors">Status</button>
            <button className="hover:text-foreground transition-colors">Docs</button>
          </div>
        </footer>
      </div>
      <CommandPalette />
    </div>
  );
}
