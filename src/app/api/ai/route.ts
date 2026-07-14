// NextMav Procure — AI Assistant API endpoint
// Proxies prompts to z-ai-web-dev-sdk for procurement-related queries.

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

interface AIRequest {
  prompt: string;
  context?: {
    organization?: string;
    pendingRequests?: number;
    totalSpend?: number;
    vendorCount?: number;
  };
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, context } = (await req.json()) as AIRequest;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Build system prompt with procurement context
    const systemPrompt = `You are the AI Procurement Assistant for NextMav Procure, a modern Procure-to-Pay SaaS platform.

Context about the organization:
- Organization: ${context?.organization ?? "Apex Industries"}
- Pending requests: ${context?.pendingRequests ?? "unknown"}
- Total spend YTD: $${context?.totalSpend ?? "unknown"}
- Active vendors: ${context?.vendorCount ?? "unknown"}

Your capabilities:
- Summarize purchase requests and approval queues
- Identify cost savings opportunities
- Detect procurement risks (SLA breaches, expired compliance, blacklisted vendors)
- Suggest vendors by category
- Generate business justifications for purchase requests
- Analyze approval bottlenecks
- Answer procurement questions

Respond concisely (3-5 paragraphs max), use markdown formatting with **bold** for emphasis, and offer 2-3 follow-up suggestions at the end as a bulleted list prefixed with "Suggestions:".`;

    // Call z-ai-web-dev-sdk
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const response =
      completion.choices?.[0]?.message?.content ??
      "I couldn't process that request right now. Please try again.";

    // Extract suggestions if present
    let suggestions: string[] | undefined;
    const suggestionsMatch = response.match(/Suggestions?:?\s*\n((?:[-*•]\s*.+\n?)+)/i);
    if (suggestionsMatch) {
      suggestions = suggestionsMatch[1]
        .split("\n")
        .map((s) => s.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 3);
    }

    // Clean suggestions from the main response
    const cleanedResponse = response.replace(/Suggestions?:?\s*\n((?:[-*•]\s*.+\n?)+)/i, "").trim();

    return NextResponse.json({
      response: cleanedResponse,
      suggestions: suggestions ?? [
        "Summarize pending requests",
        "Identify cost savings",
        "Detect procurement risks",
      ],
    });
  } catch (error) {
    console.error("AI API error:", error);
    return NextResponse.json(
      {
        error: "AI service unavailable",
        response:
          "I'm having trouble connecting to the AI service right now. The local fallback will handle your request.",
        suggestions: ["Summarize pending requests", "Identify cost savings"],
      },
      { status: 200 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    service: "NextMav AI Procurement Assistant",
    status: "operational",
    version: "1.0.0",
    capabilities: [
      "summarize_requests",
      "cost_savings_analysis",
      "risk_detection",
      "vendor_recommendations",
      "justification_generation",
      "bottleneck_analysis",
    ],
  });
}
