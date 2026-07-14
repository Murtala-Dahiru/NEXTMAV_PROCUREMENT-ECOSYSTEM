// NextMav Procure — AI Procurement Assistant
// Conversational AI powered by z-ai-web-dev-sdk on the backend.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  Copy,
  FileText,
  Lightbulb,
  Loader2,
  Send,
  Sparkles,
  TrendingDown,
  User,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar, KpiCard, PageHeader, SectionCard } from "@/components/shared";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  suggestions?: string[];
}

const QUICK_PROMPTS = [
  {
    icon: FileText,
    title: "Summarize pending requests",
    prompt: "Summarize all pending purchase requests and highlight which ones need urgent attention.",
  },
  {
    icon: TrendingDown,
    title: "Identify cost savings",
    prompt: "Analyze our vendor spend and identify opportunities to reduce costs.",
  },
  {
    icon: AlertTriangle,
    title: "Detect procurement risks",
    prompt: "What procurement risks should I be aware of right now?",
  },
  {
    icon: Lightbulb,
    title: "Suggest vendors",
    prompt: "Which vendors should we consider for our next IT equipment purchase?",
  },
  {
    icon: Brain,
    title: "Generate justification",
    prompt: "Help me write a business justification for purchasing 5 new engineering workstations.",
  },
  {
    icon: Sparkles,
    title: "Approval bottleneck analysis",
    prompt: "Where are the bottlenecks in our approval workflow?",
  },
];

export function AiAssistantView() {
  const requests = useStore((s) => s.requests);
  const vendors = useStore((s) => s.vendors);
  const purchaseOrders = useStore((s) => s.purchaseOrders);
  const departments = useStore((s) => s.departments);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.users.find((u) => u.id === s.currentUserId)!);
  const navigate = useStore((s) => s.navigate);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Hello ${currentUser.name.split(" ")[0]}! I'm your AI procurement assistant. I can help you analyze spending, summarize requests, suggest vendors, draft justifications, detect risks, and answer procurement questions. What would you like to explore?`,
      timestamp: new Date().toISOString(),
      suggestions: ["Summarize pending requests", "Identify cost savings", "Detect procurement risks"],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const generateLocalResponse = (prompt: string): { content: string; suggestions?: string[] } => {
    const p = prompt.toLowerCase();
    const pendingReqs = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");
    const totalSpend = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);
    const topVendors = [...vendors].sort((a, b) => b.totalValue - a.totalValue).slice(0, 3);

    if (p.includes("summar") && (p.includes("pending") || p.includes("request"))) {
      const urgent = pendingReqs.filter((r) => r.priority === "URGENT" || r.priority === "HIGH");
      const totalValue = pendingReqs.reduce((s, r) => s + r.totalEstimated, 0);
      return {
        content: `Here's a summary of your pending procurement activity:\n\n**Pending Requests: ${pendingReqs.length}** (total value: ${formatCurrency(totalValue)})\n\n**Urgent/High Priority:**\n${urgent.map((r) => `• ${r.requestNumber} — ${r.title} (${formatCurrency(r.totalEstimated)}, ${r.priority.toLowerCase()})`).join("\n")}\n\n**Action Required:** ${urgent.length} requests need immediate attention. The highest-value pending item is "${urgent[0]?.title ?? "N/A"}" at ${formatCurrency(urgent[0]?.totalEstimated ?? 0)}.`,
        suggestions: ["Show approval bottlenecks", "Which vendors are involved?", "Generate a report"],
      };
    }

    if (p.includes("cost") || p.includes("saving") || p.includes("reduce")) {
      const avgRating = vendors.filter((v) => v.rating > 0).reduce((s, v) => s + v.rating, 0) / (vendors.filter((v) => v.rating > 0).length || 1);
      const lowRated = vendors.filter((v) => v.rating > 0 && v.rating < 4 && v.totalOrders > 0);
      return {
        content: `**Cost Savings Analysis**\n\nBased on your procurement data:\n\n• **Total spend YTD:** ${formatCurrency(totalSpend)}\n• **Active vendors:** ${vendors.filter((v) => v.status === "ACTIVE").length}\n• **Average vendor rating:** ${avgRating.toFixed(1)}/5\n\n**Savings opportunities:**\n1. **Consolidate vendors** — You have ${vendors.filter((v) => v.category === "Construction Materials").length} construction material vendors. Consolidating to 2-3 strategic partners could yield 8-12% volume discounts.\n2. **Review underperforming vendors** — ${lowRated.length} vendors have ratings below 4.0 with active orders. Renegotiating or replacing them could improve quality and pricing.\n3. **RFQ competition** — Your last 3 RFQs showed price variance of up to 21% between vendors. Always invite at least 3 vendors to quote.\n4. **Payment terms** — Switching from Net 15 to Net 30 where possible could improve cash flow by ~${formatCompactCurrency(totalSpend * 0.08)} annually.`,
        suggestions: ["Show underperforming vendors", "Compare RFQ quotations", "Suggest alternative vendors"],
      };
    }

    if (p.includes("risk") || p.includes("bottleneck") || p.includes("delay")) {
      const pendingApprovals = requests.flatMap((r) => r.approvals).filter((a) => a.decision === "PENDING");
      const slaBreached = pendingApprovals.filter((a) => new Date(a.slaExpiresAt) < new Date());
      const expiringQuotes = useStore.getState().rfqs.filter((r) => r.status === "WAITING" && new Date(r.deadline) < new Date(Date.now() + 3 * 86400000));
      const blacklisted = vendors.filter((v) => v.status === "BLACKLISTED");
      const expiringDocs = vendors.flatMap((v) => v.documents).filter((d) => d.status === "EXPIRED" || d.status === "EXPIRING");
      return {
        content: `**Procurement Risk Assessment**\n\n🚨 **Critical risks identified:**\n\n1. **SLA breaches** — ${slaBreached.length} approval(s) have breached their SLA. Affected requests should be escalated immediately.\n\n2. **Compliance gaps** — ${expiringDocs.length} vendor document(s) are expired or expiring. This includes insurance and certifications that may affect regulatory compliance.\n\n3. **Blacklisted vendors** — ${blacklisted.length} vendor(s) are blacklisted. Ensure no new POs are issued to them.\n\n4. **Expiring RFQs** — ${expiringQuotes.length} RFQ(s) have deadlines within 3 days. Follow up with non-responding vendors.\n\n5. **Budget utilization** — Engineering department is at 78% of annual budget. Further large requests should be reviewed carefully.\n\n**Recommendation:** Address SLA breaches first, then compliance gaps. Set up automated alerts for these risk categories.`,
        suggestions: ["Show SLA breaches", "List expired documents", "View budget alerts"],
      };
    }

    if (p.includes("vendor") && (p.includes("suggest") || p.includes("recommend") || p.includes("it"))) {
      const itVendors = vendors.filter((v) => v.category === "IT Equipment" && v.status !== "BLACKLISTED");
      return {
        content: `**Vendor Recommendations for IT Equipment**\n\nBased on your organization's history and vendor performance:\n\n${itVendors.map((v, i) => `**${i + 1}. ${v.companyName}**\n   • Rating: ${v.rating > 0 ? v.rating.toFixed(1) : "New"}/5\n   • Past orders: ${v.totalOrders} (${formatCurrency(v.totalValue)})\n   • On-time delivery: ${v.onTimeDeliveryRate}%\n   • Compliance score: ${v.complianceScore}/100\n   • Status: ${v.status.toLowerCase()}`).join("\n\n")}\n\n**Recommendation:** ${itVendors[0]?.companyName ?? "TechCore Distributors"} is your strongest partner with the highest rating and proven track record. For bulk IT purchases, consider inviting all 3 to RFQ for competitive pricing.\n\n**Tip:** Global Equipment Trading offers premium international brands with longer warranties if quality is prioritized over cost.`,
        suggestions: ["Compare vendor prices", "Show vendor compliance", "Create new RFQ"],
      };
    }

    if (p.includes("justification") || p.includes("business case")) {
      return {
        content: `**Business Justification Template — Engineering Workstations**\n\nHere's a draft justification you can adapt:\n\n---\n\nThe engineering team requires 5 new workstations to support the Q3 site expansion and the upcoming Plant 2 commissioning project. Current hardware (3-year-old units) cannot efficiently run the latest CAD and simulation software, resulting in:\n\n• **Productivity loss:** Estimated 4-6 hours/week/engineer in render and analysis wait times (total: 100-150 hours/month)\n• **Project risk:** Inadequate hardware may delay the Plant 2 commissioning timeline, affecting downstream operations\n• **Competitive parity:** Industry-standard engineering workstations are now expected for BIM, FEA, and 3D modeling workflows\n\n**Financial impact:**\n- Total investment: $14,000 (5 × $2,800)\n- ROI: Productivity recovery valued at $18,750/month (150 hrs × $125/hr fully-loaded rate)\n- Payback period: Less than 1 month\n- 3-year TCO advantage: $42,000+ in recovered productivity\n\n**Recommendation:** Approve as URGENT priority to avoid Plant 2 project delays.\n\n---\n\nWould you like me to adjust the quantities, costs, or business case framing?`,
        suggestions: ["Adjust quantities", "Make it more concise", "Add compliance language"],
      };
    }

    // Default response with helpful pointers
    return {
      content: `I can help you with that. Here are some specific analyses I can run based on your current procurement data:\n\n• **Pending requests:** ${pendingReqs.length} awaiting action (${formatCurrency(pendingReqs.reduce((s, r) => s + r.totalEstimated, 0))})\n• **Total spend:** ${formatCurrency(totalSpend)} across ${purchaseOrders.length} purchase orders\n• **Vendor directory:** ${vendors.length} vendors, ${vendors.filter((v) => v.status === "ACTIVE").length} active\n• **Top vendor:** ${topVendors[0]?.companyName ?? "N/A"} (${formatCurrency(topVendors[0]?.totalValue ?? 0)})\n\nTry asking me to:\n- "Summarize pending requests"\n- "Identify cost savings"\n- "Detect procurement risks"\n- "Suggest vendors for [category]"\n- "Generate a justification for [item]"\n- "Show approval bottlenecks"`,
      suggestions: ["Summarize pending requests", "Identify cost savings", "Detect procurement risks"],
    };
  };

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: prompt, timestamp: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    // Try calling backend AI API first, fall back to local response
    try {
      const res = await fetch("/api/ai?XTransformPort=3001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          context: {
            organization: "Apex Industries",
            pendingRequests: requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW").length,
            totalSpend: purchaseOrders.reduce((s, p) => s + p.totalAmount, 0),
            vendorCount: vendors.length,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.response ?? "I couldn't process that request.",
          timestamp: new Date().toISOString(),
          suggestions: data.suggestions ?? ["Summarize pending requests", "Identify cost savings"],
        };
        setMessages((m) => [...m, assistantMsg]);
      } else {
        throw new Error("API failed");
      }
    } catch {
      // Fallback to local generation
      await new Promise((r) => setTimeout(r, 800));
      const response = generateLocalResponse(prompt);
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response.content,
        timestamp: new Date().toISOString(),
        suggestions: response.suggestions,
      };
      setMessages((m) => [...m, assistantMsg]);
    } finally {
      setLoading(false);
    }
  };

  const pendingCount = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW").length;
  const totalSpend = purchaseOrders.reduce((s, p) => s + p.totalAmount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Procurement Assistant"
        description="Intelligent insights, summaries, and recommendations powered by AI. Ask anything about your procurement operations."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Sparkles size={12} /> AI Powered
          </span>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending Requests" value={pendingCount} icon={FileText} iconBg="bg-amber-100 dark:bg-amber-950/40" />
        <KpiCard label="Total Spend" value={formatCompactCurrency(totalSpend)} icon={TrendingDown} iconBg="bg-emerald-100 dark:bg-emerald-950/40" />
        <KpiCard label="Active Vendors" value={vendors.filter((v) => v.status === "ACTIVE").length} icon={User} iconBg="bg-sky-100 dark:bg-sky-950/40" />
        <KpiCard label="Avg Approval Time" value="2.4h" icon={Brain} iconBg="bg-violet-100 dark:bg-violet-950/40" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chat */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Conversation"
            bodyClassName="p-0"
            className="overflow-hidden"
          >
            <div ref={scrollRef} className="h-[500px] overflow-y-auto p-5 space-y-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg shrink-0",
                      m.role === "assistant" ? "bg-emerald-600 text-white" : "bg-muted text-foreground"
                    )}
                  >
                    {m.role === "assistant" ? <Bot size={16} /> : <User size={16} />}
                  </div>
                  <div className={cn("max-w-[80%]", m.role === "user" && "text-right")}>
                    <div
                      className={cn(
                        "rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap text-left",
                        m.role === "assistant"
                          ? "bg-muted text-foreground"
                          : "bg-emerald-600 text-white"
                      )}
                    >
                      {m.content}
                    </div>
                    {m.suggestions && m.suggestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.suggestions.map((s, j) => (
                          <button
                            key={j}
                            onClick={() => sendPrompt(s)}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted hover:border-emerald-300 transition-colors"
                          >
                            <Sparkles size={10} className="text-emerald-500" />
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <Bot size={16} />
                  </div>
                  <div className="rounded-xl bg-muted px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 size={14} className="animate-spin" />
                      Analyzing your procurement data…
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-border p-3 flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendPrompt(input);
                  }
                }}
                placeholder="Ask about requests, vendors, spending, risks…"
                className="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
              />
              <button
                onClick={() => sendPrompt(input)}
                disabled={!input.trim() || loading}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-95 transition-opacity disabled:opacity-50"
              >
                <Send size={15} />
              </button>
            </div>
          </SectionCard>
        </div>

        {/* Quick prompts */}
        <div className="space-y-4">
          <SectionCard title="Quick Actions" description="Common procurement analyses">
            <div className="space-y-2">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.title}
                  onClick={() => sendPrompt(qp.prompt)}
                  className="group w-full flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-left hover:bg-muted/40 hover:border-emerald-300 transition-all"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <qp.icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{qp.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{qp.prompt}</p>
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="AI Capabilities">
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-start gap-2"><Sparkles size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Summarize pending requests and approvals</li>
              <li className="flex items-start gap-2"><TrendingDown size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Identify cost savings opportunities</li>
              <li className="flex items-start gap-2"><AlertTriangle size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Detect procurement risks and SLA breaches</li>
              <li className="flex items-start gap-2"><User size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Recommend vendors by category</li>
              <li className="flex items-start gap-2"><FileText size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Generate business justifications</li>
              <li className="flex items-start gap-2"><Brain size={12} className="text-emerald-500 mt-0.5 shrink-0" /> Approval bottleneck analysis</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
