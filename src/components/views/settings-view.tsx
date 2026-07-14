// NextMav Procure — Settings

"use client";

import { useState } from "react";
import {
  Building2,
  Check,
  Globe,
  Moon,
  Palette,
  Shield,
  Sun,
  User,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, KpiCard, PageHeader, SectionCard } from "@/components/shared";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SettingsView() {
  const organization = useStore((s) => s.organization);
  const users = useStore((s) => s.users);
  const branches = useStore((s) => s.branches);
  const departments = useStore((s) => s.departments);
  const currentUser = useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const [activeSection, setActiveSection] = useState<"organization" | "users" | "appearance" | "security">("organization");

  const sections = [
    { key: "organization" as const, label: "Organization", icon: Building2 },
    { key: "users" as const, label: "Team Members", icon: Users },
    { key: "appearance" as const, label: "Appearance", icon: Palette },
    { key: "security" as const, label: "Security", icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your organization, team, preferences, and security."
      />

      {/* Section nav */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2 whitespace-nowrap",
              activeSection === s.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <s.icon size={15} />
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === "organization" && (
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Team Members" value={users.length} icon={Users} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
            <KpiCard label="Branches" value={branches.length} icon={Building2} iconBg="bg-sky-100 dark:bg-sky-950/40" />
            <KpiCard label="Departments" value={departments.length} icon={Building2} iconBg="bg-amber-100 dark:bg-amber-950/40" />
            <KpiCard label="Plan" value="Enterprise" icon={Shield} iconBg="bg-violet-100 dark:bg-violet-950/40" />
          </div>

          <SectionCard title="Organization Profile" description="Basic information about your company">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Display Name</label>
                <input
                  defaultValue={organization.name}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Legal Name</label>
                <input
                  defaultValue={organization.legalName}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Industry</label>
                <input
                  defaultValue={organization.industry}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Country</label>
                <input
                  defaultValue={organization.country}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Currency</label>
                <input
                  defaultValue={organization.currency}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tax ID</label>
                <input
                  defaultValue={organization.taxId}
                  className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity">
                <Check size={14} /> Save Changes
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Branches" description="Manage office locations">
            <div className="space-y-2">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                    <Globe size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{b.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{b.address}, {b.city}, {b.country}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Departments" description={`${departments.length} departments`}>
            <div className="grid sm:grid-cols-2 gap-3">
              {departments.map((d) => (
                <div key={d.id} className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-foreground">{d.name}</p>
                    <span className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                      d.spent / d.budget > 0.8 ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    )}>
                      {Math.round((d.spent / d.budget) * 100)}% used
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Spent ${(d.spent / 1000).toFixed(1)}k of ${(d.budget / 1000).toFixed(1)}k
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", d.spent / d.budget > 0.8 ? "bg-rose-500" : "bg-emerald-500")}
                      style={{ width: `${Math.min((d.spent / d.budget) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {activeSection === "users" && (
        <SectionCard title="Team Members" description={`${users.length} members in your organization`} bodyClassName="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                <Avatar initials={u.initials} color={u.avatarColor} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{u.name}</p>
                    {u.id === currentUser.id && (
                      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">You</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <div className="hidden sm:block min-w-0 flex-1">
                  <p className="text-xs text-foreground">{u.jobTitle}</p>
                  <p className="text-xs text-muted-foreground">{departments.find((d) => d.id === u.departmentId)?.name ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-foreground">
                    {ROLE_LABELS[u.role]}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-1">{ROLE_DESCRIPTIONS[u.role]}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {activeSection === "appearance" && (
        <div className="space-y-6">
          <SectionCard title="Theme" description="Choose how NextMav Procure looks to you">
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                onClick={() => theme !== "light" && toggleTheme()}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-4 transition-all",
                  theme === "light" ? "border-primary ring-2 ring-ring" : "border-border hover:bg-muted/40"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <Sun size={18} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">Light</p>
                  <p className="text-xs text-muted-foreground">Bright and clean</p>
                </div>
                {theme === "light" && <Check size={16} className="text-emerald-500" />}
              </button>

              <button
                onClick={() => theme !== "dark" && toggleTheme()}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-4 transition-all",
                  theme === "dark" ? "border-primary ring-2 ring-ring" : "border-border hover:bg-muted/40"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
                  <Moon size={18} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-foreground">Dark</p>
                  <p className="text-xs text-muted-foreground">Easy on the eyes</p>
                </div>
                {theme === "dark" && <Check size={16} className="text-emerald-500" />}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Color Palette" description="The signature emerald accent palette">
            <div className="flex flex-wrap gap-3">
              {[
                { name: "Emerald (Primary)", color: "bg-emerald-500" },
                { name: "Amber (Accent)", color: "bg-amber-500" },
                { name: "Sky", color: "bg-sky-500" },
                { name: "Rose", color: "bg-rose-500" },
                { name: "Violet", color: "bg-violet-500" },
                { name: "Teal", color: "bg-teal-500" },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                  <div className={cn("h-6 w-6 rounded", c.color)} />
                  <span className="text-xs text-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {activeSection === "security" && (
        <div className="space-y-6">
          <SectionCard title="Security Overview" description="Your account and organization security posture">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-foreground">Two-Factor Authentication</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Enabled on September 14, 2024</p>
              </div>
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-foreground">Audit Logging</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">All actions logged · 7-year retention</p>
              </div>
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-foreground">Data Encryption</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">AES-256 at rest · TLS 1.3 in transit</p>
              </div>
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-foreground">Role-Based Access</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">6 roles configured · Multi-tenant isolation</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Active Sessions" description="Devices currently signed in to your account">
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <User size={15} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Chrome · Lagos, Nigeria</p>
                  <p className="text-xs text-muted-foreground">Current session · Active now</p>
                </div>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">This device</span>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
