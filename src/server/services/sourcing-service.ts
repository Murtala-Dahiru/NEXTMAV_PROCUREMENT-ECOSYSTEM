// NextMav Procure — sourcing events.
//
// The event is the container that makes §36 traceability hold. An approved
// purchase request becomes a sourcing event; the event holds the RFQ; the RFQ
// holds the invitations, the quotations, the evaluation and the award. Ask "why
// was this supplier selected?" of any award and the chain walks back to the
// requisition that justified the spend.
//
// The event is not the RFQ, and keeping them apart earns its keep the first time
// a round fails: an RFQ that closed with no valid bids is finished, but the
// *requirement* is not. A second RFQ under the same event continues the same
// sourcing effort rather than appearing as an unrelated document.

import type { Prisma, SourcingEventStatus } from "@prisma/client";
import { db, type Tx } from "../db";
import { conflict, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { transition } from "../state-machine";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createSourcingEventSchema,
  updateSourcingEventSchema,
  listQuerySchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createSourcingEventSchema>;
type UpdateInput = z.infer<typeof updateSourcingEventSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["createdAt", "responseDeadline", "eventNumber", "status", "title"] as const;

const eventInclude = {
  request: { select: { id: true, requestNumber: true, title: true, status: true, totalEstimated: true } },
  category: { select: { id: true, code: true, name: true } },
  owner: { select: { id: true, name: true, email: true, initials: true, avatarColor: true } },
  createdBy: { select: { id: true, name: true } },
  rfqs: {
    select: {
      id: true,
      rfqNumber: true,
      title: true,
      status: true,
      deadline: true,
      publishedAt: true,
      awardedAt: true,
      _count: { select: { invitedVendors: true, quotations: true } },
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.SourcingEventInclude;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "rfqs.view");
  const tdb = scoped(ctx);

  const where: Prisma.SourcingEventWhereInput = {};
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as SourcingEventStatus[] };
  }
  if (q.category) where.categoryId = q.category;
  if (q.search) {
    where.OR = [
      { eventNumber: { contains: q.search, mode: "insensitive" } },
      { title: { contains: q.search, mode: "insensitive" } },
      { description: { contains: q.search, mode: "insensitive" } },
    ];
  }
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }

  const [total, items] = await Promise.all([
    tdb.sourcingEvent.count({ where }),
    tdb.sourcingEvent.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "createdAt"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: eventInclude,
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "rfqs.view");
  const event = await scoped(ctx).sourcingEvent.findUnique({ where: { id }, include: eventInclude });
  if (!event) throw notFound("Sourcing event not found");
  return event;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

/**
 * Creates a sourcing event, optionally from an approved purchase request.
 *
 * The request must be APPROVED. Sourcing against a request that has not cleared
 * approval is the whole failure mode a purchase requisition exists to prevent:
 * money is committed to the market before anyone agreed it should be spent.
 *
 * Nothing is copied from the request that could drift — the link is a foreign
 * key. What *is* taken from it (category, estimated value, currency) are defaults
 * a buyer may change, not a duplicate of the requirement.
 */
export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "rfqs.create");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  let requestFacts: {
    id: string;
    requestNumber: string;
    categoryId: string | null;
    totalEstimated: number;
  } | null = null;

  if (input.requestId) {
    const request = await tdb.purchaseRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        categoryId: true,
        totalEstimated: true,
      },
    });
    if (!request) throw validation("The linked purchase request does not exist");
    if (request.status !== "APPROVED" && request.status !== "IN_PROCUREMENT") {
      throw conflict(
        `Sourcing can only start from an approved request — ${request.requestNumber} is ${request.status.replace(/_/g, " ").toLowerCase()}`
      );
    }
    requestFacts = {
      id: request.id,
      requestNumber: request.requestNumber,
      categoryId: request.categoryId,
      totalEstimated: request.totalEstimated,
    };
  }

  if (input.ownerId) {
    const owner = await tdb.user.findUnique({ where: { id: input.ownerId }, select: { id: true } });
    if (!owner) throw validation("The nominated owner is not a member of this organization");
  }

  const event = await db.$transaction(async (tx) => {
    const eventNumber = await nextDocumentNumber(organizationId, PREFIX.sourcingEvent, { client: tx });
    return tx.sourcingEvent.create({
      data: {
        organizationId,
        eventNumber,
        title: input.title,
        description: input.description || null,
        requestId: requestFacts?.id ?? null,
        categoryId: input.categoryId ?? requestFacts?.categoryId ?? null,
        ownerId: input.ownerId ?? ctx.principal.userId,
        type: input.type,
        status: "PLANNING",
        currency: input.currency,
        estimatedValue: input.estimatedValue ?? requestFacts?.totalEstimated ?? null,
        responseDeadline: input.responseDeadline ? new Date(input.responseDeadline) : null,
        createdById: ctx.principal.userId,
      },
      include: eventInclude,
    });
  });

  // The request is now visibly in procurement rather than merely approved, so a
  // requester can see that their approved requirement is being acted on.
  if (requestFacts) {
    await tdb.purchaseRequest
      .updateMany({
        where: { id: requestFacts.id, status: "APPROVED" },
        data: { status: "IN_PROCUREMENT" },
      })
      .catch(() => undefined);
  }

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "sourcing_event.created",
    resource: "SourcingEvent",
    resourceId: event.id,
    after: {
      eventNumber: event.eventNumber,
      title: event.title,
      type: event.type,
      requestId: event.requestId,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "SOURCING_EVENT_CREATED",
    description: requestFacts
      ? `${ctx.principal.name} opened sourcing event ${event.eventNumber} from ${requestFacts.requestNumber}`
      : `${ctx.principal.name} opened sourcing event ${event.eventNumber}: '${event.title}'`,
    requestId: requestFacts?.id ?? null,
    context: ctx.context,
  });

  return event;
}

export async function update(ctx: ServiceContext, id: string, input: UpdateInput) {
  await assertPermission(ctx.principal, "rfqs.create");
  const tdb = scoped(ctx);

  const event = await tdb.sourcingEvent.findUnique({ where: { id } });
  if (!event) throw notFound("Sourcing event not found");
  if (event.status === "CANCELLED" || event.status === "CLOSED") {
    throw conflict(`This sourcing event is ${event.status.toLowerCase()} and can no longer be edited`);
  }

  const updated = await tdb.sourcingEvent.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId || null } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.estimatedValue !== undefined ? { estimatedValue: input.estimatedValue } : {}),
      ...(input.responseDeadline !== undefined
        ? { responseDeadline: input.responseDeadline ? new Date(input.responseDeadline) : null }
        : {}),
    },
    include: eventInclude,
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "sourcing_event.updated",
    resource: "SourcingEvent",
    resourceId: id,
    before: {
      title: event.title,
      categoryId: event.categoryId,
      ownerId: event.ownerId,
      estimatedValue: event.estimatedValue,
    },
    after: {
      title: updated.title,
      categoryId: updated.categoryId,
      ownerId: updated.ownerId,
      estimatedValue: updated.estimatedValue,
    },
    context: ctx.context,
  });

  return updated;
}

export async function cancel(ctx: ServiceContext, id: string, reason: string) {
  await assertPermission(ctx.principal, "rfqs.cancel");
  const tdb = scoped(ctx);

  const event = await tdb.sourcingEvent.findUnique({
    where: { id },
    include: { rfqs: { select: { id: true, rfqNumber: true, status: true } } },
  });
  if (!event) throw notFound("Sourcing event not found");

  const live = event.rfqs.filter(
    (r) => r.status !== "CANCELLED" && r.status !== "AWARDED" && r.status !== "NO_AWARD"
  );
  if (live.length > 0) {
    throw conflict(
      `Cancel the RFQs under this event first: ${live.map((r) => r.rfqNumber).join(", ")}`,
      { rfqIds: live.map((r) => r.id) }
    );
  }

  const now = new Date();
  await tdb.sourcingEvent.update({
    where: { id },
    data: {
      status: transition("sourcingEvent", event.status, "CANCELLED"),
      cancelledAt: now,
      cancelReason: reason || null,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "sourcing_event.cancelled",
    resource: "SourcingEvent",
    resourceId: id,
    before: { status: event.status },
    after: { status: "CANCELLED", reason },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "SOURCING_EVENT_CANCELLED",
    description: `${ctx.principal.name} cancelled ${event.eventNumber} — ${reason || "no reason given"}`,
    severity: "WARNING",
    context: ctx.context,
  });

  return getById(ctx, id);
}

// ---------------------------------------------------------------------------
// Internal helpers used by the RFQ service
// ---------------------------------------------------------------------------

/**
 * Moves an event's status to keep step with the RFQ inside it.
 *
 * Called from the RFQ service rather than exposed as an endpoint: the event's
 * state is a consequence of what happens to its RFQs, never something a caller
 * asserts directly. Illegal moves are swallowed rather than thrown — an event
 * already CLOSED must not stop an RFQ from being awarded, and a mismatch here is
 * a display inaccuracy, not a correctness failure.
 */
export async function syncEventStatus(
  tx: Tx,
  eventId: string | null,
  target: SourcingEventStatus,
  stamps: { publishedAt?: Date; closedAt?: Date; awardedAt?: Date } = {}
): Promise<void> {
  if (!eventId) return;

  const event = await tx.sourcingEvent.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event) return;

  let next: SourcingEventStatus;
  try {
    next = transition("sourcingEvent", event.status, target);
  } catch {
    return;
  }

  await tx.sourcingEvent.update({
    where: { id: eventId },
    data: {
      status: next,
      ...(stamps.publishedAt ? { publishedAt: stamps.publishedAt } : {}),
      ...(stamps.closedAt ? { closedAt: stamps.closedAt } : {}),
      ...(stamps.awardedAt ? { awardedAt: stamps.awardedAt } : {}),
    },
  });
}

/**
 * Finds or creates the event an RFQ belongs to.
 *
 * An RFQ raised without naming an event still gets one, because §36 does not
 * admit an RFQ that hangs off nothing. The event created here is indistinguishable
 * from one raised deliberately — same number series, same lifecycle.
 */
export async function resolveEventForRfq(
  tx: Tx,
  args: {
    organizationId: string;
    userId: string | null;
    sourcingEventId?: string;
    requestId?: string | null;
    title: string;
    description?: string | null;
    categoryId?: string | null;
    currency: string;
    estimatedValue?: number | null;
    responseDeadline: Date;
  }
): Promise<string> {
  if (args.sourcingEventId) {
    const existing = await tx.sourcingEvent.findFirst({
      where: { id: args.sourcingEventId, organizationId: args.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) throw validation("The nominated sourcing event does not exist");
    if (existing.status === "CANCELLED") {
      throw conflict("That sourcing event has been cancelled");
    }
    return existing.id;
  }

  const eventNumber = await nextDocumentNumber(args.organizationId, PREFIX.sourcingEvent, {
    client: tx,
  });
  const created = await tx.sourcingEvent.create({
    data: {
      organizationId: args.organizationId,
      eventNumber,
      title: args.title,
      description: args.description ?? null,
      requestId: args.requestId ?? null,
      categoryId: args.categoryId ?? null,
      ownerId: args.userId,
      type: "RFQ",
      status: "PLANNING",
      currency: args.currency,
      estimatedValue: args.estimatedValue ?? null,
      responseDeadline: args.responseDeadline,
      createdById: args.userId,
    },
    select: { id: true },
  });
  return created.id;
}
