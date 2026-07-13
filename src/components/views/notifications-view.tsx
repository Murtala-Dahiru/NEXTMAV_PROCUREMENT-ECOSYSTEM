// NextMav Procure — Notifications center

"use client";

import { useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { EmptyState, KpiCard, PageHeader, SectionCard } from "@/components/shared";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const typeMeta: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  info: { icon: Bell, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400", label: "Info" },
  success: { icon: Check, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400", label: "Success" },
  warning: { icon: Bell, color: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", label: "Warning" },
  error: { icon: Bell, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400", label: "Error" },
  approval: { icon: Bell, color: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400", label: "Approval" },
};

export function NotificationsView() {
  const notifications = useStore((s) => s.notifications);
  const navigate = useStore((s) => s.navigate);
  const markRead = useStore((s) => s.markNotificationRead);
  const markAllRead = useStore((s) => s.markAllNotificationsRead);

  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");

  const filtered = notifications.filter((n) => filter === "ALL" || !n.read);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Stay on top of approvals, updates, and procurement activity."
        actions={
          unread > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total" value={notifications.length} icon={Bell} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Unread" value={unread} icon={Inbox} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Approvals" value={notifications.filter((n) => n.type === "approval").length} icon={Bell} iconBg="bg-violet-100 dark:bg-violet-950/40" />
        <KpiCard label="Read" value={notifications.length - unread} icon={Check} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setFilter("ALL")}
          className={cn("px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
            filter === "ALL" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter("UNREAD")}
          className={cn("px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
            filter === "UNREAD" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          Unread ({unread})
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No notifications"
          description="You're all caught up. New notifications will appear here."
        />
      ) : (
        <SectionCard bodyClassName="p-0">
          <div className="divide-y divide-border">
            {filtered.map((n) => {
              const meta = typeMeta[n.type] ?? typeMeta.info;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    if (n.link) navigate(n.link as never);
                  }}
                  className={cn(
                    "w-full flex items-start gap-3 px-5 py-4 hover:bg-muted/30 transition-colors text-left",
                    !n.read && "bg-emerald-50/40 dark:bg-emerald-950/15"
                  )}
                >
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg shrink-0", meta.color)}>
                    <meta.icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider", meta.color)}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(n.id);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
                      title="Mark as read"
                    >
                      <Check size={15} />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
