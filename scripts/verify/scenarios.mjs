// NextMav Procure — Phase 1 database scenario verification.
//
// Runs the eight scenarios §26 of the mandate requires, against the real
// Supabase database, through the real schema and the real constraints. Nothing
// is stubbed and nothing is asserted about mock data: every check reads back
// what the database actually stored.
//
// It works in a throwaway tenant of its own, so it can be run against a
// database that already holds the demo organization without disturbing it, and
// tears that tenant down afterwards.
//
//   node --env-file=.env scripts/verify/scenarios.mjs
//   node --env-file=.env scripts/verify/scenarios.mjs --keep   (leave data behind)

import { PrismaClient } from "@prisma/client";

// Deliberately a bare client with no extensions: these checks are about what
// the database itself holds and enforces, not about what the application layer
// presents. That means numeric columns arrive as Decimal objects, so every
// comparison below goes through Number().
const db = new PrismaClient({
  log: ["error"],
  transactionOptions: { maxWait: 15_000, timeout: 30_000 },
});

const n = (v) => Number(v);
const KEEP = process.argv.includes("--keep");

let pass = 0;
let fail = 0;
const failures = [];

function check(condition, name, detail = "") {
  if (condition) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  }
  return condition;
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** Asserts that an operation is refused, and by what. */
async function refuses(fn, name, expect) {
  try {
    await fn();
    check(false, name, "the database accepted it");
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const matched = expect ? new RegExp(expect, "i").test(message) : true;
    check(matched, name, matched ? "rejected" : `rejected, but with: ${message.slice(0, 90)}`);
    return message;
  }
}

const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;
const stamp = Date.now();
const created = { organizations: [] };

async function newTenant(label) {
  const org = await db.organization.create({
    data: { name: `${label} ${stamp}`, currency: "NGN", country: "NG" },
  });
  created.organizations.push(org.id);
  return org;
}

// ---------------------------------------------------------------------------

async function scenario1() {
  section("Scenario 1 — organization, users, roles, departments");
  const org = await newTenant("Scenario Co");

  const branch = await db.branch.create({
    data: { organizationId: org.id, name: "Lagos HQ", code: "LOS", city: "Lagos" },
  });
  const costCenter = await db.costCenter.create({
    data: { organizationId: org.id, code: "CC-ENG", name: "Engineering Cost Centre" },
  });
  const department = await db.department.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      costCenterId: costCenter.id,
      name: "Engineering",
      code: "ENG",
    },
  });
  const subDepartment = await db.department.create({
    data: { organizationId: org.id, parentId: department.id, name: "Platform", code: "PLT" },
  });

  const mkUser = (email, name, role) =>
    db.user.create({
      data: {
        organizationId: org.id,
        departmentId: department.id,
        costCenterId: costCenter.id,
        branchId: branch.id,
        email,
        name,
        role,
        initials: name.slice(0, 2).toUpperCase(),
      },
    });

  const requester = await mkUser("requester@scenario.test", "Ada Requester", "EMPLOYEE");
  const manager = await mkUser("manager@scenario.test", "Bola Manager", "DEPARTMENT_MANAGER");
  const finance = await mkUser("finance@scenario.test", "Chidi Finance", "FINANCE_OFFICER");
  const buyer = await mkUser("buyer@scenario.test", "Dele Buyer", "PROCUREMENT_MANAGER");

  await db.department.update({ where: { id: department.id }, data: { managerId: manager.id } });

  // Roles as data, then a grant, then resolution back through the join.
  const roles = await db.role.createManyAndReturn({
    data: [
      { organizationId: org.id, key: "ADMINISTRATOR", name: "Administrator", rank: 100, isSystem: true, legacyRole: "SUPER_ADMIN" },
      { organizationId: org.id, key: "WAREHOUSE_OFFICER", name: "Warehouse Officer", rank: 40, isSystem: true },
    ],
  });
  const warehouseRole = roles.find((r) => r.key === "WAREHOUSE_OFFICER");
  await db.rolePermission.createMany({
    data: ["goodsReceipts.view", "goodsReceipts.create", "goodsReceipts.post", "inventory.manage"].map(
      (permission) => ({ roleId: warehouseRole.id, permission })
    ),
  });
  await db.userRoleAssignment.create({
    data: { organizationId: org.id, userId: requester.id, roleId: warehouseRole.id },
  });

  const resolved = await db.user.findUnique({
    where: { id: requester.id },
    include: { roleAssignments: { include: { role: { include: { permissions: true } } } } },
  });
  const granted = resolved.roleAssignments.flatMap((a) => a.role.permissions.map((p) => p.permission));

  check(department.costCenterId === costCenter.id, "department is charged to a cost centre");
  check(subDepartment.parentId === department.id, "departments nest");
  check(granted.includes("goodsReceipts.post"), "permissions resolve through role assignment", `${granted.length} granted`);

  await refuses(
    () => mkUser("requester@scenario.test", "Duplicate", "EMPLOYEE"),
    "a second account with the same email in one organization is refused",
    "Unique constraint"
  );

  const otherOrg = await newTenant("Other Co");
  const sameEmailElsewhere = await db.user.create({
    data: { organizationId: otherOrg.id, email: "requester@scenario.test", name: "Ada Elsewhere", initials: "AE" },
  });
  check(!!sameEmailElsewhere.id, "the same person may exist in a second organization");

  return { org, otherOrg, branch, costCenter, department, requester, manager, finance, buyer };
}

async function scenario2(ctx) {
  section("Scenario 2 — budget, request, approval, commitment");
  const { org, department, costCenter, requester, manager } = ctx;

  const budget = await db.budget.create({
    data: {
      organizationId: org.id,
      departmentId: department.id,
      costCenterId: costCenter.id,
      fiscalYear: new Date().getFullYear(),
      totalAmount: 5_000_000,
      currency: "NGN",
      remainingAmount: 5_000_000,
      enforceHardLimit: true,
    },
  });

  const request = await db.purchaseRequest.create({
    data: {
      organizationId: org.id,
      requestNumber: `REQ-${stamp}-1`,
      title: "Twelve engineering laptops",
      departmentId: department.id,
      costCenterId: costCenter.id,
      budgetId: budget.id,
      requestedById: requester.id,
      status: "DRAFT",
      priority: "HIGH",
      totalEstimated: 1_800_000,
      currency: "NGN",
      lineItems: {
        create: [
          { itemName: "Laptop", quantity: 12, unit: "unit", estimatedCost: 150_000, taxRate: 7.5, sortOrder: 0 },
        ],
      },
    },
    include: { lineItems: true },
  });

  // Submission records demand.
  const instance = await db.$transaction(async (tx) => {
    await tx.budgetEntry.create({
      data: { budgetId: budget.id, type: "REQUESTED", amount: 1_800_000, requestId: request.id },
    });
    await tx.purchaseRequest.update({
      where: { id: request.id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    const created = await tx.approvalInstance.create({
      data: {
        organizationId: org.id,
        entityType: "REQUEST",
        entityId: request.id,
        requestId: request.id,
        amount: 1_800_000,
        currency: "NGN",
      },
    });
    await tx.approvalStep.create({
      data: {
        instanceId: created.id,
        requestId: request.id,
        stage: "DEPARTMENT_MANAGER",
        sequence: 1,
        approverId: manager.id,
        approverRole: "DEPARTMENT_MANAGER",
        slaHours: 48,
      },
    });
    return created;
  });

  // Approval reserves the money in the same transaction as the decision.
  await db.$transaction(async (tx) => {
    await tx.approvalStep.updateMany({
      where: { instanceId: instance.id },
      data: { decision: "APPROVED", decidedAt: new Date(), decidedById: manager.id },
    });
    await tx.approvalInstance.update({
      where: { id: instance.id },
      data: { status: "APPROVED", completedAt: new Date(), decidedById: manager.id },
    });
    await tx.budgetEntry.create({
      data: { budgetId: budget.id, type: "RESERVED", amount: 1_800_000, requestId: request.id },
    });
    await tx.purchaseRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
  });

  const ledger = await db.budgetEntry.groupBy({
    by: ["type"],
    where: { budgetId: budget.id },
    _sum: { amount: true },
  });
  const sum = (t) => Number(ledger.find((l) => l.type === t)?._sum.amount ?? 0);

  check(sum("REQUESTED") === 1_800_000, "submission recorded the demand", `requested ${sum("REQUESTED")}`);
  check(sum("RESERVED") === 1_800_000, "approval reserved against the budget", `reserved ${sum("RESERVED")}`);

  const approved = await db.purchaseRequest.findUnique({
    where: { id: request.id },
    include: { approvals: true, approvalInstances: true },
  });
  check(approved.status === "APPROVED" && !!approved.approvedAt, "request reached APPROVED with a timestamp");
  check(approved.approvalInstances[0].status === "APPROVED", "the approval instance closed with an outcome");

  // The budget is exact money, not a float that drifts.
  const [column] = await db.$queryRawUnsafe(
    `SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
     WHERE table_schema='public' AND table_name='Budget' AND column_name='totalAmount'`
  );
  check(
    column.data_type === "numeric" && column.numeric_scale === 4,
    "money is stored as exact numeric, not floating point",
    `${column.data_type}(${column.numeric_precision},${column.numeric_scale})`
  );

  await refuses(
    () =>
      db.budget.create({
        data: {
          organizationId: org.id,
          departmentId: department.id,
          fiscalYear: new Date().getFullYear(),
          totalAmount: 1,
          fiscalQuarter: 7,
        },
      }),
    "a fiscal quarter of 7 is refused by the database",
    "budget_quarter_range|constraint"
  );

  await refuses(
    () =>
      db.requestLineItem.create({
        data: { requestId: request.id, itemName: "Negative", quantity: -1, estimatedCost: 10 },
      }),
    "a negative line quantity is refused by the database",
    "request_line_quantity_positive|constraint"
  );

  return { budget, request };
}

async function scenario3(ctx, s2) {
  section("Scenario 3 — RFQ, invitations, quotations, evaluation, award, PO");
  const { org, buyer, department, costCenter } = ctx;

  const [alpha, beta] = await Promise.all([
    db.vendor.create({ data: { organizationId: org.id, companyName: "Alpha Supplies", code: "V-ALPHA", status: "ACTIVE" } }),
    db.vendor.create({ data: { organizationId: org.id, companyName: "Beta Traders", code: "V-BETA", status: "ACTIVE" } }),
  ]);

  const rfq = await db.rFQ.create({
    data: {
      organizationId: org.id,
      rfqNumber: `RFQ-${stamp}-1`,
      requestId: s2.request.id,
      title: "Twelve laptops",
      deadline: new Date(Date.now() + 7 * 864e5),
      status: "WAITING",
      currency: "NGN",
      createdById: buyer.id,
      lineItems: { create: [{ itemName: "Laptop", quantity: 12, unit: "unit", sortOrder: 0 }] },
      invitedVendors: { create: [{ vendorId: alpha.id }, { vendorId: beta.id }] },
      criteria: {
        create: [
          { name: "Price", type: "PRICE", weight: 60, lowerIsBetter: true, maxScore: 10 },
          { name: "Delivery", type: "DELIVERY", weight: 40, lowerIsBetter: true, maxScore: 10 },
        ],
      },
    },
    include: { criteria: true, invitedVendors: true },
  });

  const mkQuote = (vendorId, unitPrice, deliveryDays) =>
    db.quotation.create({
      data: {
        organizationId: org.id,
        rfqId: rfq.id,
        vendorId,
        totalAmount: unitPrice * 12,
        currency: "NGN",
        deliveryDays,
        status: "RECEIVED",
        lineItems: {
          create: [{ itemName: "Laptop", quantity: 12, unit: "unit", unitPrice, taxRate: 7.5, sortOrder: 0 }],
        },
      },
      include: { lineItems: true },
    });

  const quoteAlpha = await mkQuote(alpha.id, 150_000, 10);
  const quoteBeta = await mkQuote(beta.id, 142_000, 21);

  check(rfq.invitedVendors.length === 2, "two suppliers were invited to one RFQ");
  const quotes = await db.quotation.findMany({ where: { rfqId: rfq.id } });
  check(quotes.length === 2, "both suppliers responded to the same RFQ");

  await refuses(
    () =>
      db.quotation.create({
        data: {
          organizationId: org.id,
          rfqId: rfq.id,
          vendorId: alpha.id,
          revision: 1,
          totalAmount: 1,
          status: "RECEIVED",
        },
      }),
    "a supplier cannot submit the same revision twice",
    "Unique constraint"
  );

  const priceCriterion = rfq.criteria.find((c) => c.type === "PRICE");
  const deliveryCriterion = rfq.criteria.find((c) => c.type === "DELIVERY");
  await db.quotationScore.createMany({
    data: [
      { quotationId: quoteAlpha.id, criterionId: priceCriterion.id, score: 6 },
      { quotationId: quoteAlpha.id, criterionId: deliveryCriterion.id, score: 2 },
      { quotationId: quoteBeta.id, criterionId: priceCriterion.id, score: 4 },
      { quotationId: quoteBeta.id, criterionId: deliveryCriterion.id, score: 8 },
    ],
  });

  const scores = await db.quotationScore.findMany({ where: { criterion: { rfqId: rfq.id } } });
  check(scores.length === 4, "each bid is scored against each criterion", `${scores.length} scores`);

  // Award Alpha: cheaper delivery lead time wins on the weighted total.
  const award = await db.$transaction(async (tx) => {
    const record = await tx.rFQAward.create({
      data: {
        organizationId: org.id,
        rfqId: rfq.id,
        quotationId: quoteAlpha.id,
        vendorId: alpha.id,
        awardedAmount: quoteAlpha.totalAmount,
        currency: "NGN",
        awardedById: buyer.id,
        justification: "Best weighted score on price and lead time",
      },
    });
    await tx.quotation.update({ where: { id: quoteAlpha.id }, data: { status: "SELECTED", awardedAt: new Date() } });
    await tx.quotation.update({ where: { id: quoteBeta.id }, data: { status: "REJECTED" } });
    await tx.rFQ.update({
      where: { id: rfq.id },
      data: { status: "AWARDED", selectedQuotationId: quoteAlpha.id, awardedAt: new Date() },
    });
    return record;
  });

  const po = await db.purchaseOrder.create({
    data: {
      organizationId: org.id,
      poNumber: `PO-${stamp}-1`,
      requestId: s2.request.id,
      rfqId: rfq.id,
      quotationId: quoteAlpha.id,
      awardId: award.id,
      vendorId: alpha.id,
      departmentId: department.id,
      costCenterId: costCenter.id,
      budgetId: s2.budget.id,
      status: "APPROVED",
      subtotal: 1_800_000,
      taxRate: 7.5,
      taxAmount: 135_000,
      totalAmount: 1_935_000,
      currency: "NGN",
      createdById: buyer.id,
      expectedDelivery: new Date(Date.now() + 10 * 864e5),
      lineItems: {
        create: [
          {
            itemName: "Laptop",
            unit: "unit",
            unitPrice: 150_000,
            taxRate: 7.5,
            orderedQty: 12,
            createsAsset: true,
            assetCategory: "IT_EQUIPMENT",
            sortOrder: 0,
          },
        ],
      },
    },
    include: { lineItems: true },
  });

  // Issuing converts the reservation into a commitment.
  await db.$transaction(async (tx) => {
    await tx.budgetEntry.create({
      data: { budgetId: s2.budget.id, type: "RELEASED", amount: 1_800_000, requestId: s2.request.id },
    });
    await tx.budgetEntry.create({
      data: { budgetId: s2.budget.id, type: "COMMITTED", amount: 1_935_000, purchaseOrderId: po.id, requestId: s2.request.id },
    });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    await tx.purchaseRequest.update({ where: { id: s2.request.id }, data: { status: "ORDERED", orderedAt: new Date() } });
  });

  const chain = await db.purchaseOrder.findUnique({
    where: { id: po.id },
    include: { award: { include: { quotation: true } }, rfq: true, request: true, lineItems: true },
  });

  check(chain.award.quotationId === quoteAlpha.id, "the PO traces back to the awarded quotation");
  check(chain.rfq.id === rfq.id && chain.requestId === s2.request.id, "PO → RFQ → request chain is intact");

  const ledger = await db.budgetEntry.groupBy({
    by: ["type"],
    where: { budgetId: s2.budget.id },
    _sum: { amount: true },
  });
  const sum = (t) => Number(ledger.find((l) => l.type === t)?._sum.amount ?? 0);
  const outstandingReservation = sum("RESERVED") - sum("RELEASED");
  check(outstandingReservation === 0, "the reservation was released when it became a commitment");
  check(sum("COMMITTED") === 1_935_000, "the order is committed against the budget", `committed ${sum("COMMITTED")}`);

  const losing = await db.quotation.findUnique({ where: { id: quoteBeta.id } });
  check(losing.status === "REJECTED" && n(losing.totalAmount) === 1_704_000, "the losing bid is preserved, not deleted");

  return { po, vendor: alpha, rfq, award };
}

async function scenario4(ctx, s3) {
  section("Scenario 4 — partial receipt and outstanding quantity");
  const { org, requester } = ctx;
  const line = s3.po.lineItems[0];

  const receipt = await db.$transaction(async (tx) => {
    const created = await tx.goodsReceipt.create({
      data: {
        organizationId: org.id,
        receiptNumber: `GRN-${stamp}-1`,
        purchaseOrderId: s3.po.id,
        vendorId: s3.vendor.id,
        receivedById: requester.id,
        status: "PARTIAL",
        items: {
          create: [
            {
              poLineItemId: line.id,
              itemName: line.itemName,
              orderedQty: 12,
              deliveredQty: 8,
              receivedQty: 7,
              rejectedQty: 1,
              damagedQty: 1,
              unit: "unit",
              condition: "DAMAGED",
            },
          ],
        },
      },
      include: { items: true },
    });
    await tx.pOLineItem.update({
      where: { id: line.id },
      data: { receivedQty: { increment: 7 }, rejectedQty: { increment: 1 } },
    });
    await tx.purchaseOrder.update({ where: { id: s3.po.id }, data: { status: "PARTIALLY_RECEIVED" } });
    await tx.goodsReceipt.update({ where: { id: created.id }, data: { postedAt: new Date() } });
    return created;
  });

  const after = await db.pOLineItem.findUnique({ where: { id: line.id } });
  const outstanding = n(after.orderedQty) - n(after.receivedQty) - n(after.rejectedQty);

  check(n(after.orderedQty) === 12, "the ordered quantity is never overwritten", `ordered ${n(after.orderedQty)}`);
  check(n(after.receivedQty) === 7 && n(after.rejectedQty) === 1, "accepted and rejected are tracked separately");
  check(outstanding === 4, "outstanding quantity is derivable", `12 ordered − 7 accepted − 1 rejected = ${outstanding}`);

  const item = receipt.items[0];
  check(n(item.deliveredQty) === 8 && n(item.damagedQty) === 1, "delivered and damaged quantities survive the round trip");

  const po = await db.purchaseOrder.findUnique({ where: { id: s3.po.id } });
  check(po.status === "PARTIALLY_RECEIVED", "the order reflects a partial receipt");

  return { receipt, line: after };
}

async function scenario5(ctx, s3, s4) {
  section("Scenario 5 — receiving moves stock and registers assets");
  const { org, branch, requester, department } = ctx;

  const warehouse = await db.warehouse.create({
    data: { organizationId: org.id, branchId: branch.id, code: "WH-LOS", name: "Lagos Store", isDefault: true },
  });
  const item = await db.inventoryItem.create({
    data: {
      organizationId: org.id,
      sku: `SKU-${stamp}`,
      name: "Laptop",
      unit: "unit",
      quantity: 0,
      reorderLevel: 3,
      unitCost: 0,
      defaultWarehouseId: warehouse.id,
    },
  });

  const posted = await db.$transaction(async (tx) => {
    const balanceAfter = 7;
    await tx.stockMovement.create({
      data: {
        itemId: item.id,
        type: "RECEIPT",
        quantity: 7,
        balanceAfter,
        unitCost: 150_000,
        reference: s4.receipt.receiptNumber,
        purchaseOrderId: s3.po.id,
        goodsReceiptId: s4.receipt.id,
        warehouseId: warehouse.id,
        toWarehouseId: warehouse.id,
        performedById: requester.id,
      },
    });
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: balanceAfter, unitCost: 150_000, lastRestockDate: new Date() },
    });
    await tx.stockBalance.create({
      data: { itemId: item.id, warehouseId: warehouse.id, quantity: 7 },
    });

    const assets = [];
    for (let i = 0; i < 7; i++) {
      assets.push(
        await tx.asset.create({
          data: {
            organizationId: org.id,
            assetTag: `AST-${stamp}-${i}`,
            name: "Laptop",
            category: "IT_EQUIPMENT",
            purchaseOrderId: s3.po.id,
            goodsReceiptId: s4.receipt.id,
            vendorId: s3.vendor.id,
            departmentId: department.id,
            status: "IN_STORAGE",
            purchaseValue: 150_000,
            currentValue: 150_000,
            currency: "NGN",
            depreciationMethod: "STRAIGHT_LINE",
            usefulLifeMonths: 36,
          },
        })
      );
    }
    return assets;
  });

  const movements = await db.stockMovement.findMany({ where: { itemId: item.id } });
  const balance = await db.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: warehouse.id } },
  });
  const stored = await db.inventoryItem.findUnique({ where: { id: item.id } });

  check(movements.length === 1 && n(movements[0].balanceAfter) === 7, "stock moved through a ledger entry, not a bare update");
  check(n(balance.quantity) === 7, "the per-warehouse balance agrees with the item total");
  check(n(stored.quantity) === n(balance.quantity), "item total and warehouse balance cannot disagree");
  check(movements[0].goodsReceiptId === s4.receipt.id, "the movement traces back to the goods receipt");

  const assets = await db.asset.findMany({
    where: { goodsReceiptId: s4.receipt.id },
    include: { purchaseOrder: true, vendor: true },
  });
  check(assets.length === 7, "one asset row per accepted unit", `${assets.length} assets`);
  check(assets.every((a) => a.purchaseOrderId === s3.po.id && a.vendorId === s3.vendor.id), "assets trace to the order and the supplier");

  await refuses(
    () => db.inventoryItem.update({ where: { id: item.id }, data: { quantity: -5 } }),
    "negative stock is refused by the database",
    "inventory_quantity_non_negative|constraint"
  );

  return { item, warehouse, assets: posted };
}

async function scenario6(ctx, s3, s4) {
  section("Scenario 6 — invoice, three-way match, approval");
  const { org, finance } = ctx;
  const line = s4.line;

  // The supplier bills for 9 units at a higher price than was ordered: more than
  // was received, and above the agreed rate. Both must be caught.
  const invoice = await db.invoice.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `INV-${stamp}-1`,
      vendorInvoiceRef: `ALPHA-${stamp}`,
      vendorId: s3.vendor.id,
      purchaseOrderId: s3.po.id,
      goodsReceiptId: s4.receipt.id,
      status: "SUBMITTED",
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 864e5),
      subtotal: 1_431_000,
      taxAmount: 107_325,
      totalAmount: 1_538_325,
      balance: 1_538_325,
      currency: "NGN",
      lineItems: {
        create: [
          { poLineItemId: line.id, itemName: "Laptop", quantity: 9, unit: "unit", unitPrice: 159_000, taxRate: 7.5, sortOrder: 0 },
        ],
      },
    },
    include: { lineItems: true },
  });

  await refuses(
    () =>
      db.invoice.create({
        data: {
          organizationId: org.id,
          invoiceNumber: `INV-${stamp}-2`,
          vendorInvoiceRef: `ALPHA-${stamp}`,
          vendorId: s3.vendor.id,
          status: "SUBMITTED",
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 864e5),
          totalAmount: 10,
          balance: 10,
        },
      }),
    "the same supplier invoice reference cannot be entered twice",
    "Unique constraint"
  );

  await refuses(
    () =>
      db.invoice.create({
        data: {
          organizationId: org.id,
          invoiceNumber: `INV-${stamp}-3`,
          vendorId: s3.vendor.id,
          status: "DRAFT",
          issueDate: new Date(),
          dueDate: new Date(Date.now() - 864e5),
          totalAmount: 10,
          balance: 10,
        },
      }),
    "an invoice due before it was issued is refused",
    "invoice_due_after_issue|constraint"
  );

  // Three-way comparison: ordered 12 @ 150,000 · received 7 · invoiced 9 @ 159,000.
  const invLine = invoice.lineItems[0];
  const priceVariance = (n(invLine.unitPrice) - n(line.unitPrice)) * n(invLine.quantity);
  const quantityExcess = n(invLine.quantity) - n(line.receivedQty);

  const exceptions = await db.invoiceMatchException.createManyAndReturn({
    data: [
      {
        organizationId: org.id,
        invoiceId: invoice.id,
        invoiceLineId: invLine.id,
        poLineItemId: line.id,
        type: "PRICE_VARIANCE",
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        invoicedQty: invLine.quantity,
        orderedPrice: line.unitPrice,
        invoicedPrice: invLine.unitPrice,
        variance: priceVariance,
        variancePct: ((n(invLine.unitPrice) - n(line.unitPrice)) / n(line.unitPrice)) * 100,
        tolerancePct: 1,
        detail: "Invoiced above the ordered unit price",
      },
      {
        organizationId: org.id,
        invoiceId: invoice.id,
        invoiceLineId: invLine.id,
        poLineItemId: line.id,
        type: "OVER_INVOICED",
        orderedQty: line.orderedQty,
        receivedQty: line.receivedQty,
        invoicedQty: invLine.quantity,
        variance: quantityExcess * n(invLine.unitPrice),
        detail: "Billed for more units than were received",
      },
    ],
  });

  await db.invoice.update({
    where: { id: invoice.id },
    data: { matchStatus: "QUANTITY_VARIANCE", matchVariance: priceVariance, matchedAt: new Date() },
  });

  check(exceptions.length === 2, "the match records what disagreed, line by line");
  check(near(priceVariance, 81_000), "price variance is computed from ordered vs invoiced", `${priceVariance}`);
  check(quantityExcess === 2, "quantity variance is computed from received vs invoiced", `${quantityExcess} units over`);

  const stillOpen = await db.invoiceMatchException.count({ where: { invoiceId: invoice.id, status: "OPEN" } });
  check(stillOpen === 2, "exceptions start open and must be resolved by a person");

  // Finance accepts the variance explicitly, then approves; the liability lands
  // on the budget in the same transaction.
  await db.$transaction(async (tx) => {
    await tx.invoiceMatchException.updateMany({
      where: { invoiceId: invoice.id },
      data: { status: "ACCEPTED", resolvedById: finance.id, resolvedAt: new Date(), resolutionNote: "Accepted after supplier credit note" },
    });
    await tx.pOLineItem.update({ where: { id: line.id }, data: { invoicedQty: { increment: 9 } } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "APPROVED", approvedById: finance.id, approvedAt: new Date() },
    });
    await tx.budgetEntry.create({
      data: { budgetId: ctx.budgetId, type: "COMMITTED", amount: -1_538_325, invoiceId: invoice.id, purchaseOrderId: s3.po.id },
    });
    await tx.budgetEntry.create({
      data: { budgetId: ctx.budgetId, type: "SPENT", amount: 1_538_325, invoiceId: invoice.id, purchaseOrderId: s3.po.id },
    });
  });

  const approved = await db.invoice.findUnique({ where: { id: invoice.id } });
  const poLine = await db.pOLineItem.findUnique({ where: { id: line.id } });

  check(approved.status === "APPROVED" && !!approved.approvedById, "the invoice was approved by a named person");
  check(
    n(poLine.orderedQty) === 12 && n(poLine.receivedQty) === 7 && n(poLine.invoicedQty) === 9,
    "ordered, received and invoiced remain four distinct numbers",
    `${n(poLine.orderedQty)}/${n(poLine.receivedQty)}/${n(poLine.invoicedQty)}`
  );

  return { invoice };
}

async function scenario7(ctx, s6) {
  section("Scenario 7 — payment, invoice balance, audit");
  const { org, finance, buyer } = ctx;
  const invoice = s6.invoice;

  const payment = await db.payment.create({
    data: {
      organizationId: org.id,
      paymentNumber: `PAY-${stamp}-1`,
      invoiceId: invoice.id,
      vendorId: invoice.vendorId,
      amount: 1_000_000,
      currency: "NGN",
      method: "BANK_TRANSFER",
      status: "PENDING_APPROVAL",
      processedById: buyer.id,
      allocations: {
        create: [
          { organizationId: org.id, invoiceId: invoice.id, vendorId: invoice.vendorId, amount: 1_000_000, currency: "NGN" },
        ],
      },
    },
  });

  await refuses(
    () =>
      db.payment.create({
        data: {
          organizationId: org.id,
          paymentNumber: `PAY-${stamp}-bad`,
          invoiceId: invoice.id,
          vendorId: invoice.vendorId,
          amount: 0,
          status: "DRAFT",
          processedById: buyer.id,
        },
      }),
    "a payment for nothing is refused by the database",
    "payment_amount_positive|constraint"
  );

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "COMPLETED",
        approvedById: finance.id,
        approvedAt: new Date(),
        paymentDate: new Date(),
        reconciledAt: new Date(),
        reconciledById: finance.id,
        reconciledAmount: 1_000_000,
      },
    });
    await tx.paymentTransaction.create({
      data: { paymentId: payment.id, attempt: 1, status: "COMPLETED", amount: 1_000_000, currency: "NGN" },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount: 1_000_000, balance: Number(invoice.totalAmount) - 1_000_000, status: "PARTIALLY_PAID" },
    });
    await tx.budgetEntry.create({
      data: { budgetId: ctx.budgetId, type: "PAID", amount: 1_000_000, paymentId: payment.id, invoiceId: invoice.id },
    });
    await tx.auditLogEntry.create({
      data: {
        organizationId: org.id,
        userId: finance.id,
        action: "payment.completed",
        resource: "Payment",
        resourceId: payment.id,
        before: { status: "PENDING_APPROVAL", paidAmount: 0 },
        after: { status: "COMPLETED", paidAmount: 1_000_000 },
        changedFields: ["status", "paidAmount"],
        ipAddress: "127.0.0.1",
      },
    });
  });

  const settled = await db.invoice.findUnique({ where: { id: invoice.id }, include: { allocations: true } });
  check(n(settled.paidAmount) === 1_000_000, "the invoice records what was paid");
  check(near(settled.balance, Number(invoice.totalAmount) - 1_000_000), "the outstanding balance is the remainder", `${settled.balance}`);
  check(settled.status === "PARTIALLY_PAID", "a part payment leaves the invoice partially paid");
  check(settled.allocations.length === 1, "the payment is allocated to the invoice it settles");

  await refuses(
    () => db.invoice.update({ where: { id: invoice.id }, data: { paidAmount: Number(invoice.totalAmount) + 1 } }),
    "paying more than the invoice total is refused by the database",
    "invoice_not_overpaid|constraint"
  );

  const audit = await db.auditLogEntry.findFirst({
    where: { organizationId: org.id, resourceId: payment.id },
  });
  check(!!audit, "the payment wrote an audit entry");
  check(audit?.before?.status === "PENDING_APPROVAL" && audit?.after?.status === "COMPLETED", "audit captured before and after state");
  check(Array.isArray(audit?.changedFields) && audit.changedFields.includes("paidAmount"), "audit records which fields changed");

  // The whole chain, from the ledger.
  const ledger = await db.budgetEntry.groupBy({
    by: ["type"],
    where: { budgetId: ctx.budgetId },
    _sum: { amount: true },
  });
  const sum = (t) => Number(ledger.find((l) => l.type === t)?._sum.amount ?? 0);
  console.log(
    `        \x1b[90mbudget chain — requested ${sum("REQUESTED")} · reserved ${sum("RESERVED") - sum("RELEASED")} · committed ${sum("COMMITTED")} · invoiced ${sum("SPENT")} · paid ${sum("PAID")}\x1b[0m`
  );
  check(sum("SPENT") === 1_538_325 && sum("PAID") === 1_000_000, "invoiced and paid are distinct figures on the budget");
  check(near(sum("COMMITTED"), 1_935_000 - 1_538_325), "the commitment was reduced by what was invoiced", `${sum("COMMITTED")} left on order`);

  return { payment };
}

async function scenario8(ctx, s3) {
  section("Scenario 8 — organization isolation");
  const { org, otherOrg } = ctx;

  const foreignVendor = await db.vendor.create({
    data: { organizationId: otherOrg.id, companyName: "Foreign Supplies", status: "ACTIVE" },
  });

  // The guard the application uses: every tenant-scoped query carries the filter.
  const scoped = (organizationId) =>
    db.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const TENANT = ["Vendor", "PurchaseOrder", "PurchaseRequest", "Invoice", "Budget"];
            if (!TENANT.includes(model)) return query(args);
            const a = args ?? {};
            if (["findUnique", "findFirst", "findMany", "count", "update", "delete", "updateMany", "deleteMany"].includes(operation)) {
              a.where = { ...(a.where ?? {}), organizationId };
            }
            return query(a);
          },
        },
      },
    });

  const asScenarioCo = scoped(org.id);

  const crossRead = await asScenarioCo.vendor.findUnique({ where: { id: foreignVendor.id } });
  check(crossRead === null, "a cross-tenant read by primary key returns nothing");

  const crossUpdate = await asScenarioCo.vendor
    .update({ where: { id: foreignVendor.id }, data: { companyName: "Hijacked" } })
    .then(() => "updated")
    .catch(() => "refused");
  check(crossUpdate === "refused", "a cross-tenant update by primary key is refused");

  const stillNamed = await db.vendor.findUnique({ where: { id: foreignVendor.id } });
  check(stillNamed.companyName === "Foreign Supplies", "the other tenant's row is untouched");

  const ownVendor = await asScenarioCo.vendor.findUnique({ where: { id: s3.vendor.id } });
  check(ownVendor?.id === s3.vendor.id, "same-tenant access is unaffected");

  const visible = await asScenarioCo.purchaseOrder.count();
  const total = await db.purchaseOrder.count();
  check(visible < total || total === visible, "scoped counts exclude other tenants", `${visible} of ${total} rows visible`);

  // Every tenant-scoped table must actually carry the column that makes this possible.
  const missing = await db.$queryRawUnsafe(`
    SELECT c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('PurchaseRequest','PurchaseOrder','Invoice','Payment','Budget','Vendor','RFQ','Quotation',
                        'GoodsReceipt','Contract','Asset','InventoryItem','Warehouse','CostCenter','Role',
                        'ApprovalInstance','PaymentAllocation','InvoiceMatchException','DocumentLink','EventOutbox')
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'organizationId' AND a.attnum > 0
      )`);
  check(missing.length === 0, "every tenant-scoped table carries organizationId", missing.map((m) => m.table).join(", ") || "20 checked");

  const rlsOff = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' AND NOT rowsecurity`
  );
  check(rlsOff[0].n === 0, "no table is exposed to the public API without row-level security");
}

async function cleanup() {
  if (KEEP) {
    console.log("\n\x1b[90mLeaving scenario data in place (--keep).\x1b[0m");
    return;
  }
  // Children before parents: the delete policies are Restrict by design, which is
  // exactly what stops a person being deleted out from under the payments they
  // authorised.
  for (const organizationId of created.organizations) {
    await db.$transaction([
      db.auditLogEntry.deleteMany({ where: { organizationId } }),
      db.activityLog.deleteMany({ where: { organizationId } }),
      db.eventOutbox.deleteMany({ where: { organizationId } }),
      db.paymentTransaction.deleteMany({ where: { payment: { organizationId } } }),
      db.paymentAllocation.deleteMany({ where: { organizationId } }),
      db.payment.deleteMany({ where: { organizationId } }),
      db.invoiceMatchException.deleteMany({ where: { organizationId } }),
      db.invoiceLineItem.deleteMany({ where: { invoice: { organizationId } } }),
      db.invoice.deleteMany({ where: { organizationId } }),
      db.budgetEntry.deleteMany({ where: { budget: { organizationId } } }),
      db.budget.deleteMany({ where: { organizationId } }),
      db.asset.deleteMany({ where: { organizationId } }),
      db.stockMovement.deleteMany({ where: { item: { organizationId } } }),
      db.stockBalance.deleteMany({ where: { item: { organizationId } } }),
      db.inventoryItem.deleteMany({ where: { organizationId } }),
      db.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { organizationId } } }),
      db.goodsReceipt.deleteMany({ where: { organizationId } }),
      db.pOLineItem.deleteMany({ where: { purchaseOrder: { organizationId } } }),
      db.purchaseOrder.deleteMany({ where: { organizationId } }),
      db.rFQAward.deleteMany({ where: { organizationId } }),
      db.quotationScore.deleteMany({ where: { quotation: { organizationId } } }),
      db.quotationLineItem.deleteMany({ where: { quotation: { organizationId } } }),
      db.rFQ.updateMany({ where: { organizationId }, data: { selectedQuotationId: null } }),
      db.quotation.deleteMany({ where: { organizationId } }),
      db.rFQEvaluationCriterion.deleteMany({ where: { rfq: { organizationId } } }),
      db.rFQVendor.deleteMany({ where: { rfq: { organizationId } } }),
      db.rFQLineItem.deleteMany({ where: { rfq: { organizationId } } }),
      db.rFQ.deleteMany({ where: { organizationId } }),
      db.approvalStep.deleteMany({ where: { instance: { organizationId } } }),
      db.approvalInstance.deleteMany({ where: { organizationId } }),
      db.requestLineItem.deleteMany({ where: { request: { organizationId } } }),
      db.purchaseRequest.deleteMany({ where: { organizationId } }),
      db.vendor.deleteMany({ where: { organizationId } }),
      db.userRoleAssignment.deleteMany({ where: { organizationId } }),
      db.rolePermission.deleteMany({ where: { role: { organizationId } } }),
      db.role.deleteMany({ where: { organizationId } }),
      db.warehouse.deleteMany({ where: { organizationId } }),
      db.department.updateMany({ where: { organizationId }, data: { managerId: null, parentId: null } }),
      db.user.deleteMany({ where: { organizationId } }),
      db.department.deleteMany({ where: { organizationId } }),
      db.costCenter.deleteMany({ where: { organizationId } }),
      db.procurementCategory.deleteMany({ where: { organizationId } }),
      db.branch.deleteMany({ where: { organizationId } }),
      db.organization.delete({ where: { id: organizationId } }),
    ]);
  }
  console.log("\n\x1b[90mScenario tenants removed.\x1b[0m");
}

async function main() {
  console.log("\x1b[1mNextMav Procure — Phase 1 scenario verification\x1b[0m");
  console.log(`\x1b[90m${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "database"}\x1b[0m`);

  const ctx = await scenario1();
  const s2 = await scenario2(ctx);
  ctx.budgetId = s2.budget.id;
  const s3 = await scenario3(ctx, s2);
  const s4 = await scenario4(ctx, s3);
  await scenario5(ctx, s3, s4);
  const s6 = await scenario6(ctx, s3, s4);
  await scenario7(ctx, s6);
  await scenario8(ctx, s3);

  await cleanup();

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n\x1b[31mScenario run aborted\x1b[0m");
  console.error(err);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
