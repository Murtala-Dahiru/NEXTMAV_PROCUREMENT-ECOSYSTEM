// NextMav Procure — Audit & Security Center

"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  Fingerprint,
  Lock,
  Search,
  Shield,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, KpiCard, PageHeader, SectionCard } from "@/components/shared";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const severityMeta: Record<string, { color: string; icon: LucideIcon }> = {
  INFO: { color: "bg-sky-100 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400", icon: Activity },
  SUCCESS: { color: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  WARNING: { color: "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  CRITICAL: { color: "bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400", icon: AlertTriangle },
};

export function AuditView() {
  const auditLogs = useStore((s) => s.auditLogs);
  const activities = useStore((s) => s.activities);
  const users = useStore((s) => s.users);
  const vendors = useStore((s) => s.vendors);
  const [tab, setTab] = useState<"activity" | "audit" | "security">("activity");
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("ALL");

  const filteredActivities = activities.filter((a) => {
    if (severityFilter !== "ALL" && a.severity !== severityFilter) return false;
    if (search && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredAudit = auditLogs.filter((a) => {
    if (search && !a.action.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const criticalCount = activities.filter((a) => a.severity === "CRITICAL").length;
  const warningCount = activities.filter((a) => a.severity === "WARNING").length;
  const successCount = activities.filter((a) => a.severity === "SUCCESS").length;
  const blacklistedVendors = vendors.filter((v) => v.status === "BLACKLISTED").length;
  const usersWithMfa = users.filter((u) => u.mfaEnabled).length;
  const mfaPct = Math.round((usersWithMfa / users.length) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit & Security Center"
        description="Complete audit trail, security posture, and compliance monitoring."
        actions={
          <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors">
            <Download size={14} />
            <span className="hidden sm:inline">Export Logs</span>
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Events" value={activities.length} icon={Activity} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Critical Events" value={criticalCount} icon={AlertTriangle} iconBg="bg-rose-100 dark:bg-rose-950/40" />
        <KpiCard label="Warnings" value={warningCount} icon={AlertTriangle} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="MFA Adoption" value={`${mfaPct}%`} icon={ShieldCheck} iconBg="bg-emerald-100 dark:bg-emerald-950/40" delta={`${usersWithMfa}/${users.length} users`} deltaType="up" />
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {([
          { key: "activity", label: "Activity Log" },
          { key: "audit", label: "Audit Trail" },
          { key: "security", label: "Security Posture" },
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

      {tab === "activity" && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search activity…"
                className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
            </div>
            <div className="flex gap-2">
              {["ALL", "INFO", "SUCCESS", "WARNING", "CRITICAL"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSeverityFilter(s)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-lg border px-3 text-xs font-medium transition-colors",
                    severityFilter === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-muted"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filteredActivities.length === 0 ? (
            <EmptyState icon={Activity} title="No activity found" description="Try adjusting your filters." />
          ) : (
            <SectionCard bodyClassName="p-0">
              <div className="divide-y divide-border">
                {filteredActivities.map((a) => {
                  const user = users.find((u) => u.id === a.userId);
                  const meta = severityMeta[a.severity] ?? severityMeta.INFO;
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg shrink-0", meta.color)}>
                        <meta.icon size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground leading-snug">{a.description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            {user && <Avatar initials={user.initials} color={user.avatarColor} size="sm" />}
                            {user?.name ?? "System"}
                          </span>
                          <span>·</span>
                          <span>{formatRelativeTime(a.createdAt)}</span>
                          <span>·</span>
                          <span className="font-mono">{a.ipAddress}</span>
                          <span>·</span>
                          <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted">{a.eventType.replace(/_/g, " ")}</span>
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap", meta.color)}>
                        {a.severity}
                      </span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {tab === "audit" && (
        <SectionCard bodyClassName="p-0">
          <div className="divide-y divide-border">
            {filteredAudit.map((a) => {
              const user = users.find((u) => u.id === a.userId);
              return (
                <div key={a.id} className="px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
                      <FileText size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground font-mono">{a.action}</p>
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{a.resource}</span>
                        {a.resourceId && <span className="text-[10px] text-muted-foreground font-mono">{a.resourceId.slice(0, 12)}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{user?.name ?? "Unknown"}</span>
                        <span>·</span>
                        <span className="font-mono">{a.ipAddress}</span>
                        <span>·</span>
                        <span>{a.userAgent}</span>
                        <span>·</span>
                        <span>{formatDateTime(a.timestamp)}</span>
                      </div>
                      {(a.before || a.after) && (
                        <div className="mt-2 grid sm:grid-cols-2 gap-2">
                          {a.before && (
                            <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/15 p-2">
                              <p className="text-[10px] font-medium text-rose-700 dark:text-rose-300 uppercase tracking-wide mb-1">Before</p>
                              <pre className="text-xs text-foreground overflow-x-auto">{JSON.stringify(a.before, null, 2)}</pre>
                            </div>
                          )}
                          {a.after && (
                            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/15 p-2">
                              <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 uppercase tracking-wide mb-1">After</p>
                              <pre className="text-xs text-foreground overflow-x-auto">{JSON.stringify(a.after, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {tab === "security" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: ShieldCheck, title: "Two-Factor Authentication", status: "Enabled", desc: `${usersWithMfa}/${users.length} users enrolled`, color: "emerald" },
              { icon: Lock, title: "Data Encryption", status: "Active", desc: "AES-256 at rest · TLS 1.3 in transit", color: "emerald" },
              { icon: Fingerprint, title: "Audit Logging", status: "Active", desc: `${auditLogs.length} entries · 7-year retention`, color: "emerald" },
              { icon: Shield, title: "Role-Based Access", status: "Configured", desc: "6 roles · 33 permissions", color: "emerald" },
              { icon: AlertTriangle, title: "Blacklisted Vendors", status: `${blacklistedVendors} blocked`, desc: "Prevented from new POs", color: blacklistedVendors > 0 ? "amber" : "emerald" },
              { icon: Activity, title: "Rate Limiting", status: "Active", desc: "100 req/min per IP", color: "emerald" },
            ].map((s) => (
              <div key={s.title} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg",
                    s.color === "emerald" && "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400",
                    s.color === "amber" && "bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                  )}>
                    <s.icon size={18} />
                  </div>
                  <CheckCircle2 size={16} className="text-emerald-500" />
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">{s.status}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
              </div>
            ))}
          </div>

          <SectionCard title="Compliance Certifications" description="Industry-standard security certifications">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { name: "SOC 2 Type II", status: "Certified", date: "Renewed Aug 2025" },
                { name: "ISO 27001", status: "Certified", date: "Renewed Jun 2025" },
                { name: "GDPR", status: "Compliant", date: "Reviewed Jan 2026" },
                { name: "PCI DSS", status: "N/A", date: "Not applicable" },
              ].map((c) => (
                <div key={c.name} className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-500" />
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">{c.status}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.date}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Active Sessions" description="Currently signed-in users">
            <div className="divide-y divide-border">
              {users.filter((u) => u.lastLoginAt && u.status === "ACTIVE").slice(0, 5).map((u) => (
                <div key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar initials={u.initials} color={u.avatarColor} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-foreground">Last active</p>
                    <p className="text-xs text-muted-foreground">{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : "—"}</p>
                  </div>
                  {u.mfaEnabled && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
                      <Lock size={9} /> MFA
                    </span>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
