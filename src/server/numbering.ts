// NextMav Procure — document numbering.
//
// The client previously derived numbers from `array.length + 1`, which produces
// duplicates as soon as two people create a request in the same second, and
// re-issues numbers after a deletion. Numbers now come from a per-tenant,
// per-prefix, per-year counter row updated atomically.
//
// Formats are unchanged from the existing product — PR-2026-0001, RFQ-2026-0001,
// PO-2026-0001 — and extended to the modules that had no numbering before.

import { db } from "./db";
import type { Tx } from "./db";

export const PREFIX = {
  request: "PR",
  rfq: "RFQ",
  purchaseOrder: "PO",
  goodsReceipt: "GRN",
  invoice: "INV",
  payment: "PAY",
  contract: "CTR",
  asset: "AST",
} as const;

export type SequencePrefix = (typeof PREFIX)[keyof typeof PREFIX];

/**
 * Reserves and returns the next number for a tenant, e.g. `PR-2026-0042`.
 *
 * Pass `tx` when allocating inside a transaction that also creates the record, so
 * a rolled-back create does not burn a number.
 */
export async function nextDocumentNumber(
  organizationId: string,
  prefix: SequencePrefix,
  options: { client?: Tx; year?: number; padding?: number } = {}
): Promise<string> {
  const client = (options.client ?? db) as Tx;
  const year = options.year ?? new Date().getFullYear();
  const period = String(year);
  const padding = options.padding ?? 4;

  // `upsert` + `increment` is a single statement, so concurrent callers serialise
  // on the row rather than racing between a read and a write.
  const row = await client.documentSequence.upsert({
    where: { organizationId_prefix_period: { organizationId, prefix, period } },
    create: { organizationId, prefix, period, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  return `${prefix}-${period}-${String(row.lastValue).padStart(padding, "0")}`;
}

/**
 * Aligns a counter with numbers already present after a data import, so seeded
 * records and newly created ones do not collide.
 */
export async function syncSequence(
  organizationId: string,
  prefix: SequencePrefix,
  highestUsed: number,
  year: number = new Date().getFullYear()
): Promise<void> {
  const period = String(year);
  const existing = await db.documentSequence.findUnique({
    where: { organizationId_prefix_period: { organizationId, prefix, period } },
  });

  if (!existing) {
    await db.documentSequence.create({
      data: { organizationId, prefix, period, lastValue: highestUsed },
    });
    return;
  }

  if (existing.lastValue < highestUsed) {
    await db.documentSequence.update({
      where: { id: existing.id },
      data: { lastValue: highestUsed },
    });
  }
}

/** Extracts the numeric part of `PR-2026-0042` → 42. Returns 0 if unparseable. */
export function sequenceOf(documentNumber: string): number {
  const m = documentNumber.match(/-(\d+)$/);
  return m ? Number(m[1]) : 0;
}
