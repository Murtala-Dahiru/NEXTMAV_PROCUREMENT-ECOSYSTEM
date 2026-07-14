// NextMav Procure — Export API (CSV generator)
// Generates CSV exports for requests, vendors, POs, etc.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (val: unknown): string => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerRow = headers.join(",");
  const dataRows = rows.map((r) => headers.map((h) => escapeCell(r[h])).join(","));
  return [headerRow, ...dataRows].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const { type, data, format = "csv" } = await req.json();

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: "Data array is required" }, { status: 400 });
    }

    if (format === "csv") {
      const csv = toCsv(data);
      const filename = `nextmav-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (format === "json") {
      const filename = `nextmav-${type}-${new Date().toISOString().slice(0, 10)}.json`;
      return new NextResponse(JSON.stringify(data, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  } catch (error) {
    console.error("Export API error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "NextMav Export API",
    status: "operational",
    formats: ["csv", "json"],
    types: ["requests", "vendors", "purchase_orders", "rfqs", "activities", "audit_logs"],
  });
}
