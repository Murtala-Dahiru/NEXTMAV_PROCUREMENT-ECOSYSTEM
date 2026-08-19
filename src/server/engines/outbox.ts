// NextMav Procure — transactional outbox.
//
// §23 requires critical operations to be atomic. Notification fan-out cannot be
// part of that atomicity if it happens over the network mid-transaction, and it
// must not happen *outside* it either: an event emitted before the commit
// notifies people about an approval that then rolls back, and an event emitted
// after the commit is lost entirely if the process dies in between.
//
// So a service inside a transaction calls `enqueue(tx, event)`, which writes one
// row through the same transaction as the business change. The row is committed
// with the change or not at all. `drain()` then delivers whatever is pending, and
// is safe to run repeatedly: a delivery that fails is retried with backoff, and
// one that already succeeded is not re-sent.

import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { emit, type DomainEvent } from "./events";

const MAX_ATTEMPTS = 5;

/** Backoff in minutes: 1, 4, 9, 16 … so a broken channel is not hammered. */
const backoffMinutes = (attempt: number) => attempt * attempt;

/**
 * Records an event to be delivered after this transaction commits.
 *
 * Takes the transaction client on purpose: passing the pooled client here would
 * silently step outside the transaction and reintroduce exactly the failure this
 * module exists to prevent.
 */
export async function enqueue(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.eventOutbox.create({
    data: {
      organizationId: event.organizationId,
      type: event.type,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Delivers pending events.
 *
 * Claims a batch before delivering so two concurrent drains cannot send the same
 * event twice, then hands each payload to the existing fan-out. Returns what it
 * did so callers and tests can assert on it rather than infer it.
 */
export async function drain(limit = 50): Promise<{ delivered: number; failed: number }> {
  const now = new Date();

  const pending = await db.eventOutbox.findMany({
    where: { status: "PENDING", availableAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (pending.length === 0) return { delivered: 0, failed: 0 };

  // Claim first. `status` is part of the filter, so a row already claimed by a
  // parallel drain updates zero rows and is skipped here.
  const claimed: typeof pending = [];
  for (const row of pending) {
    const res = await db.eventOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (res.count === 1) claimed.push(row);
  }

  let delivered = 0;
  let failed = 0;

  for (const row of claimed) {
    try {
      await emit(row.payload as unknown as DomainEvent);
      await db.eventOutbox.update({
        where: { id: row.id },
        data: { status: "DELIVERED", processedAt: new Date(), lastError: null },
      });
      delivered++;
    } catch (err) {
      failed++;
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await db.eventOutbox.update({
        where: { id: row.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          availableAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { delivered, failed };
}

/**
 * Fire-and-forget drain for the end of a request.
 *
 * Deliberately not awaited by the caller: the user's write is already committed
 * and durable, so a slow notification channel must not slow the response. If the
 * process dies before this runs, the rows are still PENDING and the next drain
 * picks them up — which is the whole point of writing them down first.
 */
export function drainSoon(): void {
  void drain().catch((err) => console.error("[outbox] drain failed", err));
}
