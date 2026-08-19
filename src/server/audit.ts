// NextMav Procure — audit and activity recording.
//
// Two distinct logs, deliberately not merged:
//
//   AuditLogEntry — the compliance record. Append-only, before/after state,
//                   server-captured IP and user agent. Nothing in the codebase
//                   updates or deletes rows here.
//   ActivityLog   — the human-readable feed shown in the product ("Amina approved
//                   REQ-0041"). Lossy, presentational, safe to prune.
//
// The previous implementation logged a hardcoded IP literal ("102.89.45.10") from
// the browser. Request metadata is now taken from the actual request headers.
//
// State snapshots are stored as jsonb rather than as stringified JSON, so an
// auditor can query "every change that touched totalAmount" in SQL instead of
// pattern-matching text.

import { headers } from "next/headers";
import type { Prisma, Severity } from "@prisma/client";
import { db } from "./db";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Client IP from the proxy chain. `x-forwarded-for` is only trustworthy behind a
 * proxy that overwrites it — the Caddyfile in this repo does. Behind an untrusted
 * edge this value is client-controlled and must not be used for authorization,
 * only for the audit record.
 */
export async function requestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      h.get("cf-connecting-ip") ||
      null;
    return { ipAddress: ip, userAgent: h.get("user-agent") };
  } catch {
    // Outside a request scope (seed scripts, jobs).
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Normalises a snapshot for jsonb storage.
 *
 * Dates become ISO strings and bigints become decimal strings, because both are
 * lossy or invalid in JSON; everything else is stored as-is so the shape of the
 * record survives into the audit row.
 */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(
      JSON.stringify(value, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v
      )
    ) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function changedKeys(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return after && typeof after === "object" ? Object.keys(after as object) : [];
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
}

export interface AuditInput {
  organizationId: string;
  userId?: string | null;
  supplierUserId?: string | null;
  /** Verb in past tense: "request.approved", "vendor.blacklisted". */
  action: string;
  /** Model name: "PurchaseRequest", "Vendor". */
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  context?: RequestContext;
}

/**
 * Writes one immutable audit row.
 *
 * Never throws: a failure to audit must not roll back or mask the business
 * operation the user actually performed. Failures are logged to stderr so they
 * surface in monitoring instead of disappearing.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const ctx = input.context ?? (await requestContext());
    await db.auditLogEntry.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        supplierUserId: input.supplierUserId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        changedFields: changedKeys(input.before, input.after),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit entry", {
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ActivityInput {
  organizationId: string;
  userId?: string | null;
  eventType: string;
  description: string;
  severity?: Severity;
  requestId?: string | null;
  purchaseOrderId?: string | null;
  rfqId?: string | null;
  vendorId?: string | null;
  metadata?: unknown;
  context?: RequestContext;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    const ctx = input.context ?? (await requestContext());
    await db.activityLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        eventType: input.eventType,
        description: input.description,
        severity: input.severity ?? "INFO",
        requestId: input.requestId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        rfqId: input.rfqId ?? null,
        vendorId: input.vendorId ?? null,
        metadata: toJson(input.metadata),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch (err) {
    console.error("[activity] failed to write activity entry", err);
  }
}

/** Convenience for the common case: one business event, both logs. */
export async function recordEvent(
  audit: AuditInput,
  activity: Omit<ActivityInput, "organizationId" | "userId" | "context">
): Promise<void> {
  const context = audit.context ?? (await requestContext());
  await Promise.all([
    recordAudit({ ...audit, context }),
    recordActivity({
      ...activity,
      organizationId: audit.organizationId,
      userId: audit.userId,
      context,
    }),
  ]);
}

/** Shallow diff so audit rows carry only what changed, not whole records. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const prev = before[key];
    const next = after[key];
    const same =
      prev instanceof Date && next instanceof Date
        ? prev.getTime() === next.getTime()
        : prev === next;
    if (!same) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return { before: b, after: a };
}
