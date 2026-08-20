// NextMav Procure — shared shell for every authentication screen.
//
// The brand panel is lifted verbatim from the original sign-in view so the new
// pages are recognisably the same product rather than a second design. It is
// static and identical across the group, so putting it in the layout means it is
// not re-rendered or re-animated when moving between sign-in and sign-up.

import Link from "next/link";
import { BarChart3, CheckCircle2, FileText, Shield, Sparkles, Users } from "lucide-react";

const FEATURES = [
  { icon: FileText, title: "Complete P2P workflow", desc: "From request to purchase order in minutes" },
  { icon: Users, title: "Multi-level approvals", desc: "Configurable workflow with full audit trail" },
  { icon: BarChart3, title: "Real-time visibility", desc: "Executive dashboards and spend analytics" },
  { icon: Shield, title: "Enterprise-grade security", desc: "RBAC, audit logs, and data isolation" },
];

const COMPLIANCE = ["SOC 2 Type II", "ISO 27001", "GDPR Ready"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Left — brand panel. Hidden below lg, where the form needs the full width. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 p-12 text-white lg:flex lg:w-1/2">
        <div className="bg-grid absolute inset-0 opacity-10" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />

        <div className="relative">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Sparkles size={18} className="text-emerald-300" />
            </div>
            <span className="text-lg font-semibold tracking-tight">NextMav Procure</span>
          </Link>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            Procurement, finally modern.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-emerald-100/80">
            Replace spreadsheets, WhatsApp messages, and paper-based purchasing with one
            centralized, intelligent platform for your entire organization.
          </p>

          <div className="mt-10 space-y-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <f.icon size={16} className="text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-sm text-emerald-100/60">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-6 text-sm text-emerald-100/60">
          {COMPLIANCE.map((c) => (
            <div key={c} className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-400" />
              {c}
            </div>
          ))}
        </div>
      </div>

      {/* Right — the active auth screen. */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Sparkles size={18} />
            </div>
            <span className="text-lg font-semibold tracking-tight">NextMav Procure</span>
          </Link>

          {children}
        </div>
      </div>
    </div>
  );
}
