// NextMav Procure — Login / Sign-in view
// Premium SaaS landing + sign-in screen.

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Mail,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/shared";
import { seedUsers } from "@/lib/seed-data";

export function LoginView() {
  const login = useStore((s) => s.login);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("amina.okafor@apex.com");
  const [password, setPassword] = useState("•••••••••");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => login(), 700);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background">
      {/* Left — brand panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-10" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 backdrop-blur ring-1 ring-white/20">
              <Sparkles size={18} className="text-emerald-300" />
            </div>
            <span className="text-lg font-semibold tracking-tight">NextMav Procure</span>
          </div>
        </div>

        <div className="relative max-w-md">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-4xl font-semibold tracking-tight leading-tight text-balance"
          >
            Procurement, finally modern.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-4 text-emerald-100/80 text-lg leading-relaxed"
          >
            Replace spreadsheets, WhatsApp messages, and paper-based purchasing with one centralized, intelligent platform for your entire organization.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-10 space-y-4"
          >
            {[
              { icon: FileText, title: "Complete P2P workflow", desc: "From request to purchase order in minutes" },
              { icon: Users, title: "Multi-level approvals", desc: "Configurable workflow with full audit trail" },
              { icon: BarChart3, title: "Real-time visibility", desc: "Executive dashboards and spend analytics" },
              { icon: Shield, title: "Enterprise-grade security", desc: "RBAC, audit logs, and data isolation" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <f.icon size={16} className="text-emerald-300" />
                </div>
                <div>
                  <p className="font-medium text-sm">{f.title}</p>
                  <p className="text-sm text-emerald-100/60">{f.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="relative flex items-center gap-6 text-sm text-emerald-100/60">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-400" />
            SOC 2 Type II
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-400" />
            ISO 27001
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-400" />
            GDPR Ready
          </div>
        </div>
      </div>

      {/* Right — sign-in form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="flex items-center gap-2.5 lg:hidden mb-8">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Sparkles size={18} />
            </div>
            <span className="text-lg font-semibold tracking-tight">NextMav Procure</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your organization&apos;s workspace</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">Work email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 rounded-lg border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
                <button type="button" className="text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-10 rounded-lg border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-95 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Signing in…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Sign in to workspace
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Or try as</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="mt-5 space-y-2 max-h-72 overflow-y-auto pr-1 -mr-1">
            {seedUsers.slice(0, 6).map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => login(u.id), 400);
                }}
                className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-all"
              >
                <Avatar initials={u.initials} color={u.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.jobTitle}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 capitalize transition-colors">
                  {u.role.split("_").map((w) => w.toLowerCase()).join(" ")}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-6 text-xs text-center text-muted-foreground">
            New organization? <span className="font-medium text-foreground cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">Request a demo</span>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
