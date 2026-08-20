// NextMav Procure — the public landing page.
//
// This is the product's front door, and until now the application did not have
// one: `/` rendered the authenticated shell, so an anonymous visitor was
// redirected straight into a sign-in form and never learned what NextMav Procure
// was before being asked to log into it.
//
// Two properties matter more than the copy on it.
//
//   It is reachable without a session. `/` is in the proxy's always-allowed list,
//   so no cookie check stands between a visitor and this page.
//
//   It never redirects. A signed-in visitor is not bounced to /dashboard — the
//   principal is resolved here and the calls-to-action change instead. A redirect
//   would be the one thing on this route capable of forming a loop, and the front
//   door is precisely where a loop must not be possible.
//
// The design is deliberately not new. Palette, brand mark, feature copy and
// compliance badges are the ones already used by the authentication screens, so
// this reads as the same product rather than a second one bolted on.

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gavel,
  LayoutDashboard,
  Receipt,
  Shield,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";
import { getInternalPrincipal } from "@/server/session";
import { APP_HOME } from "@/lib/auth/redirect";

// The header's calls-to-action depend on whether the visitor is signed in, so the
// page is resolved per request rather than baked into a static shell.
export const dynamic = "force-dynamic";

const CAPABILITIES = [
  {
    icon: ClipboardList,
    title: "Purchase requests & approvals",
    desc: "Raise, route and approve requests against configurable multi-level workflows, with delegation and a complete history on every decision.",
  },
  {
    icon: Users,
    title: "Vendor management",
    desc: "Onboard suppliers through a compliance-gated lifecycle: documents, categories, risk posture and approval before a vendor can transact.",
  },
  {
    icon: Gavel,
    title: "Strategic sourcing & RFQ",
    desc: "Run sourcing events end to end — invitations, sealed supplier quotations, weighted evaluation, scoring and a defensible award.",
  },
  {
    icon: Truck,
    title: "Purchase orders & receiving",
    desc: "Issue orders from awarded quotations, track what has actually arrived, and keep outstanding quantities honest against every line.",
  },
  {
    icon: Receipt,
    title: "Invoices & payments",
    desc: "Match invoices to orders and receipts, approve against budget, and manage the payment position with a full settlement trail.",
  },
  {
    icon: BarChart3,
    title: "Analytics & audit",
    desc: "Executive dashboards over live spend, cycle times and supplier performance — on the same audited record the workflow writes.",
  },
];

const PILLARS = [
  {
    icon: Shield,
    title: "Built for enterprise governance",
    desc: "Role-based access control, per-tenant data isolation and an append-only audit trail behind every state change.",
  },
  {
    icon: FileText,
    title: "One record, end to end",
    desc: "A request, its approvals, the RFQ it triggered, the award, the order and the payment are the same object — not six spreadsheets.",
  },
  {
    icon: LayoutDashboard,
    title: "Visibility as it happens",
    desc: "Spend, approvals and supplier activity are read from live operational data, not assembled into a monthly report after the fact.",
  },
];

const FLOW = [
  "Request",
  "Approval",
  "Sourcing",
  "Award",
  "Purchase order",
  "Receipt",
  "Payment",
];

const COMPLIANCE = ["SOC 2 Type II", "ISO 27001", "GDPR Ready"];

export default async function LandingPage() {
  // Resolved, never enforced. Its only effect is which buttons render.
  const principal = await getInternalPrincipal();
  const signedIn = Boolean(principal);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader signedIn={signedIn} />

      <main className="flex-1">
        <Hero signedIn={signedIn} />
        <Pillars />
        <Capabilities />
        <ClosingCta signedIn={signedIn} />
      </main>

      <SiteFooter />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
        <Sparkles size={18} />
      </div>
      <span className="text-lg font-semibold tracking-tight text-foreground">
        NextMav Procure
      </span>
    </Link>
  );
}

function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Brand />

        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link
              href={APP_HOME}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
            >
              Go to workspace
              <ArrowRight size={15} />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-95"
              >
                Create account
                <ArrowRight size={15} />
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 px-6 sm:flex-row">
        <Brand />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {COMPLIANCE.map((c) => (
            <span key={c} className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
              {c}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white">
      <div className="bg-grid absolute inset-0 opacity-10" />
      <div className="absolute -right-24 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />

      <div className="relative mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-200 ring-1 ring-white/15">
            <Sparkles size={13} />
            Procurement and Operations Platform
          </span>

          <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Procurement, finally modern.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-emerald-100/80">
            Replace spreadsheets, WhatsApp messages and paper-based purchasing with one
            centralized, intelligent platform — from the first request through sourcing,
            award, receipt and payment.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {signedIn ? (
              <Link
                href={APP_HOME}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-emerald-950 transition-transform hover:-translate-y-0.5"
              >
                Go to your workspace
                <ArrowRight size={16} />
              </Link>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-emerald-950 transition-transform hover:-translate-y-0.5"
                >
                  Create your account
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-white/10 px-6 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* The lifecycle, stated plainly. It is the clearest single explanation of
            what the platform is, so it sits in the hero rather than further down. */}
        <div className="mt-16 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm text-emerald-100/70">
          {FLOW.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-md bg-white/10 px-2.5 py-1 ring-1 ring-white/10">
                {step}
              </span>
              {i < FLOW.length - 1 && <ArrowRight size={13} className="text-emerald-300/50" />}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-16 sm:grid-cols-3">
        {PILLARS.map((p) => (
          <div key={p.title}>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400 dark:ring-emerald-900">
              <p.icon size={18} />
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
              {p.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
          One system for the whole purchasing lifecycle
        </h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every stage writes to the same record, so nothing has to be reconciled between
          departments, inboxes or spreadsheets at month end.
        </p>
      </div>

      <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400 dark:ring-emerald-900">
              <c.icon size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{c.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClosingCta({ signedIn }: { signedIn: boolean }) {
  if (signedIn) return null;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 px-8 py-14 text-center text-white sm:px-14">
        <div className="bg-grid absolute inset-0 opacity-10" />
        <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance text-3xl font-semibold tracking-tight">
            Set up your organization in minutes
          </h2>
          <p className="mt-3 text-base leading-relaxed text-emerald-100/80">
            Create your workspace and you become its first administrator — ready to invite
            your team, onboard suppliers and raise the first request.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-emerald-950 transition-transform hover:-translate-y-0.5"
            >
              Create your account
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-white/10 px-6 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15"
            >
              Sign in to an existing workspace
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
