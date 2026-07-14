// NextMav Procure — Activity Timeline

"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Package,
  Search,
  Send,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, PageHeader, SectionCard } from "@/components/shared";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { type ActivityLog } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const eventIcon: Record<ActivityLog["eventType"], { icon: LucideIcon; color: string }> = {
  REQUEST_CREATED: { icon: FileText, color: "bg-muted text-muted-foreground" },
  REQUEST_SUBMITTED: { icon: Send, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  REQUEST_APPROVED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  REQUEST_REJECTED: { icon: XCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  REQUEST_COMMENTED: { icon: FileText, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  REQUEST_CANCELLED: { icon: XCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  REQUEST_COMPLETED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  RFQ_CREATED: { icon: FileText, color: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400" },
  RFQ_CANCELLED: { icon: XCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  QUOTATION_RECEIVED: { icon: Activity, color: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" },
  QUOTATION_SELECTED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  PO_GENERATED: { icon: Package, color: "bg-teal-100 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400" },
  PO_ISSUED: { icon: Package, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  PO_STATUS_UPDATED: { icon: Activity, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  PO_REVISED: { icon: FileText, color: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" },
  VENDOR_ADDED: { icon: UserPlus, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  VENDOR_UPDATED: { icon: FileText, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  VENDOR_ARCHIVED: { icon: XCircle, color: "bg-muted text-muted-foreground" },
  VENDOR_BLACKLISTED: { icon: XCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  BUDGET_ALERT: { icon: AlertTriangle, color: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" },
  WORKFLOW_ESCALATION: { icon: AlertTriangle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  USER_LOGIN: { icon: UserPlus, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  USER_LOGOUT: { icon: UserPlus, color: "bg-muted text-muted-foreground" },
  USER_INVITED: { icon: UserPlus, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  USER_ROLE_CHANGED: { icon: UserPlus, color: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" },
  SETTINGS_UPDATED: { icon: FileText, color: "bg-muted text-muted-foreground" },
  PERMISSION_GRANTED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
  PERMISSION_REVOKED: { icon: XCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" },
  STATUS_CHANGE: { icon: Activity, color: "bg-muted text-muted-foreground" },
  COMMENT_ADDED: { icon: FileText, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  FILE_UPLOADED: { icon: FileText, color: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400" },
  AI_QUERY: { icon: Activity, color: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400" },
  AI_SUGGESTION_APPLIED: { icon: CheckCircle2, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" },
};

export function ActivityView() {
  const activities = useStore((s) => s.activities);
  const users = useStore((s) => s.users);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const eventTypes = Array.from(new Set(activities.map((a) => a.eventType)));

  const filtered = useMemo(() => {
    return activities.filter((a) => {
      if (typeFilter !== "ALL" && a.eventType !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!a.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [activities, typeFilter, search]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { label: string; items: ActivityLog[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    filtered.forEach((a) => {
      const d = new Date(a.createdAt);
      const dStr = d.toDateString();
      const label = dStr === today ? "Today" : dStr === yesterday ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
      let group = groups.find((g) => g.label === label);
      if (!group) {
        group = { label, items: [] };
        groups.push(group);
      }
      group.items.push(a);
    });
    return groups;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Timeline"
        description="A complete audit trail of every procurement event in your organization."
      />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activities…"
            className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[200px] text-sm">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All event types</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t.split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Procurement events will appear here as your team works."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{group.label}</p>
              <SectionCard bodyClassName="p-0">
                <div className="relative">
                  {group.items.map((a, idx) => {
                    const user = users.find((u) => u.id === a.userId);
                    const meta = eventIcon[a.eventType] ?? eventIcon.STATUS_CHANGE;
                    const isLast = idx === group.items.length - 1;
                    return (
                      <div key={a.id} className="relative flex gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                        {!isLast && (
                          <div className="absolute left-[26px] top-12 bottom-0 w-px bg-border" />
                        )}
                        <div className={cn("flex h-8 w-8 items-center justify-center rounded-full shrink-0 ring-4 ring-card z-10", meta.color)}>
                          <meta.icon size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground leading-snug">{a.description}</p>
                          <div className="mt-1 flex items-center gap-2">
                            {user && (
                              <div className="flex items-center gap-1.5">
                                <Avatar initials={user.initials} color={user.avatarColor} size="sm" />
                                <span className="text-xs text-muted-foreground">{user.name}</span>
                              </div>
                            )}
                            <span className="text-xs text-muted-foreground/70">·</span>
                            <span className="text-xs text-muted-foreground/70">{formatRelativeTime(a.createdAt)}</span>
                            <span className="text-xs text-muted-foreground/70">·</span>
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{a.eventType.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
