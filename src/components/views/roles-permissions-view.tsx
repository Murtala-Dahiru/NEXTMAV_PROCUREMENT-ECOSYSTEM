// NextMav Procure — Roles & Permissions Matrix

"use client";

import { useState } from "react";
import {
  Check,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, KpiCard, PageHeader, SectionCard, Tag } from "@/components/shared";
import { formatRelativeTime } from "@/lib/format";
import {
  PERMISSION_LABELS,
  ROLE_BADGE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const ROLES: UserRole[] = ["SUPER_ADMIN", "PROCUREMENT_MANAGER", "FINANCE_OFFICER", "DEPARTMENT_MANAGER", "EMPLOYEE", "AUDITOR"];

export function RolesPermissionsView() {
  const users = useStore((s) => s.users);
  const departments = useStore((s) => s.departments);
  const roleOverrides = useStore((s) => s.roleOverrides);
  const grantPermission = useStore((s) => s.grantPermission);
  const revokePermission = useStore((s) => s.revokePermission);
  const resetRolePermissions = useStore((s) => s.resetRolePermissions);
  const inviteUser = useStore((s) => s.inviteUser);
  const updateUserRole = useStore((s) => s.updateUserRole);
  const suspendUser = useStore((s) => s.suspendUser);

  const [tab, setTab] = useState<"matrix" | "users">("matrix");
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  // Get effective permissions for a role (with overrides)
  const getPermissions = (role: UserRole): Permission[] => {
    return roleOverrides[role] ?? ROLE_PERMISSIONS[role] ?? [];
  };

  const categories = Array.from(new Set(Object.values(PERMISSION_LABELS).map((p) => p.category)));

  const filteredPermissions = (search: string) => {
    const perms = Object.keys(PERMISSION_LABELS) as Permission[];
    if (!search) return perms;
    return perms.filter((p) =>
      PERMISSION_LABELS[p].label.toLowerCase().includes(search.toLowerCase()) ||
      PERMISSION_LABELS[p].description.toLowerCase().includes(search.toLowerCase()) ||
      PERMISSION_LABELS[p].category.toLowerCase().includes(search.toLowerCase())
    );
  };

  const handleToggle = (role: UserRole, permission: Permission) => {
    if (role === "SUPER_ADMIN") {
      toast.error("Cannot modify Super Admin", { description: "Super Admin always has all permissions." });
      return;
    }
    const current = getPermissions(role);
    if (current.includes(permission)) {
      revokePermission(role, permission);
    } else {
      grantPermission(role, permission);
    }
  };

  const handleInvite = (data: { name: string; email: string; role: UserRole; jobTitle: string }) => {
    inviteUser(data);
    toast.success("Invitation sent", { description: `${data.name} has been invited as ${ROLE_LABELS[data.role]}.` });
    setShowInvite(false);
  };

  const totalPermissions = Object.keys(PERMISSION_LABELS).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Configure granular role-based access control. Every permission is auditable and customizable."
        actions={
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity"
          >
            <UserPlus size={15} /> Invite User
          </button>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Roles" value={ROLES.length} icon={Shield} iconBg="bg-violet-100 dark:bg-violet-950/40" />
        <KpiCard label="Permissions" value={totalPermissions} icon={Lock} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Team Members" value={users.length} icon={Users} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Active" value={users.filter((u) => u.status === "ACTIVE").length} icon={Check} iconBg="bg-amber-100 dark:bg-amber-950/40" />
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: "matrix", label: "Permission Matrix" },
          { key: "users", label: "Team Members" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "matrix" && (
        <>
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search permissions…"
              className="w-full h-9 rounded-lg border border-input bg-card pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
          </div>

          {categories.map((category) => {
            const permsInCategory = filteredPermissions(search).filter((p) => PERMISSION_LABELS[p].category === category);
            if (permsInCategory.length === 0) return null;
            return (
              <SectionCard
                key={category}
                title={category}
                description={`${permsInCategory.length} permission${permsInCategory.length !== 1 ? "s" : ""}`}
                bodyClassName="p-0"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-5 py-3 sticky left-0 bg-muted/30 z-10">Permission</th>
                        {ROLES.map((role) => (
                          <th key={role} className="px-2 py-3 text-center min-w-[110px]">
                            <div className="flex flex-col items-center gap-1">
                              <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", ROLE_BADGE_COLORS[role])}>
                                {ROLE_LABELS[role]}
                              </span>
                              {roleOverrides[role] && (
                                <span className="text-[9px] text-amber-600 dark:text-amber-400">customized</span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {permsInCategory.map((perm) => (
                        <tr key={perm} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3 sticky left-0 bg-card z-10">
                            <p className="text-sm font-medium text-foreground">{PERMISSION_LABELS[perm].label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{PERMISSION_LABELS[perm].description}</p>
                          </td>
                          {ROLES.map((role) => {
                            const has = getPermissions(role).includes(perm);
                            const isLocked = role === "SUPER_ADMIN";
                            return (
                              <td key={role} className="px-2 py-3 text-center">
                                <button
                                  onClick={() => handleToggle(role, perm)}
                                  disabled={isLocked}
                                  className={cn(
                                    "inline-flex h-6 w-6 items-center justify-center rounded-md transition-all",
                                    has
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                      : "bg-muted text-muted-foreground/40",
                                    !isLocked && "hover:scale-110 cursor-pointer",
                                    isLocked && "cursor-not-allowed opacity-60"
                                  )}
                                  title={isLocked ? "Super Admin permissions cannot be modified" : has ? "Click to revoke" : "Click to grant"}
                                >
                                  {has ? <Check size={13} /> : <Minus size={13} />}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            );
          })}

          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-emerald-500" />
              <p className="text-sm text-foreground">
                Changes to role permissions are logged in the audit trail and applied immediately to all users with that role.
              </p>
            </div>
            <button
              onClick={() => {
                ROLES.forEach((r) => resetRolePermissions(r));
                toast.success("Permissions reset", { description: "All role overrides have been reverted to defaults." });
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              <RotateCcw size={14} /> Reset to defaults
            </button>
          </div>
        </>
      )}

      {tab === "users" && (
        <SectionCard bodyClassName="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => {
              const dept = departments.find((d) => d.id === u.departmentId);
              return (
                <div key={u.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <Avatar initials={u.initials} color={u.avatarColor} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{u.name}</p>
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", ROLE_BADGE_COLORS[u.role])}>
                        {ROLE_LABELS[u.role]}
                      </span>
                      {u.status === "INVITED" && <Tag label="Invited" color="amber" />}
                      {u.status === "SUSPENDED" && <Tag label="Suspended" color="rose" />}
                      {u.mfaEnabled && <Tag label="MFA" color="emerald" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{u.email} · {u.jobTitle} · {dept?.name ?? "No department"}</p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-muted-foreground">Last login</p>
                    <p className="text-xs text-foreground">{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : "Never"}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={u.role}
                      onChange={(e) => {
                        updateUserRole(u.id, e.target.value as UserRole);
                        toast.success("Role updated", { description: `${u.name} is now ${ROLE_LABELS[e.target.value as UserRole]}.` });
                      }}
                      className="h-8 rounded-md border border-border bg-card px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        suspendUser(u.id);
                        toast.info(u.status === "SUSPENDED" ? "User reactivated" : "User suspended", { description: u.name });
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-2 text-xs hover:bg-muted transition-colors"
                    >
                      {u.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Invite dialog */}
      {showInvite && (
        <InviteDialog onClose={() => setShowInvite(false)} onInvite={handleInvite} />
      )}
    </div>
  );
}

function InviteDialog({
  onClose,
  onInvite,
}: {
  onClose: () => void;
  onInvite: (data: { name: string; email: string; role: UserRole; jobTitle: string }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("EMPLOYEE");
  const [jobTitle, setJobTitle] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground">Invite Team Member</h3>
        <p className="text-xs text-muted-foreground mt-0.5">They'll receive an email invitation to join your organization.</p>
        <div className="mt-5 space-y-3">
          <div>
            <label className="text-sm font-medium text-foreground">Full Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Job Title</label>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Procurement Specialist"
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onInvite({ name, email, role, jobTitle })}
            disabled={!name.trim() || !email.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            <Save size={14} /> Send Invitation
          </button>
        </div>
      </div>
    </div>
  );
}
