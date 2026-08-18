// NextMav Procure — goods receiving service.
//
// Receiving is where the platform stops being a document system and starts
// affecting the physical world, so this is the module with the most cross-module
// consequence. Posting a receipt, in one transaction:
//
//   • validates the quantities against what is actually outstanding on the PO
//   • advances `receivedQty` / `rejectedQty` on each PO line
//   • re-derives the PO status (ISSUED → PARTIALLY_RECEIVED → RECEIVED)
//   • posts stock movements for lines mapped to inventory
//   • creates tracked assets for lines flagged `createsAsset`
//   • updates supplier on-time delivery performance
//
// The previous implementation did none of this — Receiving → Inventory and
// Receiving → Asset were both broken, and receipts never reconciled against the PO.

import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { conflict, notFound, validation } from "../errors";
import { assertPermission } from "../permissions";
import { recordActivity, recordAudit } from "../audit";
import { nextDocumentNumber, PREFIX } from "../numbering";
import { emit } from "../engines/events";
import * as poService from "./po-service";
import * as requestService from "./request-service";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type { createReceiptSchema, listQuerySchema } from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createReceiptSchema>;
type ListInput = z.infer<typeof listQuerySchema>;

const SORTABLE = ["receivedDate", "createdAt", "receiptNumber", "status"] as const;

const receiptInclude = {
  items: { include: { poLineItem: true } },
  purchaseOrder: {
    select: { id: true, poNumber: true, status: true, totalAmount: true, expectedDelivery: true },
  },
  vendor: { select: { id: true, companyName: true } },
  receivedBy: { select: { id: true, name: true, avatarColor: true, initials: true } },
} satisfies Prisma.GoodsReceiptInclude;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const tdb = scoped(ctx);

  const where: Prisma.GoodsReceiptWhereInput = {};
  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as Prisma.EnumGoodsReceiptStatusFilter["in"] };
  }
  if (q.vendorId && q.vendorId !== "ALL") where.vendorId = q.vendorId;
  if (q.search) {
    where.OR = [
      { receiptNumber: { contains: q.search, mode: "insensitive" } },
      { purchaseOrder: { poNumber: { contains: q.search, mode: "insensitive" } } },
      { vendor: { companyName: { contains: q.search, mode: "insensitive" } } },
    ];
  }

  const [total, items] = await Promise.all([
    tdb.goodsReceipt.count({ where }),
    tdb.goodsReceipt.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "receivedDate"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: receiptInclude,
    }),
  ]);

  return paginate(items, total, q.page, q.pageSize);
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const receipt = await scoped(ctx).goodsReceipt.findUnique({
    where: { id },
    include: receiptInclude,
  });
  if (!receipt) throw notFound("Goods receipt not found");
  return receipt;
}

/**
 * What is still outstanding on a PO — the worksheet a receiving clerk starts from.
 * Computed from cumulative receipts, so multiple partial deliveries against one PO
 * behave correctly.
 */
export async function outstandingForPo(ctx: ServiceContext, purchaseOrderId: string) {
  await assertPermission(ctx.principal, "purchaseOrders.view");
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, vendor: true },
  });
  if (!po) throw notFound("Purchase order not found");

  return {
    purchaseOrder: { id: po.id, poNumber: po.poNumber, status: po.status, vendor: po.vendor },
    lines: po.lineItems.map((li) => ({
      poLineItemId: li.id,
      itemName: li.itemName,
      description: li.description,
      unit: li.unit,
      unitPrice: li.unitPrice,
      orderedQty: li.orderedQty,
      receivedQty: li.receivedQty,
      rejectedQty: li.rejectedQty,
      outstandingQty: Math.max(0, li.orderedQty - li.receivedQty - li.rejectedQty),
      createsAsset: li.createsAsset,
      inventoryItemId: li.inventoryItemId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Posting a receipt
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "purchaseOrders.updateStatus");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const po = await tdb.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    include: { lineItems: true, vendor: true, request: true },
  });
  if (!po) throw notFound("Purchase order not found");

  if (["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(po.status)) {
    throw conflict(
      `Goods cannot be received against a ${po.status.replace(/_/g, " ").toLowerCase()} purchase order`
    );
  }

  const lineById = new Map(po.lineItems.map((l) => [l.id, l]));

  // Validate every line before writing anything: a receipt that over-delivers on
  // one line must not half-post the others.
  for (const item of input.items) {
    const line = lineById.get(item.poLineItemId);
    if (!line) {
      throw validation(`Line item ${item.poLineItemId} does not belong to ${po.poNumber}`);
    }
    if (item.receivedQty === 0 && item.rejectedQty === 0) continue;

    const outstanding = line.orderedQty - line.receivedQty - line.rejectedQty;
    const claiming = item.receivedQty + item.rejectedQty;
    if (claiming > outstanding + 0.0001) {
      throw validation(
        `${line.itemName}: attempting to receive ${claiming} ${line.unit} but only ${outstanding} remain outstanding on ${po.poNumber}`,
        {
          poLineItemId: line.id,
          ordered: line.orderedQty,
          alreadyReceived: line.receivedQty,
          alreadyRejected: line.rejectedQty,
          outstanding,
        }
      );
    }
  }

  const active = input.items.filter((i) => i.receivedQty > 0 || i.rejectedQty > 0);
  if (active.length === 0) {
    throw validation("Record a received or rejected quantity on at least one line");
  }

  const receivedDate = input.receivedDate ? new Date(input.receivedDate) : new Date();

  const receipt = await db.$transaction(async (tx) => {
    const receiptNumber = await nextDocumentNumber(organizationId, PREFIX.goodsReceipt, {
      client: tx,
    });

    const created = await tx.goodsReceipt.create({
      data: {
        organizationId,
        receiptNumber,
        purchaseOrderId: po.id,
        vendorId: po.vendorId,
        receivedById: ctx.principal.userId,
        status: "DRAFT",
        receivedDate,
        location: input.location || null,
        deliveryNoteRef: input.deliveryNoteRef || null,
        notes: input.notes || null,
        items: {
          create: active.map((item) => {
            const line = lineById.get(item.poLineItemId)!;
            return {
              poLineItemId: line.id,
              itemName: line.itemName,
              orderedQty: line.orderedQty,
              receivedQty: item.receivedQty,
              rejectedQty: item.rejectedQty,
              unit: line.unit,
              condition: item.condition,
              notes: item.notes || null,
            };
          }),
        },
      },
      include: receiptInclude,
    });

    return created;
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "receipt.created",
    resource: "GoodsReceipt",
    resourceId: receipt.id,
    after: {
      receiptNumber: receipt.receiptNumber,
      poNumber: po.poNumber,
      lines: active.length,
      posted: input.post,
    },
    context: ctx.context,
  });

  if (input.post) return post(ctx, receipt.id);
  return getById(ctx, receipt.id);
}

/**
 * Applies a receipt to the rest of the platform.
 *
 * Separate from `create` so a receipt can be captured, checked and only then
 * committed — and so posting is idempotent-guarded by the `postedAt` timestamp.
 */
export async function post(ctx: ServiceContext, receiptId: string) {
  await assertPermission(ctx.principal, "purchaseOrders.updateStatus");
  const organizationId = ctx.principal.organizationId;
  const tdb = scoped(ctx);

  const receipt = await tdb.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: {
      items: { include: { poLineItem: true } },
      purchaseOrder: { include: { lineItems: true, vendor: true, request: true } },
      vendor: true,
    },
  });
  if (!receipt) throw notFound("Goods receipt not found");
  if (receipt.postedAt) throw conflict("This receipt has already been posted");

  const po = receipt.purchaseOrder;
  const createdAssets: string[] = [];
  const stockPosted: { itemId: string; quantity: number }[] = [];

  await db.$transaction(async (tx) => {
    for (const item of receipt.items) {
      const line = item.poLineItem;

      // Re-check inside the transaction: another receipt may have posted since
      // this one was drafted.
      const fresh = await tx.pOLineItem.findUnique({ where: { id: line.id } });
      if (!fresh) continue;

      const outstanding = fresh.orderedQty - fresh.receivedQty - fresh.rejectedQty;
      if (item.receivedQty + item.rejectedQty > outstanding + 0.0001) {
        throw conflict(
          `${item.itemName}: another receipt has been posted since this one was drafted. Only ${outstanding} ${fresh.unit} remain outstanding.`
        );
      }

      await tx.pOLineItem.update({
        where: { id: line.id },
        data: {
          receivedQty: { increment: item.receivedQty },
          rejectedQty: { increment: item.rejectedQty },
        },
      });

      // `receivedQty` is the quantity *accepted*; `rejectedQty` is the quantity
      // turned away. They are tracked separately, so only the accepted quantity
      // reaches stock and assets — the rejected units are already excluded by
      // virtue of not being in `receivedQty`.
      //
      // `condition` annotates *why* units were rejected on a mixed delivery
      // ("6 accepted, 2 damaged"). It must not suppress the accepted units: a
      // line marked DAMAGED with receivedQty 6 means six good ones did arrive.
      if (item.receivedQty <= 0) continue;

      if (fresh.inventoryItemId) {
        const invItem = await tx.inventoryItem.findUnique({ where: { id: fresh.inventoryItemId } });
        if (invItem) {
          const balanceAfter = invItem.quantity + item.receivedQty;
          await tx.stockMovement.create({
            data: {
              itemId: invItem.id,
              type: "RECEIPT",
              quantity: item.receivedQty,
              balanceAfter,
              unitCost: fresh.unitPrice,
              reference: receipt.receiptNumber,
              purchaseOrderId: po.id,
              goodsReceiptId: receipt.id,
              toLocation: receipt.location ?? invItem.location,
              notes: `Received against ${po.poNumber}`,
              performedById: ctx.principal.userId,
            },
          });
          await tx.inventoryItem.update({
            where: { id: invItem.id },
            data: {
              quantity: balanceAfter,
              lastRestockDate: receipt.receivedDate,
              // Moving average cost, so valuation reflects what was actually paid.
              unitCost:
                invItem.quantity + item.receivedQty > 0
                  ? (invItem.unitCost * invItem.quantity + fresh.unitPrice * item.receivedQty) /
                    (invItem.quantity + item.receivedQty)
                  : fresh.unitPrice,
            },
          });
          stockPosted.push({ itemId: invItem.id, quantity: item.receivedQty });
        }
      }

      if (fresh.createsAsset) {
        // One asset row per physical unit — an asset register tracks individual
        // items, so receiving 3 laptops creates 3 tagged assets, not one row of 3.
        const units = Math.floor(item.receivedQty);
        for (let i = 0; i < units; i++) {
          const assetTag = await nextDocumentNumber(organizationId, PREFIX.asset, { client: tx });
          const asset = await tx.asset.create({
            data: {
              organizationId,
              assetTag,
              name: item.itemName,
              category:
                (fresh.assetCategory as Prisma.AssetCreateInput["category"]) ?? "OTHER",
              purchaseOrderId: po.id,
              goodsReceiptId: receipt.id,
              vendorId: po.vendorId,
              departmentId: po.request?.departmentId ?? null,
              location: receipt.location ?? null,
              status: "IN_STORAGE",
              purchaseDate: receipt.receivedDate,
              purchaseValue: fresh.unitPrice,
              currentValue: fresh.unitPrice,
              currency: po.currency,
              notes: `Created automatically from ${receipt.receiptNumber} against ${po.poNumber}`,
            },
          });
          createdAssets.push(asset.id);
        }
      }
    }

    // Receipt status reflects whether this delivery completed the order.
    const refreshedLines = await tx.pOLineItem.findMany({ where: { purchaseOrderId: po.id } });
    const fullySettled = refreshedLines.every(
      (l) => l.receivedQty + l.rejectedQty >= l.orderedQty
    );
    const anyRejected = receipt.items.some((i) => i.rejectedQty > 0);

    await tx.goodsReceipt.update({
      where: { id: receipt.id },
      data: {
        status: anyRejected && receipt.items.every((i) => i.receivedQty === 0)
          ? "REJECTED"
          : fullySettled
            ? "RECEIVED"
            : "PARTIAL",
        postedAt: new Date(),
      },
    });
  });

  const newStatus = await poService.refreshStatus(organizationId, po.id);
  await updateDeliveryPerformance(po.vendorId);

  const totalReceived = receipt.items.reduce((s, i) => s + i.receivedQty, 0);
  const totalRejected = receipt.items.reduce((s, i) => s + i.rejectedQty, 0);

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "receipt.posted",
    resource: "GoodsReceipt",
    resourceId: receipt.id,
    before: { poStatus: po.status },
    after: {
      poStatus: newStatus,
      received: totalReceived,
      rejected: totalRejected,
      assetsCreated: createdAssets.length,
      stockMovements: stockPosted.length,
    },
    context: ctx.context,
  });

  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "PO_STATUS_UPDATED",
    description:
      `${ctx.principal.name} received ${totalReceived} item(s) against ${po.poNumber}` +
      (totalRejected > 0 ? `, rejecting ${totalRejected}` : "") +
      (createdAssets.length > 0 ? ` — ${createdAssets.length} asset(s) registered` : "") +
      (stockPosted.length > 0 ? ` — stock updated` : ""),
    severity: totalRejected > 0 ? "WARNING" : "SUCCESS",
    purchaseOrderId: po.id,
    vendorId: po.vendorId,
    context: ctx.context,
  });

  await emit({
    type: newStatus === "RECEIVED" ? "goods.received" : "goods.partially_received",
    organizationId,
    actorId: ctx.principal.userId,
    recipientIds: po.request ? [po.request.requestedById] : [],
    vendorId: po.vendorId,
    title:
      newStatus === "RECEIVED"
        ? `${po.poNumber} fully received`
        : `${po.poNumber} partially received`,
    message: `${receipt.receiptNumber}: ${totalReceived} item(s) received${totalRejected > 0 ? `, ${totalRejected} rejected` : ""} from ${receipt.vendor.companyName}.`,
    severity: totalRejected > 0 ? "warning" : "success",
    link: "goods-receipts",
    entityType: "GOODS_RECEIPT",
    entityId: receipt.id,
    payload: { poNumber: po.poNumber, received: totalReceived, rejected: totalRejected },
  });

  // Reorder alerts for anything that dropped below its threshold.
  for (const posted of stockPosted) {
    const item = await db.inventoryItem.findUnique({ where: { id: posted.itemId } });
    if (item && item.quantity <= item.reorderLevel && !item.reorderAlertSentAt) {
      await db.inventoryItem.update({
        where: { id: item.id },
        data: { reorderAlertSentAt: new Date() },
      });
      const buyers = await db.user.findMany({
        where: { organizationId, role: "PROCUREMENT_MANAGER", status: "ACTIVE" },
        select: { id: true },
      });
      await emit({
        type: "inventory.reorder_required",
        organizationId,
        recipientIds: buyers.map((b) => b.id),
        title: `Reorder required — ${item.name}`,
        message: `${item.sku} is at ${item.quantity} ${item.unit}, at or below its reorder level of ${item.reorderLevel}.`,
        severity: "warning",
        link: "inventory",
        entityType: "INVENTORY",
        entityId: item.id,
      });
    }
  }

  if (po.requestId) {
    await requestService.reconcileCompletion(organizationId, po.requestId);
  }

  return getById(ctx, receipt.id);
}

/**
 * Recomputes a vendor's on-time delivery rate from actual receipts.
 *
 * Previously `onTimeDeliveryRate` was a stored number nobody derived — the vendor
 * detail chart even generated its trend with `Math.random()`. This makes the
 * figure a fact about delivery history.
 */
export async function updateDeliveryPerformance(vendorId: string) {
  const receipts = await db.goodsReceipt.findMany({
    where: { vendorId, postedAt: { not: null } },
    include: { purchaseOrder: { select: { expectedDelivery: true } } },
  });

  const assessable = receipts.filter((r) => r.purchaseOrder.expectedDelivery !== null);
  if (assessable.length === 0) return;

  const onTime = assessable.filter(
    (r) => r.receivedDate.getTime() <= r.purchaseOrder.expectedDelivery!.getTime()
  ).length;

  const items = await db.goodsReceiptItem.findMany({
    where: { goodsReceipt: { vendorId, postedAt: { not: null } } },
  });
  const totalUnits = items.reduce((s, i) => s + i.receivedQty + i.rejectedQty, 0);
  const rejectedUnits = items.reduce((s, i) => s + i.rejectedQty, 0);

  // Quality is expressed on the same 0-5 scale the product already uses.
  const qualityRating =
    totalUnits > 0 ? Math.max(0, 5 * (1 - rejectedUnits / totalUnits)) : 0;

  await db.vendor.update({
    where: { id: vendorId },
    data: {
      onTimeDeliveryRate: (onTime / assessable.length) * 100,
      qualityRating: Number(qualityRating.toFixed(2)),
      performanceUpdatedAt: new Date(),
    },
  });
}
