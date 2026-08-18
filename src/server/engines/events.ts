// NextMav Procure — domain event bus.
//
// §24 requires notifications to be *triggered by real system events*, not created
// ad hoc next to whatever UI happens to need one. Services emit a typed domain
// event; this module fans it out to the in-app notification table, the outbound
// delivery queue, the realtime socket, and any integration subscribed to it.
//
// A service therefore never writes a Notification row directly — it emits, and
// routing is decided in one place from the recipient's preferences.

import type { NotificationType } from "@prisma/client";
import { db } from "../db";

export type DomainEventType =
  | "request.submitted"
  | "request.approval_required"
  | "request.approved"
  | "request.rejected"
  | "request.changes_requested"
  | "request.cancelled"
  | "request.completed"
  | "approval.escalated"
  | "approval.reminder"
  | "approval.delegated"
  | "rfq.invited"
  | "rfq.quotation_received"
  | "rfq.deadline_approaching"
  | "rfq.awarded"
  | "po.issued"
  | "po.acknowledged"
  | "po.cancelled"
  | "po.revised"
  | "goods.received"
  | "goods.partially_received"
  | "invoice.submitted"
  | "invoice.approved"
  | "invoice.rejected"
  | "invoice.overdue"
  | "invoice.match_failed"
  | "payment.scheduled"
  | "payment.completed"
  | "payment.failed"
  | "budget.threshold_reached"
  | "budget.exceeded"
  | "contract.expiring"
  | "contract.expired"
  | "vendor.compliance_expiring"
  | "inventory.reorder_required"
  | "sla.breached";

/** Which preference category gates a given event. */
const EVENT_CATEGORY: Record<DomainEventType, keyof CategoryPrefs> = {
  "request.submitted": "catRequests",
  "request.approval_required": "catApprovals",
  "request.approved": "catApprovals",
  "request.rejected": "catApprovals",
  "request.changes_requested": "catApprovals",
  "request.cancelled": "catRequests",
  "request.completed": "catRequests",
  "approval.escalated": "catApprovals",
  "approval.reminder": "catApprovals",
  "approval.delegated": "catApprovals",
  "rfq.invited": "catRfqs",
  "rfq.quotation_received": "catRfqs",
  "rfq.deadline_approaching": "catRfqs",
  "rfq.awarded": "catRfqs",
  "po.issued": "catPurchaseOrders",
  "po.acknowledged": "catPurchaseOrders",
  "po.cancelled": "catPurchaseOrders",
  "po.revised": "catPurchaseOrders",
  "goods.received": "catPurchaseOrders",
  "goods.partially_received": "catPurchaseOrders",
  "invoice.submitted": "catPurchaseOrders",
  "invoice.approved": "catPurchaseOrders",
  "invoice.rejected": "catPurchaseOrders",
  "invoice.overdue": "catPurchaseOrders",
  "invoice.match_failed": "catPurchaseOrders",
  "payment.scheduled": "catPurchaseOrders",
  "payment.completed": "catPurchaseOrders",
  "payment.failed": "catPurchaseOrders",
  "budget.threshold_reached": "catBudgetAlerts",
  "budget.exceeded": "catBudgetAlerts",
  "contract.expiring": "catRequests",
  "contract.expired": "catRequests",
  "vendor.compliance_expiring": "catRequests",
  "inventory.reorder_required": "catRequests",
  "sla.breached": "catSlaWarnings",
};

interface CategoryPrefs {
  catApprovals: boolean;
  catRequests: boolean;
  catRfqs: boolean;
  catPurchaseOrders: boolean;
  catBudgetAlerts: boolean;
  catSlaWarnings: boolean;
  catMentions: boolean;
  catWeeklyDigest: boolean;
}

export interface DomainEvent {
  type: DomainEventType;
  organizationId: string;
  /** Employees to notify in-app. Deduplicated; the actor is removed automatically. */
  recipientIds?: string[];
  /** Supplier contacts to notify, resolved from the vendor. */
  vendorId?: string;
  actorId?: string | null;
  title: string;
  message: string;
  severity?: NotificationType;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Extra payload forwarded to webhooks and integrations. */
  payload?: Record<string, unknown>;
}

/**
 * Fans an event out to every configured channel.
 *
 * Never throws. A notification failure must not roll back the business
 * transaction that produced it — an approved request stays approved even if the
 * email queue is down.
 */
export async function emit(event: DomainEvent): Promise<void> {
  try {
    await Promise.all([
      fanoutInApp(event),
      queueWebhooks(event),
      publishRealtime(event),
    ]);
  } catch (err) {
    console.error("[events] fanout failed", { type: event.type, error: err });
  }
}

async function fanoutInApp(event: DomainEvent): Promise<void> {
  const recipients = [...new Set(event.recipientIds ?? [])].filter(
    (id) => id && id !== event.actorId
  );
  if (recipients.length === 0) return;

  const category = EVENT_CATEGORY[event.type];

  const prefs = await db.notificationPreference.findMany({
    where: { userId: { in: recipients } },
  });
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  const deliverTo = recipients.filter((userId) => {
    const p = prefByUser.get(userId);
    // No preference row means defaults, which enable in-app for everything.
    if (!p) return true;
    if (!p.channelInApp) return false;
    return p[category] !== false;
  });

  if (deliverTo.length === 0) return;

  await db.notification.createMany({
    data: deliverTo.map((userId) => ({
      organizationId: event.organizationId,
      userId,
      title: event.title,
      message: event.message,
      type: event.severity ?? "info",
      link: event.link ?? null,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
    })),
  });

  // Queue the out-of-app channels the recipient has actually enabled. These rows
  // are the audit trail for delivery; nothing claims a message was sent until a
  // worker marks it so.
  const deliveries: {
    channel: string;
    recipient: string;
    status: string;
  }[] = [];

  for (const userId of deliverTo) {
    const p = prefByUser.get(userId);
    if (!p) continue;
    if (inQuietHours(p.quietHoursStart, p.quietHoursEnd)) continue;
    if (p.channelEmail) deliveries.push({ channel: "EMAIL", recipient: userId, status: "PENDING" });
    if (p.channelSlack) deliveries.push({ channel: "SLACK", recipient: userId, status: "PENDING" });
    if (p.channelSms) deliveries.push({ channel: "SMS", recipient: userId, status: "PENDING" });
  }

  if (deliveries.length > 0) {
    await db.notificationDelivery.createMany({ data: deliveries });
  }
}

function inQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const s = toMins(start);
  const e = toMins(end);
  // Windows that wrap past midnight (22:00 → 07:00) are the common case.
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
}

/**
 * Queues the event for any integration subscribed to it.
 *
 * Rows land in WebhookDelivery as PENDING with a retry budget. Nothing here
 * performs an outbound request — delivery is the dispatcher's job, and until a
 * dispatcher runs the queue is visibly pending rather than silently claimed.
 */
async function queueWebhooks(event: DomainEvent): Promise<void> {
  const integrations = await db.integration.findMany({
    where: { organizationId: event.organizationId, status: "CONNECTED" },
  });

  const subscribed = integrations.filter((i) => {
    if (!i.enabledEvents) return false;
    try {
      const events = JSON.parse(i.enabledEvents);
      return Array.isArray(events) && events.includes(event.type);
    } catch {
      return false;
    }
  });

  if (subscribed.length === 0) return;

  await db.webhookDelivery.createMany({
    data: subscribed.map((i) => ({
      organizationId: event.organizationId,
      integrationId: i.id,
      url: readWebhookUrl(i.publicConfig) ?? "",
      event: event.type,
      payload: JSON.stringify({
        event: event.type,
        organizationId: event.organizationId,
        entityType: event.entityType,
        entityId: event.entityId,
        title: event.title,
        message: event.message,
        occurredAt: new Date().toISOString(),
        ...event.payload,
      }),
      status: "PENDING",
      nextAttemptAt: new Date(),
    })),
  });
}

function readWebhookUrl(publicConfig: string | null): string | null {
  if (!publicConfig) return null;
  try {
    const cfg = JSON.parse(publicConfig) as Record<string, unknown>;
    const url = cfg.webhookUrl ?? cfg.url ?? cfg.endpoint;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Publishes to the Socket.IO mini-service so connected clients update live.
 *
 * Fire-and-forget with a short timeout: the realtime service is an enhancement,
 * and the platform must work identically when it is not running.
 */
async function publishRealtime(event: DomainEvent): Promise<void> {
  const base = process.env.REALTIME_SERVICE_URL;
  if (!base) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(`${base}/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: event.organizationId,
        recipientIds: event.recipientIds ?? [],
        event: event.type,
        title: event.title,
        message: event.message,
        type: event.severity ?? "info",
        link: event.link,
        entityId: event.entityId,
      }),
      signal: controller.signal,
    });
  } catch {
    // Expected whenever the mini-service is not running. Not an error.
  } finally {
    clearTimeout(timer);
  }
}
