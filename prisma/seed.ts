// NextMav Procure — database seed.
//
// Loads the existing demo dataset from `src/lib/seed-data.ts` into the database.
// The data itself is unchanged: same organization, same people, same vendors,
// same purchase requests. What changes is where it lives — it is now real rows
// that survive a refresh, rather than a module re-evaluated on every page load.
//
// Original ids (`org_apex`, `usr_amina`, `req_001`, …) are preserved so that every
// relationship in the seed data continues to resolve, and so anyone familiar with
// the demo data recognises it in the database.
//
// Run:  npm run db:seed
//
// Refuses to run against NODE_ENV=production.

import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/server/password.ts";
import * as seed from "../src/lib/seed-data.ts";

const db = new PrismaClient({ log: ["error"] });

/**
 * Shared password for every seeded account, so the demo is explorable across
 * roles. This is development data; real accounts are created through invitation
 * with a user-chosen password.
 */
const DEMO_PASSWORD = "NextMav#2026";

const date = (v: string | undefined | null): Date | null => (v ? new Date(v) : null);
const dateOr = (v: string | undefined | null, fallback: Date = new Date()): Date =>
  v ? new Date(v) : fallback;
const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

function assertNotProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production database.");
  }
}

/**
 * Removes existing rows so the seed is repeatable.
 *
 * Deleting the Organization and letting cascades do the rest does not work, and
 * that is deliberate: relations such as `Payment.processedBy → User` and
 * `Asset.assignedTo → User` are Restrict rather than Cascade, because in a real
 * deployment removing a person must never silently delete the payments they
 * authorised. So the seed deletes explicitly, children before parents.
 */
async function reset() {
  // RFQ.selectedQuotationId points at a Quotation that is about to be deleted.
  await db.rFQ.updateMany({ data: { selectedQuotationId: null } });

  const order = [
    db.aIMessage,
    db.aIConversation,
    db.documentAccessLog,
    db.documentVersion,
    db.documentRecord,
    db.integrationLog,
    db.integration,
    db.webhookDelivery,
    db.notificationDelivery,
    db.notification,
    db.notificationPreference,
    db.savedView,
    db.digitalSignature,
    db.auditLogEntry,
    db.activityLog,
    db.budgetEntry,
    db.budgetAlert,
    db.budgetCategory,
    db.budget,
    db.payment,
    db.invoiceLineItem,
    db.invoice,
    db.assetMaintenance,
    db.assetTransfer,
    db.asset,
    db.stockMovement,
    db.goodsReceiptItem,
    db.goodsReceipt,
    db.pORevision,
    db.pOLineItem,
    db.inventoryItem,
    db.purchaseOrder,
    db.contractObligation,
    db.contractVersion,
    db.contract,
    db.quotationLineItem,
    db.quotation,
    db.rFQVendor,
    db.rFQLineItem,
    db.rFQ,
    db.comment,
    db.requestWatcher,
    db.requestVersion,
    db.approvalStep,
    db.requestLineItem,
    db.purchaseRequest,
    db.recurringRequest,
    db.requestTemplate,
    db.approvalWorkflowStage,
    db.approvalWorkflow,
    db.supplierSession,
    db.supplierActivity,
    db.supplierUser,
    db.vendorDocument,
    db.vendor,
    db.rolePermissionOverride,
    db.session,
    db.user,
    db.storedFile,
    db.department,
    db.branch,
    db.documentSequence,
    db.rateLimitBucket,
    db.organization,
  ];

  for (const model of order) {
    await (model as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
  }
}

async function main() {
  assertNotProduction();

  const org = seed.seedOrganization;
  console.log(`Seeding "${org.name}" …`);
  await reset();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // -------------------------------------------------------------------------
  // Organization, branches, departments
  // -------------------------------------------------------------------------
  await db.organization.create({
    data: {
      id: org.id,
      name: org.name,
      legalName: org.legalName ?? null,
      industry: org.industry ?? null,
      country: org.country ?? null,
      currency: org.currency ?? "USD",
      taxId: org.taxId ?? null,
      brandPrimaryColor: (org as { branding?: { primaryColor?: string } }).branding?.primaryColor ?? null,
      createdAt: dateOr(org.createdAt),
    },
  });

  await db.branch.createMany({
    data: seed.seedBranches.map((b) => ({
      id: b.id,
      organizationId: org.id,
      name: b.name,
      address: b.address ?? null,
      city: b.city ?? null,
      country: b.country ?? null,
    })),
  });

  await db.department.createMany({
    data: seed.seedDepartments.map((d) => ({
      id: d.id,
      organizationId: org.id,
      branchId: d.branchId ?? null,
      name: d.name,
    })),
  });
  console.log(`  branches ${seed.seedBranches.length} · departments ${seed.seedDepartments.length}`);

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  for (const u of seed.seedUsers) {
    await db.user.create({
      data: {
        id: u.id,
        organizationId: org.id,
        branchId: u.branchId ?? null,
        departmentId: u.departmentId ?? null,
        email: u.email.toLowerCase(),
        name: u.name,
        role: u.role,
        status: u.status,
        jobTitle: u.jobTitle ?? null,
        phone: u.phone ?? null,
        avatarColor: u.avatarColor,
        initials: u.initials,
        passwordHash,
        mfaEnabled: u.mfaEnabled ?? false,
        lastLoginAt: date(u.lastLoginAt),
        customPermissions: u.customPermissions ? JSON.stringify(u.customPermissions) : null,
        createdAt: dateOr(u.createdAt),
      },
    });
  }

  const pref = seed.seedNotificationPreference;
  await db.notificationPreference.create({
    data: {
      userId: pref.userId,
      channelInApp: pref.channels.inApp,
      channelEmail: pref.channels.email,
      channelPush: pref.channels.push,
      channelSlack: pref.channels.slack ?? false,
      channelTeams: pref.channels.teams ?? false,
      channelWhatsapp: pref.channels.whatsapp ?? false,
      channelSms: pref.channels.sms ?? false,
      catApprovals: pref.categories.approvals,
      catRequests: pref.categories.requests,
      catRfqs: pref.categories.rfqs,
      catPurchaseOrders: pref.categories.purchaseOrders,
      catBudgetAlerts: pref.categories.budgetAlerts,
      catSlaWarnings: pref.categories.slaWarnings,
      catMentions: pref.categories.mentions,
      catWeeklyDigest: pref.categories.weeklyDigest,
      quietHoursStart: pref.quietHoursStart ?? null,
      quietHoursEnd: pref.quietHoursEnd ?? null,
    },
  });
  console.log(`  users ${seed.seedUsers.length}`);

  // -------------------------------------------------------------------------
  // Vendors + compliance documents
  // -------------------------------------------------------------------------
  for (const v of seed.seedVendors) {
    await db.vendor.create({
      data: {
        id: v.id,
        organizationId: org.id,
        companyName: v.companyName,
        contactPerson: v.contactPerson ?? null,
        email: v.email ?? null,
        phone: v.phone ?? null,
        address: v.address ?? null,
        category: v.category ?? null,
        taxNumber: v.taxNumber ?? null,
        bankName: v.bankName ?? null,
        bankAccount: v.bankAccount ?? null,
        paymentTerms: v.paymentTerms ?? "NET_30",
        preferredCurrency: v.preferredCurrency ?? org.currency,
        status: v.status,
        rating: v.rating ?? 0,
        notes: v.notes ?? null,
        tags: json(v.tags),
        totalOrders: v.totalOrders ?? 0,
        totalValue: v.totalValue ?? 0,
        complianceScore: v.complianceScore ?? 0,
        onTimeDeliveryRate: v.onTimeDeliveryRate ?? 0,
        qualityRating: v.qualityRating ?? 0,
        createdAt: dateOr(v.createdAt),
        documents: {
          create: (v.documents ?? []).map((d) => ({
            id: d.id,
            type: d.type,
            // The original carried fileName/fileSize but no bytes. Metadata is kept;
            // storedFileId stays null until a real file is attached through the
            // document service.
            name: d.name,
            status: d.status,
            expiresAt: date(d.expiresAt),
            uploadedAt: dateOr(d.uploadedAt),
          })),
        },
      },
    });
  }
  console.log(`  vendors ${seed.seedVendors.length}`);

  // -------------------------------------------------------------------------
  // Approval workflows
  // -------------------------------------------------------------------------
  for (const w of seed.seedWorkflows) {
    await db.approvalWorkflow.create({
      data: {
        id: w.id,
        organizationId: org.id,
        name: w.name,
        description: w.description ?? null,
        isActive: w.isActive,
        thresholdMin: w.thresholdMin ?? null,
        thresholdMax: w.thresholdMax ?? null,
        priorityFilter: json(w.priorityFilter),
        // Narrower workflows must be considered before broader ones; a bounded
        // threshold is more specific than an open-ended one.
        selectionPriority: w.thresholdMax ? 10 : 0,
        createdAt: dateOr(w.createdAt),
        stages: {
          create: w.stages.map((s, i) => ({
            id: s.id,
            name: s.name,
            stage: s.stage,
            approverRole: s.approverRole,
            sequence: i + 1,
            slaHours: s.slaHours,
            escalationRole: s.escalationRole ?? null,
            allowDelegation: s.allowDelegation,
            isParallel: s.isParallel,
          })),
        },
      },
    });
  }
  console.log(`  workflows ${seed.seedWorkflows.length}`);

  // -------------------------------------------------------------------------
  // Budgets
  // -------------------------------------------------------------------------
  for (const b of seed.seedBudgets) {
    await db.budget.create({
      data: {
        id: b.id,
        organizationId: org.id,
        departmentId: b.departmentId,
        fiscalYear: b.fiscalYear,
        fiscalQuarter: b.fiscalQuarter ?? null,
        totalAmount: b.totalAmount,
        currency: org.currency,
        status: b.status,
        committedAmount: b.committedAmount ?? 0,
        spentAmount: b.spentAmount ?? 0,
        reservedAmount: 0,
        remainingAmount: b.remainingAmount ?? b.totalAmount,
        createdAt: dateOr(b.createdAt),
        categories: {
          create: (b.categories ?? []).map((c) => ({
            name: c.name,
            allocated: c.allocated,
            spent: c.spent,
          })),
        },
        alerts: {
          create: (b.alerts ?? []).map((a) => ({
            threshold: a.threshold,
            triggered: a.triggered,
            triggeredAt: date(a.triggeredAt),
          })),
        },
      },
    });
  }
  console.log(`  budgets ${seed.seedBudgets.length}`);

  // -------------------------------------------------------------------------
  // Request templates
  // -------------------------------------------------------------------------
  await db.requestTemplate.createMany({
    data: seed.seedTemplates.map((t) => ({
      id: t.id,
      organizationId: org.id,
      name: t.name,
      description: t.description ?? null,
      category: t.category ?? null,
      departmentId: t.departmentId ?? null,
      priority: t.priority,
      defaultLineItems: JSON.stringify(t.defaultLineItems ?? []),
      defaultJustification: t.defaultJustification ?? null,
      usageCount: t.usageCount ?? 0,
      createdById: t.createdBy,
      createdAt: dateOr(t.createdAt),
    })),
  });

  // -------------------------------------------------------------------------
  // Purchase requests (+ line items, approvals, comments, watchers)
  // -------------------------------------------------------------------------
  for (const r of seed.seedRequests) {
    await db.purchaseRequest.create({
      data: {
        id: r.id,
        organizationId: org.id,
        requestNumber: r.requestNumber,
        title: r.title,
        departmentId: r.departmentId ?? null,
        requestedById: r.requestedById,
        status: r.status,
        priority: r.priority,
        category: r.category ?? null,
        tags: json(r.tags),
        businessJustification: r.businessJustification ?? null,
        neededByDate: date(r.neededByDate),
        totalEstimated: r.totalEstimated ?? 0,
        currency: r.currency ?? org.currency,
        version: r.version ?? 1,
        submittedAt: date(r.submittedAt),
        completedAt: date(r.completedAt),
        createdAt: dateOr(r.createdAt),
        updatedAt: dateOr(r.updatedAt),
        lineItems: {
          create: (r.lineItems ?? []).map((li, i) => ({
            id: li.id,
            itemName: li.itemName,
            description: li.description ?? null,
            quantity: li.quantity,
            unit: li.unit ?? "unit",
            estimatedCost: li.estimatedCost,
            taxRate: li.taxRate ?? 0,
            sortOrder: i,
          })),
        },
        approvals: {
          create: (r.approvals ?? []).map((a, i) => ({
            id: a.id,
            stage: a.stage,
            sequence: i + 1,
            approverId: a.approverId,
            approverRole: a.approverRole,
            decision: a.decision,
            comment: a.comment ?? null,
            delegatedToId: a.delegatedTo ?? null,
            decidedAt: date(a.decidedAt),
            slaHours: a.slaHours ?? 48,
            slaExpiresAt: date(a.slaExpiresAt),
            isEscalated: a.isEscalated ?? false,
            createdAt: dateOr(a.createdAt),
          })),
        },
        comments: {
          create: (r.comments ?? []).map((c) => ({
            id: c.id,
            entityType: "REQUEST" as const,
            entityId: r.id,
            authorId: c.authorId,
            content: c.content,
            mentions: json(c.mentions),
            createdAt: dateOr(c.createdAt),
          })),
        },
        watchers: {
          create: [...new Set(r.watchers ?? [])].map((userId) => ({ userId })),
        },
      },
    });
  }
  console.log(`  requests ${seed.seedRequests.length}`);

  // -------------------------------------------------------------------------
  // RFQs (+ invitations, quotations)
  // -------------------------------------------------------------------------
  for (const rfq of seed.seedRFQs) {
    await db.rFQ.create({
      data: {
        id: rfq.id,
        organizationId: org.id,
        rfqNumber: rfq.rfqNumber,
        requestId: rfq.requestId ?? null,
        title: rfq.title,
        description: rfq.description ?? null,
        deadline: dateOr(rfq.deadline),
        status: rfq.status,
        remindersSent: rfq.remindersSent ?? 0,
        createdAt: dateOr(rfq.createdAt),
        invitedVendors: {
          create: (rfq.invitedVendorIds ?? []).map((vendorId) => ({
            vendorId,
            status: (rfq.quotations ?? []).some((q) => q.vendorId === vendorId)
              ? ("QUOTED" as const)
              : ("INVITED" as const),
            invitedAt: dateOr(rfq.createdAt),
          })),
        },
        quotations: {
          create: (rfq.quotations ?? []).map((q) => ({
            id: q.id,
            vendorId: q.vendorId,
            revision: 1,
            totalAmount: q.totalAmount,
            currency: q.currency ?? org.currency,
            deliveryDays: q.deliveryDays ?? 0,
            warranty: q.warranty ?? null,
            paymentTerms: q.paymentTerms ?? null,
            validUntil: date(q.validUntil),
            notes: q.notes ?? null,
            status:
              rfq.selectedQuotationId === q.id ? ("SELECTED" as const) : ("RECEIVED" as const),
            submittedAt: dateOr(q.createdAt),
            createdAt: dateOr(q.createdAt),
          })),
        },
      },
    });

    // Set after creation: the FK points at a quotation that must already exist.
    if (rfq.selectedQuotationId) {
      await db.rFQ.update({
        where: { id: rfq.id },
        data: { selectedQuotationId: rfq.selectedQuotationId, awardedAt: dateOr(rfq.createdAt) },
      });
    }
  }
  console.log(`  rfqs ${seed.seedRFQs.length}`);

  // -------------------------------------------------------------------------
  // Purchase orders (+ line items, revisions)
  //
  // The original line items carried `quantity`/`estimatedCost`. The PO line model
  // now tracks ordered/received/rejected/invoiced separately — `orderedQty` takes
  // the original quantity, and the received/invoiced figures are derived below
  // from the goods receipts and invoices rather than being asserted here.
  // -------------------------------------------------------------------------
  const poLineIdMap = new Map<string, string>();

  for (const po of seed.seedPurchaseOrders) {
    await db.purchaseOrder.create({
      data: {
        id: po.id,
        organizationId: org.id,
        poNumber: po.poNumber,
        requestId: po.requestId ?? null,
        rfqId: (po as { rfqId?: string }).rfqId ?? null,
        quotationId: (po as { quotationId?: string }).quotationId ?? null,
        vendorId: po.vendorId,
        status: po.status,
        subtotal: po.subtotal ?? 0,
        taxRate: po.taxRate ?? 0,
        taxAmount: po.taxAmount ?? 0,
        totalAmount: po.totalAmount ?? 0,
        currency: po.currency ?? org.currency,
        termsAndConditions: po.termsAndConditions ?? null,
        notes: po.notes ?? null,
        version: po.version ?? 1,
        issuedAt: date(po.issuedAt),
        expectedDelivery: date(po.expectedDelivery),
        receivedAt: date(po.receivedAt),
        createdAt: dateOr(po.issuedAt),
        lineItems: {
          create: (po.lineItems ?? []).map((li, i) => ({
            id: li.id,
            itemName: li.itemName,
            description: li.description ?? null,
            unit: li.unit ?? "unit",
            unitPrice: li.estimatedCost,
            taxRate: li.taxRate ?? 0,
            orderedQty: li.quantity,
            sortOrder: i,
          })),
        },
        revisions: {
          create: (po.revisions ?? []).map((rev) => ({
            version: rev.version,
            reason: rev.reason,
            modifiedById: rev.modifiedBy,
            modifiedAt: dateOr(rev.modifiedAt),
          })),
        },
      },
    });

    for (const li of po.lineItems ?? []) poLineIdMap.set(li.id, li.id);
  }
  console.log(`  purchase orders ${seed.seedPurchaseOrders.length}`);

  // -------------------------------------------------------------------------
  // Goods receipts
  // -------------------------------------------------------------------------
  for (const gr of seed.seedGoodsReceipts) {
    const po = seed.seedPurchaseOrders.find((p) => p.id === gr.poId);

    await db.goodsReceipt.create({
      data: {
        id: gr.id,
        organizationId: org.id,
        receiptNumber: gr.receiptNumber,
        purchaseOrderId: gr.poId,
        vendorId: gr.vendorId,
        receivedById: gr.receivedById,
        status: gr.status,
        receivedDate: dateOr(gr.receivedDate),
        notes: gr.notes ?? null,
        // Seeded receipts represent already-completed deliveries, so they are posted.
        postedAt: dateOr(gr.receivedDate),
        createdAt: dateOr(gr.createdAt),
        items: {
          create: (gr.items ?? []).map((it) => {
            // Prefer the explicit link; fall back to matching by name for older
            // seed rows whose lineItemId does not resolve.
            const poLine =
              po?.lineItems.find((l) => l.id === it.lineItemId) ??
              po?.lineItems.find((l) => l.itemName === it.itemName);
            if (!poLine) {
              throw new Error(
                `Goods receipt ${gr.receiptNumber} references a line item that does not exist on ${gr.poId}: ${it.lineItemId}`
              );
            }
            return {
              poLineItemId: poLine.id,
              itemName: it.itemName,
              orderedQty: it.orderedQty,
              receivedQty: it.receivedQty,
              rejectedQty: it.condition === "MISSING" ? Math.max(0, it.orderedQty - it.receivedQty) : 0,
              unit: it.unit ?? "unit",
              condition: it.condition,
              notes: (it as { notes?: string }).notes ?? null,
            };
          }),
        },
      },
    });
  }

  // Roll the received quantities up onto the PO lines, so `orderedQty` vs
  // `receivedQty` is true of the data rather than merely modelled.
  const receiptTotals = await db.goodsReceiptItem.groupBy({
    by: ["poLineItemId"],
    _sum: { receivedQty: true, rejectedQty: true },
  });
  for (const row of receiptTotals) {
    await db.pOLineItem.update({
      where: { id: row.poLineItemId },
      data: {
        receivedQty: row._sum.receivedQty ?? 0,
        rejectedQty: row._sum.rejectedQty ?? 0,
      },
    });
  }
  console.log(`  goods receipts ${seed.seedGoodsReceipts.length}`);

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------
  for (const inv of seed.seedInvoices) {
    await db.invoice.create({
      data: {
        id: inv.id,
        organizationId: org.id,
        invoiceNumber: inv.invoiceNumber,
        vendorId: inv.vendorId,
        purchaseOrderId: inv.poId ?? null,
        goodsReceiptId: inv.goodsReceiptId ?? null,
        status: inv.status,
        issueDate: dateOr(inv.issueDate),
        dueDate: dateOr(inv.dueDate),
        subtotal: inv.subtotal ?? 0,
        taxAmount: inv.taxAmount ?? 0,
        totalAmount: inv.totalAmount ?? 0,
        paidAmount: inv.paidAmount ?? 0,
        balance: inv.balance ?? (inv.totalAmount ?? 0) - (inv.paidAmount ?? 0),
        currency: inv.currency ?? org.currency,
        // Matched where the invoice already carries both a PO and a receipt.
        matchStatus: inv.poId && inv.goodsReceiptId ? "MATCHED" : inv.poId ? "NO_RECEIPT" : "NO_PO",
        notes: inv.notes ?? null,
        approvedById: inv.approvedById ?? null,
        approvedAt: date(inv.approvedAt),
        createdAt: dateOr(inv.createdAt),
      },
    });
  }
  console.log(`  invoices ${seed.seedInvoices.length}`);

  // -------------------------------------------------------------------------
  // Payments
  //
  // The old payment model had a single undifferentiated `PENDING` state. The new
  // lifecycle splits that into an explicit finance approval gate followed by
  // scheduling, so a legacy PENDING payment maps to PENDING_APPROVAL — it has not
  // been approved by finance, which is exactly what the old state meant in practice.
  // -------------------------------------------------------------------------
  const LEGACY_PAYMENT_STATUS: Record<string, Prisma.PaymentCreateManyInput["status"]> = {
    PENDING: "PENDING_APPROVAL",
    PROCESSING: "PROCESSING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    REFUNDED: "REFUNDED",
  };

  await db.payment.createMany({
    data: seed.seedPayments.map((p) => ({
      id: p.id,
      organizationId: org.id,
      paymentNumber: p.paymentNumber,
      invoiceId: p.invoiceId,
      vendorId: p.vendorId,
      amount: p.amount,
      currency: p.currency ?? org.currency,
      method: p.method,
      status: LEGACY_PAYMENT_STATUS[p.status] ?? "DRAFT",
      paymentDate: date(p.paymentDate),
      reference: p.reference ?? null,
      notes: p.notes ?? null,
      processedById: p.processedById,
      // Completed seeded payments are treated as finance-approved and reconciled;
      // anything else stays ungated so the approval step is visible in the UI.
      approvedById: p.status === "COMPLETED" ? p.processedById : null,
      approvedAt: p.status === "COMPLETED" ? date(p.paymentDate) : null,
      reconciledAt: p.status === "COMPLETED" ? date(p.paymentDate) : null,
      createdAt: dateOr(p.createdAt),
    })),
  });
  console.log(`  payments ${seed.seedPayments.length}`);

  // -------------------------------------------------------------------------
  // Contracts
  // -------------------------------------------------------------------------
  for (const c of seed.seedContracts) {
    await db.contract.create({
      data: {
        id: c.id,
        organizationId: org.id,
        contractNumber: c.contractNumber,
        title: c.title,
        vendorId: c.vendorId,
        status: c.status,
        startDate: dateOr(c.startDate),
        endDate: dateOr(c.endDate),
        value: c.value ?? 0,
        currency: c.currency ?? org.currency,
        autoRenew: c.autoRenew ?? false,
        renewalNoticeDays: c.renewalNoticeDays ?? 30,
        slaTerms: c.slaTerms ?? null,
        description: c.description ?? null,
        tags: json(c.tags),
        version: (c.versions ?? []).length || 1,
        createdAt: dateOr(c.createdAt),
        updatedAt: dateOr(c.updatedAt),
        versions: {
          create: (c.versions ?? []).map((v) => ({
            version: v.version,
            reason: v.reason,
            modifiedById: v.modifiedBy,
            modifiedAt: dateOr(v.modifiedAt),
          })),
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------
  for (const a of seed.seedAssets) {
    await db.asset.create({
      data: {
        id: a.id,
        organizationId: org.id,
        assetTag: a.assetTag,
        name: a.name,
        category: a.category,
        serialNumber: a.serialNumber ?? null,
        purchaseOrderId: a.poId ?? null,
        vendorId: a.vendorId ?? null,
        assignedToId: a.assignedToId ?? null,
        departmentId: a.departmentId ?? null,
        branchId: a.branchId ?? null,
        location: a.location ?? null,
        status: a.status,
        purchaseDate: date(a.purchaseDate),
        purchaseValue: a.purchaseValue ?? 0,
        currentValue: a.currentValue ?? 0,
        currency: a.currency ?? org.currency,
        warrantyExpiry: date(a.warrantyExpiry),
        depreciationRate: a.depreciationRate ?? 0,
        qrCode: a.qrCode ?? null,
        notes: a.notes ?? null,
        createdAt: dateOr(a.createdAt),
        maintenanceRecords: {
          create: (a.maintenanceHistory ?? []).map((m) => ({
            type: m.type,
            description: m.description,
            cost: m.cost ?? 0,
            performedBy: m.performedBy ?? null,
            date: dateOr(m.date),
          })),
        },
        transfers: {
          create: (a.transfers ?? []).map((t) => ({
            fromUserId: t.fromUserId ?? null,
            toUserId: t.toUserId ?? null,
            fromLocation: t.fromLocation ?? null,
            toLocation: t.toLocation ?? null,
            reason: t.reason,
            date: dateOr(t.date),
          })),
        },
      },
    });
  }
  console.log(`  contracts ${seed.seedContracts.length} · assets ${seed.seedAssets.length}`);

  // -------------------------------------------------------------------------
  // Inventory + stock ledger
  // -------------------------------------------------------------------------
  for (const it of seed.seedInventory) {
    await db.inventoryItem.create({
      data: {
        id: it.id,
        organizationId: org.id,
        sku: it.sku,
        name: it.name,
        description: it.description ?? null,
        category: it.category ?? null,
        unit: it.unit ?? "unit",
        quantity: it.quantity ?? 0,
        reorderLevel: it.reorderLevel ?? 0,
        reorderQty: it.reorderQty ?? 0,
        unitCost: it.unitCost ?? 0,
        currency: it.currency ?? org.currency,
        location: it.location ?? null,
        binLocation: it.binLocation ?? null,
        lastRestockDate: date(it.lastRestockDate),
        supplierId: it.supplierId ?? null,
        createdAt: dateOr(it.createdAt),
        updatedAt: dateOr(it.updatedAt),
        movements: {
          create: (it.movements ?? []).map((mv) => ({
            type: mv.type,
            quantity: mv.quantity,
            balanceAfter: mv.balanceAfter,
            reference: mv.reference ?? null,
            notes: mv.notes ?? null,
            performedById: mv.performedById,
            createdAt: dateOr(mv.createdAt),
          })),
        },
      },
    });
  }
  console.log(`  inventory ${seed.seedInventory.length}`);

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  for (const d of seed.seedDocuments) {
    await db.documentRecord.create({
      data: {
        id: d.id,
        organizationId: org.id,
        name: d.name,
        category: d.category,
        description: d.description ?? null,
        tags: json(d.tags),
        linkedEntityType: d.linkedEntityType ?? null,
        linkedEntityId: d.linkedEntityId ?? null,
        currentVersion: d.currentVersion ?? 1,
        uploadedById: d.uploadedById,
        createdAt: dateOr(d.createdAt),
        updatedAt: dateOr(d.updatedAt),
        versions: {
          create: (d.versions ?? []).map((v) => ({
            version: v.version,
            sizeLabel: v.size ?? null,
            uploadedById: v.uploadedBy,
            uploadedAt: dateOr(v.uploadedAt),
          })),
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Supplier portal accounts
  //
  // Seeded suppliers get the same demo password so the portal is explorable.
  // PENDING accounts intentionally have no password — they must go through
  // invitation activation, which is the real flow.
  // -------------------------------------------------------------------------
  for (const su of seed.seedSupplierPortalUsers) {
    await db.supplierUser.create({
      data: {
        id: su.id,
        organizationId: org.id,
        vendorId: su.vendorId,
        email: su.email.toLowerCase(),
        contactName: su.contactName,
        accessStatus: su.accessStatus,
        passwordHash: su.accessStatus === "ACTIVE" ? passwordHash : null,
        lastLoginAt: date(su.lastLoginAt),
        createdAt: dateOr(su.createdAt),
      },
    });
  }

  await db.supplierActivity.createMany({
    data: seed.seedSupplierActivities.map((sa) => ({
      id: sa.id,
      vendorId: sa.vendorId,
      type: sa.type,
      description: sa.description,
      referenceId: sa.referenceId ?? null,
      createdAt: dateOr(sa.createdAt),
    })),
  });
  console.log(`  supplier accounts ${seed.seedSupplierPortalUsers.length}`);

  // -------------------------------------------------------------------------
  // Integrations
  //
  // Only non-secret settings are seeded, into `publicConfig`. `encryptedConfig`
  // stays null: no integration in the seed holds real credentials, and none of
  // them actually connect to anything.
  // -------------------------------------------------------------------------
  for (const ig of seed.seedIntegrations) {
    await db.integration.create({
      data: {
        id: ig.id,
        organizationId: org.id,
        type: ig.type,
        name: ig.name,
        status: ig.status,
        healthStatus: ig.healthStatus ?? "UNKNOWN",
        syncFrequency: ig.syncFrequency ?? "MANUAL",
        publicConfig: json(ig.config),
        enabledEvents: json(ig.enabledEvents),
        lastSyncAt: date(ig.lastSyncAt),
        lastSyncStatus: ig.lastSyncStatus ?? null,
        configuredById: ig.configuredBy ?? null,
        configuredAt: date(ig.configuredAt),
        logs: {
          create: (ig.logs ?? []).map((l) => ({
            event: l.event,
            status: l.status,
            message: l.message ?? null,
            durationMs: l.duration ?? null,
            createdAt: dateOr(l.timestamp),
          })),
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Activity, notifications, audit
  // -------------------------------------------------------------------------
  await db.activityLog.createMany({
    data: seed.seedActivities.map((a) => ({
      id: a.id,
      organizationId: org.id,
      userId: a.userId ?? null,
      requestId: a.requestId ?? null,
      purchaseOrderId: a.purchaseOrderId ?? null,
      rfqId: a.rfqId ?? null,
      vendorId: a.vendorId ?? null,
      eventType: a.eventType,
      description: a.description,
      severity: a.severity ?? "INFO",
      ipAddress: a.ipAddress ?? null,
      userAgent: a.userAgent ?? null,
      createdAt: dateOr(a.createdAt),
    })),
  });

  await db.notification.createMany({
    data: seed.seedNotifications.map((n) => ({
      id: n.id,
      organizationId: org.id,
      userId: n.userId,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.read,
      link: n.link ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      createdAt: dateOr(n.createdAt),
    })),
  });

  await db.auditLogEntry.createMany({
    data: seed.seedAuditLogs.map((a) => ({
      id: a.id,
      organizationId: org.id,
      userId: a.userId,
      action: a.action,
      resource: a.resource,
      resourceId: a.resourceId ?? null,
      before: json(a.before),
      after: json(a.after),
      ipAddress: a.ipAddress ?? null,
      userAgent: a.userAgent ?? null,
      createdAt: dateOr(a.timestamp),
    })),
  });
  console.log(
    `  activity ${seed.seedActivities.length} · notifications ${seed.seedNotifications.length} · audit ${seed.seedAuditLogs.length}`
  );

  // -------------------------------------------------------------------------
  // Align document counters with the seeded numbers, so the next created record
  // continues the sequence instead of colliding with PR-2026-0001.
  // -------------------------------------------------------------------------
  const highest = (numbers: string[]) =>
    numbers.reduce((max, n) => Math.max(max, Number(n.match(/-(\d+)$/)?.[1] ?? 0)), 0);

  const sequences: Array<[string, number]> = [
    ["PR", highest(seed.seedRequests.map((r) => r.requestNumber))],
    ["RFQ", highest(seed.seedRFQs.map((r) => r.rfqNumber))],
    ["PO", highest(seed.seedPurchaseOrders.map((p) => p.poNumber))],
    ["GRN", highest(seed.seedGoodsReceipts.map((g) => g.receiptNumber))],
    ["INV", highest(seed.seedInvoices.map((i) => i.invoiceNumber))],
    ["PAY", highest(seed.seedPayments.map((p) => p.paymentNumber))],
    ["CTR", highest(seed.seedContracts.map((c) => c.contractNumber))],
    ["AST", highest(seed.seedAssets.map((a) => a.assetTag))],
  ];

  const period = String(new Date().getFullYear());
  for (const [prefix, lastValue] of sequences) {
    await db.documentSequence.create({
      data: { organizationId: org.id, prefix, period, lastValue },
    });
  }

  console.log("\nSeed complete.");
  console.log(`  Sign in at http://localhost:3000`);
  console.log(`  Email:    ${seed.seedUsers[0].email}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  (every seeded account shares this development password)`);
}

main()
  .catch((e) => {
    console.error("\nSeed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

