// NextMav Procure — vendor and supplier service.
//
// Before this file, vendors were the one module in the platform that was *read*
// from the database and *written* to browser memory: `createVendor`,
// `blacklistVendor` and friends in `src/lib/store.ts` mutated a Zustand array and
// nothing else. A supplier added through the UI survived until the next refresh.
//
// Everything a vendor can have done to it now goes through here, which means:
//
//   · every mutation is authorized server-side against the permission catalog;
//   · every status change goes through `VENDOR_TRANSITIONS`, so a prospect cannot
//     become active without being approved;
//   · approval uses the same configurable engine as purchase requests — the
//     workflow rows decide who reviews a supplier, not this file;
//   · compliance is derived from evidence, never asserted;
//   · every change lands in the audit log and, where someone needs to know,
//     the outbox.
//
// Two things are deliberately *not* here. Vendor performance figures are computed
// from receipts, invoices and payments by the scorecard path — nothing in this
// service lets a user type an on-time-delivery rate in. And risk scores are
// recorded assessments with an author and a date, not a number this file invents.

import type { Prisma, VendorComplianceStatus, VendorStatus } from "@prisma/client";
import { db, type Tx } from "../db";
import type { Numeric } from "../db";
import { conflict, forbidden, notFound, validation } from "../errors";
import { assertPermission, can } from "../permissions";
import { recordAudit, recordActivity, diff } from "../audit";
import { emit } from "../engines/events";
import * as workflow from "../engines/workflow";
import { enqueue } from "../engines/outbox";
import { nextStates, transition } from "../state-machine";
import { assertSameOrg } from "../tenancy";
import { orderBy, paginate, scoped, type Page, type ServiceContext } from "./context";
import type {
  createVendorSchema,
  updateVendorSchema,
  vendorListQuerySchema,
  vendorContactSchema,
  updateVendorContactSchema,
  vendorCategoriesSchema,
  vendorDocumentSchema,
  verifyDocumentSchema,
  complianceRequirementSchema,
  updateComplianceRequirementSchema,
  complianceDecisionSchema,
  vendorDecisionSchema,
  vendorActionSchema,
  vendorRiskSchema,
  vendorNoteSchema,
  duplicateCheckSchema,
} from "@/lib/schemas/procurement";
import type { z } from "zod";

type CreateInput = z.infer<typeof createVendorSchema>;
type UpdateInput = z.infer<typeof updateVendorSchema>;
type ListInput = z.infer<typeof vendorListQuerySchema>;
type ContactInput = z.infer<typeof vendorContactSchema>;
type ContactUpdateInput = z.infer<typeof updateVendorContactSchema>;
type CategoriesInput = z.infer<typeof vendorCategoriesSchema>;
type DocumentInput = z.infer<typeof vendorDocumentSchema>;
type VerifyDocInput = z.infer<typeof verifyDocumentSchema>;
type RequirementInput = z.infer<typeof complianceRequirementSchema>;
type RequirementUpdateInput = z.infer<typeof updateComplianceRequirementSchema>;
type ComplianceDecisionInput = z.infer<typeof complianceDecisionSchema>;
type DecisionInput = z.infer<typeof vendorDecisionSchema>;
type ActionInput = z.infer<typeof vendorActionSchema>;
type RiskInput = z.infer<typeof vendorRiskSchema>;
type NoteInput = z.infer<typeof vendorNoteSchema>;
type DuplicateInput = z.infer<typeof duplicateCheckSchema>;

const SORTABLE = [
  "companyName",
  "createdAt",
  "updatedAt",
  "status",
  "totalValue",
  "totalOrders",
  "rating",
  "riskScore",
  "onboardedAt",
] as const;

/** A document or certificate inside this window is flagged as lapsing soon. */
export const EXPIRY_WARNING_DAYS = 30;

/** Statuses in which a vendor may be edited without a re-approval. */
const EDITABLE_STATUSES: VendorStatus[] = [
  "PROSPECTIVE",
  "INVITED",
  "ONBOARDING",
  "UNDER_REVIEW",
  "REJECTED",
];

/** Statuses that permit new procurement activity against the vendor. */
export const TRADEABLE_STATUSES: VendorStatus[] = ["ACTIVE", "APPROVED"];

/**
 * Refuses new business with a supplier the organization is not currently trading
 * with.
 *
 * Before the lifecycle existed, each downstream service checked
 * `status === "BLACKLISTED"` on its own, which is why a suspended vendor could
 * still be sent a purchase order — exactly the thing suspension is for. This is
 * the single place that decides, so a new state cannot be added to the lifecycle
 * without every downstream module honouring it.
 *
 * It gates *new* commitments only. Receiving goods already ordered, paying an
 * invoice already approved, and closing out existing paperwork all stay possible
 * with a suspended supplier — stopping them would strand work in progress rather
 * than prevent new exposure.
 */
export function assertTradeable(
  vendor: { companyName: string; status: VendorStatus },
  action: string
): void {
  if (TRADEABLE_STATUSES.includes(vendor.status)) return;

  const because: Partial<Record<VendorStatus, string>> = {
    BLACKLISTED: "is blacklisted",
    SUSPENDED: "is suspended",
    ARCHIVED: "has been archived",
    INACTIVE: "is inactive",
    REJECTED: "was rejected during onboarding",
    PROSPECTIVE: "has not been onboarded yet",
    INVITED: "has not completed onboarding",
    ONBOARDING: "is still onboarding",
    UNDER_REVIEW: "is still under review",
    PENDING_APPROVAL: "is awaiting onboarding approval",
  };

  throw conflict(
    `${vendor.companyName} ${because[vendor.status] ?? "is not approved for trading"} — ${action}`,
    { vendorStatus: vendor.status }
  );
}

const vendorInclude = {
  contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
  documents: { orderBy: { uploadedAt: "desc" } },
  complianceRequirements: { orderBy: [{ isMandatory: "desc" }, { name: "asc" }] },
  categoryLinks: { include: { category: { select: { id: true, code: true, name: true } } } },
  riskAssessments: { orderBy: { assessedAt: "desc" }, take: 10 },
  performanceSnapshots: { orderBy: { periodEnd: "desc" }, take: 12 },
  createdBy: { select: { id: true, name: true, initials: true, avatarColor: true } },
  approvedBy: { select: { id: true, name: true, initials: true, avatarColor: true } },
  portalUsers: {
    select: { id: true, email: true, contactName: true, accessStatus: true, lastLoginAt: true },
  },
} satisfies Prisma.VendorInclude;

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

const dayMs = 86_400_000;

/** Whole days until a date; negative once it has passed. Null dates never expire. */
export function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / dayMs);
}

/**
 * A document's presentational status.
 *
 * Verification and expiry are two different facts about a document, and the
 * single `ComplianceDocStatus` column has to carry both. Verification wins while
 * it is outstanding — an unverified certificate is PENDING_REVIEW whatever its
 * dates say — and expiry takes over once someone has actually checked it.
 */
export function documentStatus(doc: {
  verifiedAt: Date | null;
  rejectedReason: string | null;
  expiresAt: Date | null;
}): "VALID" | "EXPIRING" | "EXPIRED" | "PENDING_REVIEW" {
  if (doc.rejectedReason) return "PENDING_REVIEW";
  if (!doc.verifiedAt) return "PENDING_REVIEW";
  const days = daysUntil(doc.expiresAt);
  if (days === null) return "VALID";
  if (days < 0) return "EXPIRED";
  if (days <= EXPIRY_WARNING_DAYS) return "EXPIRING";
  return "VALID";
}

interface RequirementFacts {
  status: VendorComplianceStatus;
  isMandatory: boolean;
  expiresAt: Date | null;
}

/**
 * The vendor's overall compliance state, computed from its requirements.
 *
 * §14: this is never a field a user sets. The precedence below is deliberate —
 * a lapsed mandatory certificate outranks a pile of verified ones, because the
 * question the state answers is "may we trade with them today", not "how much
 * paperwork have they sent us".
 */
export function deriveComplianceState(reqs: RequirementFacts[]): {
  state: Prisma.VendorUpdateInput["complianceState"];
  score: number;
} {
  if (reqs.length === 0) return { state: "NOT_STARTED", score: 0 };

  const mandatory = reqs.filter((r) => r.isMandatory);
  const scored = mandatory.length > 0 ? mandatory : reqs;

  const isSatisfied = (r: RequirementFacts) => {
    if (r.status === "WAIVED") return true;
    if (r.status !== "VERIFIED") return false;
    const days = daysUntil(r.expiresAt);
    return days === null || days >= 0;
  };

  const satisfied = scored.filter(isSatisfied).length;
  const score = Math.round((satisfied / scored.length) * 100);

  const lapsed = scored.some(
    (r) =>
      r.status === "EXPIRED" ||
      (r.status === "VERIFIED" && (daysUntil(r.expiresAt) ?? 1) < 0)
  );
  if (lapsed) return { state: "EXPIRED", score };

  if (scored.some((r) => r.status === "REJECTED")) return { state: "NON_COMPLIANT", score };

  if (satisfied === scored.length) return { state: "COMPLIANT", score };

  if (scored.some((r) => r.status === "UNDER_REVIEW" || r.status === "SUBMITTED")) {
    return { state: "UNDER_REVIEW", score };
  }

  if (satisfied > 0) return { state: "PARTIALLY_COMPLIANT", score };

  const started = scored.some((r) => r.status !== "NOT_STARTED");
  return { state: started ? "IN_PROGRESS" : "NOT_STARTED", score };
}

/**
 * Recomputes and persists a vendor's compliance state.
 *
 * Called after anything that can change the evidence — a requirement decided, a
 * document verified, a requirement added or removed — so the column stays a
 * faithful summary of the rows rather than drifting from them.
 */
async function refreshCompliance(
  tx: Tx,
  vendorId: string
): Promise<{ state: string; score: number }> {
  const reqs = await tx.vendorComplianceRequirement.findMany({
    where: { vendorId },
    select: { status: true, isMandatory: true, expiresAt: true },
  });
  const { state, score } = deriveComplianceState(reqs);
  await tx.vendor.update({
    where: { id: vendorId },
    data: { complianceState: state, complianceScore: score },
  });
  return { state: state as string, score };
}

/** Normalises a company name for comparison: case, punctuation and suffixes. */
function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,'"()]/g, "")
    .replace(
      /\b(ltd|limited|plc|inc|incorporated|llc|gmbh|co|company|corp|corporation|enterprises|nigeria|nig)\b/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

// `Numeric<>` because the client extension in decimal-fields.ts hands back
// numbers where Prisma's generated payload type still says Decimal.
type VendorRow = Numeric<Prisma.VendorGetPayload<{ include: typeof vendorInclude }>>;

const iso = (d: Date | null | undefined) => d?.toISOString();

/**
 * Shapes a vendor for the client.
 *
 * Bank details are projected only for callers who manage vendors — the same rule
 * the bootstrap projection already applies, restated here because this endpoint
 * is a second door onto the same record.
 */
function project(v: VendorRow, opts: { bankDetails: boolean; restrictedNotes: boolean }) {
  return {
    id: v.id,
    organizationId: v.organizationId,
    companyName: v.companyName,
    legalName: v.legalName ?? undefined,
    tradingName: v.tradingName ?? undefined,
    vendorType: v.vendorType,
    description: v.description ?? undefined,
    contactPerson: v.contactPerson ?? "",
    email: v.email ?? "",
    phone: v.phone ?? "",
    address: v.address ?? "",
    city: v.city ?? undefined,
    stateRegion: v.stateRegion ?? undefined,
    postalCode: v.postalCode ?? undefined,
    country: v.country ?? undefined,
    category: v.category ?? "",
    taxNumber: v.taxNumber ?? "",
    registrationNumber: v.registrationNumber ?? undefined,
    businessClassification: v.businessClassification ?? undefined,
    businessSize: v.businessSize ?? undefined,
    incorporatedOn: iso(v.incorporatedOn),
    website: v.website ?? undefined,
    code: v.code ?? undefined,
    leadTimeDays: v.leadTimeDays ?? undefined,
    minimumOrderValue: v.minimumOrderValue ?? undefined,
    bankName: opts.bankDetails ? (v.bankName ?? "") : "",
    bankAccount: opts.bankDetails ? (v.bankAccount ?? "") : "",
    paymentTerms: v.paymentTerms,
    preferredCurrency: v.preferredCurrency,
    status: v.status,
    isPreferred: v.isPreferred,
    complianceState: v.complianceState,
    complianceScore: v.complianceScore,
    riskLevel: v.riskLevel,
    riskScore: v.riskScore ?? undefined,
    riskStatus: v.riskStatus,
    riskReviewedAt: iso(v.riskReviewedAt),
    riskNextReviewAt: iso(v.riskNextReviewAt),
    rating: v.rating,
    totalOrders: v.totalOrders,
    totalValue: v.totalValue,
    onTimeDeliveryRate: v.onTimeDeliveryRate,
    qualityRating: v.qualityRating,
    performanceUpdatedAt: iso(v.performanceUpdatedAt),
    onboardedAt: iso(v.onboardedAt),
    invitedAt: iso(v.invitedAt),
    onboardingStartedAt: iso(v.onboardingStartedAt),
    submittedForReviewAt: iso(v.submittedForReviewAt),
    approvedAt: iso(v.approvedAt),
    approvedById: v.approvedById ?? undefined,
    rejectedAt: iso(v.rejectedAt),
    rejectedReason: v.rejectedReason ?? undefined,
    activatedAt: iso(v.activatedAt),
    deactivatedAt: iso(v.deactivatedAt),
    deactivatedReason: v.deactivatedReason ?? undefined,
    archivedAt: iso(v.archivedAt),
    suspendedAt: iso(v.suspendedAt),
    suspendedReason: v.suspendedReason ?? undefined,
    blacklistedAt: iso(v.blacklistedAt),
    blacklistedReason: v.blacklistedReason ?? undefined,
    createdById: v.createdById ?? undefined,
    createdBy: v.createdBy ?? undefined,
    tags: parseTags(v.tags),
    notes: v.notes ?? "",
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),

    contacts: v.contacts.map((c) => ({
      id: c.id,
      vendorId: c.vendorId,
      name: c.name,
      email: c.email ?? undefined,
      phone: c.phone ?? undefined,
      jobTitle: c.jobTitle ?? undefined,
      department: c.department ?? undefined,
      type: c.type,
      isPrimary: c.isPrimary,
      isActive: c.isActive,
      notes: c.notes ?? undefined,
      createdAt: c.createdAt.toISOString(),
    })),

    categories: v.categoryLinks.map((l) => ({
      id: l.id,
      vendorId: l.vendorId,
      categoryId: l.categoryId,
      categoryName: l.category.name,
      categoryCode: l.category.code,
      isPreferred: l.isPreferred,
    })),

    documents: v.documents.map((d) => ({
      id: d.id,
      vendorId: d.vendorId,
      type: d.type,
      name: d.name,
      fileName: d.name,
      fileSize: "—",
      documentNumber: d.documentNumber ?? undefined,
      issuedAt: iso(d.issuedAt),
      uploadedAt: d.uploadedAt.toISOString(),
      expiresAt: iso(d.expiresAt),
      status: documentStatus(d),
      version: d.version,
      uploadedById: d.uploadedById ?? undefined,
      verifiedById: d.verifiedById ?? undefined,
      verifiedAt: iso(d.verifiedAt),
      rejectedReason: d.rejectedReason ?? undefined,
      notes: d.notes ?? undefined,
      daysToExpiry: daysUntil(d.expiresAt) ?? undefined,
    })),

    compliance: v.complianceRequirements.map((r) => ({
      id: r.id,
      vendorId: r.vendorId,
      type: r.type,
      name: r.name,
      description: r.description ?? undefined,
      status: r.status,
      isMandatory: r.isMandatory,
      documentId: r.documentId ?? undefined,
      documentName: v.documents.find((d) => d.id === r.documentId)?.name,
      expiresAt: iso(r.expiresAt),
      submittedAt: iso(r.submittedAt),
      reviewedAt: iso(r.reviewedAt),
      reviewedById: r.reviewedById ?? undefined,
      reviewNotes: r.reviewNotes ?? undefined,
      waivedById: r.waivedById ?? undefined,
      waivedReason: r.waivedReason ?? undefined,
      daysToExpiry: daysUntil(r.expiresAt) ?? undefined,
      createdAt: r.createdAt.toISOString(),
    })),

    riskAssessments: v.riskAssessments.map((a) => ({
      id: a.id,
      vendorId: a.vendorId,
      level: a.level,
      score: a.score,
      factors: (a.factors as Record<string, number> | null) ?? undefined,
      summary: a.summary ?? undefined,
      assessedById: a.assessedById ?? undefined,
      assessedAt: a.assessedAt.toISOString(),
      nextReviewAt: iso(a.nextReviewAt),
    })),

    performance: v.performanceSnapshots.map((p) => ({
      id: p.id,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      ordersCount: p.ordersCount,
      receiptsCount: p.receiptsCount,
      onTimeRate: p.onTimeRate,
      qualityRate: p.qualityRate,
      complianceScore: p.complianceScore,
      disputeCount: p.disputeCount,
      totalSpend: p.totalSpend,
      computedAt: p.computedAt.toISOString(),
    })),

    portalUsers: v.portalUsers.map((u) => ({
      id: u.id,
      vendorId: v.id,
      email: u.email,
      contactName: u.contactName,
      accessStatus: u.accessStatus,
      lastLoginAt: iso(u.lastLoginAt),
    })),
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** Trims an optional form field down to null, so "" never reaches the column. */
const orNull = (v: string | undefined | null) => {
  const t = v?.trim();
  return t ? t : null;
};
const orDate = (v: string | undefined | null) => {
  const t = v?.trim();
  return t ? new Date(t) : null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(ctx: ServiceContext, q: ListInput): Promise<Page<unknown>> {
  await assertPermission(ctx.principal, "vendors.view");
  const tdb = scoped(ctx);
  const bankDetails = await can(ctx.principal, "vendors.edit");

  const where: Prisma.VendorWhereInput = {};

  if (q.status && q.status !== "ALL") {
    where.status = { in: q.status.split(",") as VendorStatus[] };
  }
  if (q.compliance && q.compliance !== "ALL") {
    where.complianceState = {
      in: q.compliance.split(",") as Prisma.EnumVendorComplianceStateFilter["in"],
    };
  }
  if (q.risk && q.risk !== "ALL") {
    where.riskLevel = { in: q.risk.split(",") as Prisma.EnumVendorRiskLevelFilter["in"] };
  }
  if (q.vendorType && q.vendorType !== "ALL") {
    where.vendorType = { in: q.vendorType.split(",") as Prisma.EnumVendorTypeFilter["in"] };
  }
  if (q.country && q.country !== "ALL") where.country = q.country;
  if (q.categoryId && q.categoryId !== "ALL") {
    where.categoryLinks = { some: { categoryId: q.categoryId } };
  }
  if (q.preferred) where.isPreferred = q.preferred === "true";
  if (q.expiringWithinDays !== undefined) {
    const cutoff = new Date(Date.now() + q.expiringWithinDays * dayMs);
    where.OR = [
      { documents: { some: { expiresAt: { lte: cutoff } } } },
      { complianceRequirements: { some: { expiresAt: { lte: cutoff } } } },
    ];
  }
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    };
  }

  // Search runs in the database, not over a payload the browser already holds.
  // §24: the directory has to stay usable when an organization has thousands of
  // suppliers, and the previous implementation filtered an in-memory array.
  if (q.search) {
    const term = q.search;
    const match = { contains: term, mode: "insensitive" as const };
    const searchClauses: Prisma.VendorWhereInput[] = [
      { companyName: match },
      { legalName: match },
      { tradingName: match },
      { code: match },
      { email: match },
      { taxNumber: match },
      { registrationNumber: match },
      { category: match },
      { contacts: { some: { OR: [{ name: match }, { email: match }] } } },
      { categoryLinks: { some: { category: { name: match } } } },
    ];
    // Combined with AND so a search never widens an active filter.
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: searchClauses }];
  }

  const [total, items] = await Promise.all([
    tdb.vendor.count({ where }),
    tdb.vendor.findMany({
      where,
      orderBy: orderBy(q.sort, q.dir, SORTABLE, "companyName"),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: vendorInclude,
    }),
  ]);

  return paginate(
    items.map((v) => project(v, { bankDetails, restrictedNotes: false })),
    total,
    q.page,
    q.pageSize
  );
}

export async function getById(ctx: ServiceContext, id: string) {
  await assertPermission(ctx.principal, "vendors.view");

  const vendor = await scoped(ctx).vendor.findUnique({ where: { id }, include: vendorInclude });
  if (!vendor) throw notFound("Vendor not found");

  const bankDetails = await can(ctx.principal, "vendors.edit");
  const canApprove = await can(ctx.principal, "vendors.approve");

  const [approvals, activity, notes, procurement] = await Promise.all([
    approvalHistory(ctx, id),
    activityFor(ctx, id),
    listNotes(ctx, id, canApprove),
    procurementHistory(ctx, id),
  ]);

  return {
    ...project(vendor, { bankDetails, restrictedNotes: canApprove }),
    approvals,
    activity,
    internalNotes: notes,
    procurement,
    availableActions: await availableActions(ctx, vendor),
  };
}

/** Every approval instance ever raised over this vendor, newest first. */
async function approvalHistory(ctx: ServiceContext, vendorId: string) {
  const instances = await scoped(ctx).approvalInstance.findMany({
    where: { entityType: "VENDOR", entityId: vendorId },
    include: {
      steps: { orderBy: { sequence: "asc" } },
      workflow: { select: { id: true, name: true, version: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  return instances.map((i) => ({
    id: i.id,
    status: i.status,
    workflowId: i.workflowId ?? undefined,
    workflowName: i.workflow?.name,
    startedAt: i.startedAt.toISOString(),
    completedAt: iso(i.completedAt),
    outcomeReason: i.outcomeReason ?? undefined,
    steps: i.steps.map((s) => ({
      id: s.id,
      stage: s.stage,
      sequence: s.sequence,
      approverId: s.approverId,
      approverRole: s.approverRole,
      decision: s.decision,
      comment: s.comment ?? undefined,
      decidedAt: iso(s.decidedAt),
      slaExpiresAt: iso(s.slaExpiresAt),
      delegatedToId: s.delegatedToId ?? undefined,
    })),
  }));
}

/** The vendor's timeline, read from the platform's existing activity log. */
async function activityFor(ctx: ServiceContext, vendorId: string) {
  const rows = await scoped(ctx).activityLog.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((a) => ({
    id: a.id,
    eventType: a.eventType,
    description: a.description,
    severity: a.severity,
    userId: a.userId ?? undefined,
    createdAt: a.createdAt.toISOString(),
  }));
}

/**
 * What this vendor has actually cost and delivered.
 *
 * Counts and sums only — the later phases own RFQ, PO and invoice detail. Where
 * nothing exists the numbers are zero, which is the truth, rather than a
 * fabricated history that makes the profile look furnished.
 */
async function procurementHistory(ctx: ServiceContext, vendorId: string) {
  const organizationId = ctx.principal.organizationId;

  // One statement, deliberately.
  //
  // This was seven `count`/`aggregate` calls in a `Promise.all`, which reads
  // nicely and behaves badly: the application connects through Supabase's
  // *transaction-mode* pooler, where every concurrent query holds its own pooled
  // connection for its duration. Seven at once from this function — alongside the
  // three other parallel reads in `getById` — meant a single vendor profile
  // claimed ten connections, and under load the pooler answered P1001
  // "can't reach database server" rather than queueing. It surfaced as a 500 on a
  // request whose write had already committed, which is the worst shape of
  // failure: the work was done and the user was told it was not.
  //
  // Scalar subqueries give the same figures in one round trip on one connection.
  //
  // Raw SQL bypasses the tenant extension, so `organizationId` is bound
  // explicitly on every subquery rather than relying on the vendor id alone.
  const [row] = await db.$queryRaw<
    {
      rfqs: number;
      orders: number;
      invoices: number;
      payments: number;
      contracts: number;
      ordered_value: number;
      invoiced_value: number;
    }[]
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "RFQVendor" rv
         JOIN "RFQ" r ON r.id = rv."rfqId"
        WHERE rv."vendorId" = ${vendorId} AND r."organizationId" = ${organizationId}) AS rfqs,
      (SELECT COUNT(*)::int FROM "PurchaseOrder"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS orders,
      (SELECT COUNT(*)::int FROM "Invoice"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS invoices,
      (SELECT COUNT(*)::int FROM "Payment"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS payments,
      (SELECT COUNT(*)::int FROM "Contract"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS contracts,
      -- Display aggregates. The exact ledger lives in the numeric columns these
      -- sum; float8 here is a headline figure, never a figure anything is posted from.
      (SELECT COALESCE(SUM("totalAmount"), 0)::float8 FROM "PurchaseOrder"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS ordered_value,
      (SELECT COALESCE(SUM("totalAmount"), 0)::float8 FROM "Invoice"
        WHERE "vendorId" = ${vendorId} AND "organizationId" = ${organizationId}) AS invoiced_value
  `;

  return {
    rfqs: row?.rfqs ?? 0,
    purchaseOrders: row?.orders ?? 0,
    invoices: row?.invoices ?? 0,
    payments: row?.payments ?? 0,
    contracts: row?.contracts ?? 0,
    orderedValue: row?.ordered_value ?? 0,
    invoicedValue: row?.invoiced_value ?? 0,
  };
}

/**
 * The lifecycle actions this caller may take on this vendor right now.
 *
 * The UI renders buttons from this rather than from its own copy of the rules, so
 * an action can never appear that the service would refuse. It is an affordance,
 * not the control: every action re-checks permission and transition when invoked.
 */
async function availableActions(
  ctx: ServiceContext,
  vendor: { status: VendorStatus; isPreferred: boolean }
): Promise<string[]> {
  const [edit, approve, suspend, archive, compliance, risk] = await Promise.all([
    can(ctx.principal, "vendors.edit"),
    can(ctx.principal, "vendors.approve"),
    can(ctx.principal, "vendors.suspend"),
    can(ctx.principal, "vendors.archive"),
    can(ctx.principal, "vendors.compliance"),
    can(ctx.principal, "vendors.risk"),
  ]);

  const allowed = (to: VendorStatus) => nextStates("vendor", vendor.status).includes(to);
  const actions: string[] = [];

  if (edit && EDITABLE_STATUSES.includes(vendor.status)) actions.push("EDIT");
  if (edit && allowed("INVITED")) actions.push("INVITE");
  if (edit && allowed("ONBOARDING")) actions.push("START_ONBOARDING");
  if (edit && (vendor.status === "ONBOARDING" || vendor.status === "PROSPECTIVE")) {
    actions.push("SUBMIT_FOR_REVIEW");
  }
  if (approve && vendor.status === "APPROVED") actions.push("ACTIVATE");
  if (suspend && allowed("SUSPENDED")) actions.push("SUSPEND");
  if (suspend && vendor.status === "SUSPENDED") actions.push("REACTIVATE");
  if (suspend && allowed("INACTIVE") && vendor.status !== "SUSPENDED") actions.push("DEACTIVATE");
  if (suspend && vendor.status === "INACTIVE") actions.push("REACTIVATE");
  if (archive && allowed("ARCHIVED")) actions.push("ARCHIVE");
  if (archive && vendor.status === "ARCHIVED") actions.push("RESTORE");
  if (archive && allowed("BLACKLISTED")) actions.push("BLACKLIST");
  if (archive && vendor.status === "BLACKLISTED") actions.push("LIFT_BLACKLIST");
  if (edit) actions.push(vendor.isPreferred ? "CLEAR_PREFERRED" : "SET_PREFERRED");
  if (compliance) actions.push("MANAGE_COMPLIANCE");
  if (risk) actions.push("ASSESS_RISK");

  return actions;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  id: string;
  companyName: string;
  legalName?: string;
  status: VendorStatus;
  code?: string;
  /** Which field matched, strongest first. */
  reason: string;
  confidence: "HIGH" | "MEDIUM";
}

/**
 * Finds vendors that may already be this company.
 *
 * §25: identifiers are decisive, names are suggestive. A matching tax or
 * registration number is the same legal entity and is reported HIGH; a similar
 * trading name is reported MEDIUM, because "Adeola Engineering Ltd" and "Adeola
 * Engineering Services Ltd" are frequently two real, distinct businesses. Nothing
 * here merges or blocks on its own — it reports, and an authorised user decides.
 */
export async function findDuplicates(
  ctx: ServiceContext,
  input: DuplicateInput
): Promise<DuplicateMatch[]> {
  await assertPermission(ctx.principal, "vendors.view");
  const tdb = scoped(ctx);

  const identifiers: Prisma.VendorWhereInput[] = [];
  if (input.taxNumber?.trim()) identifiers.push({ taxNumber: { equals: input.taxNumber.trim(), mode: "insensitive" } });
  if (input.registrationNumber?.trim()) {
    identifiers.push({ registrationNumber: { equals: input.registrationNumber.trim(), mode: "insensitive" } });
  }
  if (input.email?.trim()) identifiers.push({ email: { equals: input.email.trim(), mode: "insensitive" } });

  const nameSeed = (input.companyName ?? input.legalName ?? "").trim();
  const nameClauses: Prisma.VendorWhereInput[] = [];
  if (nameSeed.length >= 3) {
    // The first significant word is a cheap, index-friendly prefilter; the precise
    // comparison happens below on the normalised form.
    const head = normaliseName(nameSeed).split(" ")[0];
    if (head && head.length >= 3) {
      nameClauses.push({ companyName: { contains: head, mode: "insensitive" } });
      nameClauses.push({ legalName: { contains: head, mode: "insensitive" } });
      nameClauses.push({ tradingName: { contains: head, mode: "insensitive" } });
    }
  }

  if (identifiers.length === 0 && nameClauses.length === 0) return [];

  const candidates = await tdb.vendor.findMany({
    where: {
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      OR: [...identifiers, ...nameClauses],
    },
    select: {
      id: true,
      companyName: true,
      legalName: true,
      tradingName: true,
      taxNumber: true,
      registrationNumber: true,
      email: true,
      status: true,
      code: true,
    },
    take: 25,
  });

  const wantedName = normaliseName(nameSeed);
  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    const base = {
      id: c.id,
      companyName: c.companyName,
      legalName: c.legalName ?? undefined,
      status: c.status,
      code: c.code ?? undefined,
    };

    if (input.taxNumber?.trim() && c.taxNumber?.trim().toLowerCase() === input.taxNumber.trim().toLowerCase()) {
      matches.push({ ...base, reason: `Same tax identification number (${c.taxNumber})`, confidence: "HIGH" });
      continue;
    }
    if (
      input.registrationNumber?.trim() &&
      c.registrationNumber?.trim().toLowerCase() === input.registrationNumber.trim().toLowerCase()
    ) {
      matches.push({
        ...base,
        reason: `Same company registration number (${c.registrationNumber})`,
        confidence: "HIGH",
      });
      continue;
    }
    if (input.email?.trim() && c.email?.trim().toLowerCase() === input.email.trim().toLowerCase()) {
      matches.push({ ...base, reason: `Same contact email (${c.email})`, confidence: "HIGH" });
      continue;
    }

    if (wantedName.length >= 3) {
      const names = [c.companyName, c.legalName, c.tradingName]
        .filter((n): n is string => Boolean(n))
        .map(normaliseName);
      if (names.some((n) => n === wantedName)) {
        matches.push({ ...base, reason: "Same company name", confidence: "HIGH" });
        continue;
      }
      if (names.some((n) => n.includes(wantedName) || wantedName.includes(n))) {
        matches.push({ ...base, reason: `Similar name to "${c.companyName}"`, confidence: "MEDIUM" });
      }
    }
  }

  return matches.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "HIGH" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function create(ctx: ServiceContext, input: CreateInput) {
  await assertPermission(ctx.principal, "vendors.create");
  const organizationId = ctx.principal.organizationId;

  const duplicates = await findDuplicates(ctx, {
    companyName: input.companyName,
    legalName: orNull(input.legalName) ?? undefined,
    taxNumber: orNull(input.taxNumber) ?? undefined,
    registrationNumber: orNull(input.registrationNumber) ?? undefined,
    email: orNull(input.email) ?? undefined,
  });

  // A high-confidence match is the same legal entity. Creating a second master
  // record for it splits that supplier's spend, contracts and compliance across
  // two rows, which is a data problem no later screen can repair — so it is
  // refused unless someone has looked at the matches and said otherwise.
  const blocking = duplicates.filter((d) => d.confidence === "HIGH");
  if (blocking.length > 0 && !input.acknowledgeDuplicates) {
    throw conflict(
      blocking.length === 1
        ? `This looks like an existing vendor: ${blocking[0].companyName} — ${blocking[0].reason.toLowerCase()}.`
        : `This looks like ${blocking.length} existing vendors in your directory.`,
      { duplicates: blocking }
    );
  }

  const categoryIds = await validCategoryIds(ctx, input.categoryIds ?? []);

  const created = await db.$transaction(async (tx) => {
    const vendor = await tx.vendor.create({
      data: {
        organizationId,
        companyName: input.companyName.trim(),
        legalName: orNull(input.legalName),
        tradingName: orNull(input.tradingName),
        vendorType: input.vendorType,
        description: orNull(input.description),
        contactPerson: orNull(input.contactPerson),
        email: orNull(input.email),
        phone: orNull(input.phone),
        website: orNull(input.website),
        address: orNull(input.address),
        city: orNull(input.city),
        stateRegion: orNull(input.stateRegion),
        postalCode: orNull(input.postalCode),
        country: orNull(input.country),
        category: orNull(input.category),
        taxNumber: orNull(input.taxNumber),
        registrationNumber: orNull(input.registrationNumber),
        businessClassification: orNull(input.businessClassification),
        businessSize: input.businessSize,
        incorporatedOn: orDate(input.incorporatedOn),
        bankName: orNull(input.bankName),
        bankAccount: orNull(input.bankAccount),
        paymentTerms: input.paymentTerms,
        preferredCurrency: input.preferredCurrency,
        leadTimeDays: input.leadTimeDays ?? 0,
        minimumOrderValue: input.minimumOrderValue,
        tags: input.tags.length > 0 ? JSON.stringify(input.tags) : null,
        notes: orNull(input.notes),
        status: "PROSPECTIVE",
        createdById: ctx.principal.userId,
      },
    });

    if (categoryIds.length > 0) {
      await tx.vendorCategoryLink.createMany({
        data: categoryIds.map((categoryId) => ({ organizationId, vendorId: vendor.id, categoryId })),
        skipDuplicates: true,
      });
    }

    return vendor;
  });

  await recordAudit({
    organizationId,
    userId: ctx.principal.userId,
    action: "vendor.created",
    resource: "Vendor",
    resourceId: created.id,
    after: {
      companyName: created.companyName,
      status: created.status,
      vendorType: created.vendorType,
      acknowledgedDuplicates: blocking.length > 0 ? blocking.map((d) => d.id) : undefined,
    },
    context: ctx.context,
  });
  await recordActivity({
    organizationId,
    userId: ctx.principal.userId,
    eventType: "VENDOR_ADDED",
    description: `${ctx.principal.name} added ${created.companyName} to the vendor directory`,
    vendorId: created.id,
    context: ctx.context,
  });

  return { ...(await getById(ctx, created.id)), potentialDuplicates: duplicates };
}

export async function update(ctx: ServiceContext, id: string, input: UpdateInput) {
  await assertPermission(ctx.principal, "vendors.edit");
  const tdb = scoped(ctx);

  const vendor = await tdb.vendor.findUnique({ where: { id } });
  if (!vendor) throw notFound("Vendor not found");

  if (vendor.status === "ARCHIVED" || vendor.status === "BLACKLISTED") {
    throw conflict(
      `${vendor.companyName} is ${vendor.status.toLowerCase()} and cannot be edited. Restore it first.`
    );
  }

  const data: Prisma.VendorUpdateInput = {};
  const set = <K extends keyof Prisma.VendorUpdateInput>(key: K, value: Prisma.VendorUpdateInput[K]) => {
    data[key] = value;
  };

  if (input.companyName !== undefined) set("companyName", input.companyName.trim());
  if (input.legalName !== undefined) set("legalName", orNull(input.legalName));
  if (input.tradingName !== undefined) set("tradingName", orNull(input.tradingName));
  if (input.vendorType !== undefined) set("vendorType", input.vendorType);
  if (input.description !== undefined) set("description", orNull(input.description));
  if (input.contactPerson !== undefined) set("contactPerson", orNull(input.contactPerson));
  if (input.email !== undefined) set("email", orNull(input.email));
  if (input.phone !== undefined) set("phone", orNull(input.phone));
  if (input.website !== undefined) set("website", orNull(input.website));
  if (input.address !== undefined) set("address", orNull(input.address));
  if (input.city !== undefined) set("city", orNull(input.city));
  if (input.stateRegion !== undefined) set("stateRegion", orNull(input.stateRegion));
  if (input.postalCode !== undefined) set("postalCode", orNull(input.postalCode));
  if (input.country !== undefined) set("country", orNull(input.country));
  if (input.category !== undefined) set("category", orNull(input.category));
  if (input.taxNumber !== undefined) set("taxNumber", orNull(input.taxNumber));
  if (input.registrationNumber !== undefined) set("registrationNumber", orNull(input.registrationNumber));
  if (input.businessClassification !== undefined) set("businessClassification", orNull(input.businessClassification));
  if (input.businessSize !== undefined) set("businessSize", input.businessSize);
  if (input.incorporatedOn !== undefined) set("incorporatedOn", orDate(input.incorporatedOn));
  if (input.bankName !== undefined) set("bankName", orNull(input.bankName));
  if (input.bankAccount !== undefined) set("bankAccount", orNull(input.bankAccount));
  if (input.paymentTerms !== undefined) set("paymentTerms", input.paymentTerms);
  if (input.preferredCurrency !== undefined) set("preferredCurrency", input.preferredCurrency);
  if (input.leadTimeDays !== undefined) set("leadTimeDays", input.leadTimeDays);
  if (input.minimumOrderValue !== undefined) set("minimumOrderValue", input.minimumOrderValue);
  if (input.notes !== undefined) set("notes", orNull(input.notes));
  if (input.tags !== undefined) set("tags", input.tags.length > 0 ? JSON.stringify(input.tags) : null);

  // `undefined` means the caller did not mention categories; an explicit empty
  // array means clear them. A truthiness test cannot tell those apart, and `[]`
  // is truthy — which is how a bank-details edit came to wipe a vendor's
  // categories and leave it unable to be resubmitted for approval.
  const categoryIds =
    input.categoryIds !== undefined ? await validCategoryIds(ctx, input.categoryIds) : null;

  await db.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id }, data });

    if (categoryIds) {
      await tx.vendorCategoryLink.deleteMany({
        where: { vendorId: id, categoryId: { notIn: categoryIds.length > 0 ? categoryIds : ["-"] } },
      });
      if (categoryIds.length > 0) {
        await tx.vendorCategoryLink.createMany({
          data: categoryIds.map((categoryId) => ({
            organizationId: ctx.principal.organizationId,
            vendorId: id,
            categoryId,
          })),
          skipDuplicates: true,
        });
      }
    }
  });

  const changes = diff(vendor as unknown as Record<string, unknown>, data as Record<string, unknown>);
  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "vendor.updated",
    resource: "Vendor",
    resourceId: id,
    before: changes.before,
    after: changes.after,
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "VENDOR_UPDATED",
    description: `${ctx.principal.name} updated ${vendor.companyName}`,
    vendorId: id,
    context: ctx.context,
  });

  return getById(ctx, id);
}

/** Rejects category ids belonging to another tenant or to no category at all. */
async function validCategoryIds(ctx: ServiceContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = await scoped(ctx).procurementCategory.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    throw validation("Unknown procurement category", [
      { path: "categoryIds", message: `Not a category in this organization: ${missing.join(", ")}` },
    ]);
  }
  return found.map((f) => f.id);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function addContact(ctx: ServiceContext, vendorId: string, input: ContactInput) {
  await assertPermission(ctx.principal, "vendors.edit");
  const vendor = await requireVendor(ctx, vendorId);

  const contact = await db.$transaction(async (tx) => {
    // Exactly one primary contact. Promoting a new one demotes the old rather
    // than leaving two rows both claiming to be it.
    if (input.isPrimary) {
      await tx.vendorContact.updateMany({ where: { vendorId }, data: { isPrimary: false } });
    }
    return tx.vendorContact.create({
      data: {
        vendorId,
        name: input.name.trim(),
        email: orNull(input.email),
        phone: orNull(input.phone),
        jobTitle: orNull(input.jobTitle),
        department: orNull(input.department),
        type: input.type,
        isPrimary: input.isPrimary,
        isActive: input.isActive,
        notes: orNull(input.notes),
      },
    });
  });

  await recordEventPair(ctx, {
    action: "vendor.contact_added",
    vendorId,
    resourceId: contact.id,
    after: { name: contact.name, type: contact.type, isPrimary: contact.isPrimary },
    description: `${ctx.principal.name} added ${contact.name} as a contact for ${vendor.companyName}`,
  });

  return getById(ctx, vendorId);
}

export async function updateContact(
  ctx: ServiceContext,
  vendorId: string,
  contactId: string,
  input: ContactUpdateInput
) {
  await assertPermission(ctx.principal, "vendors.edit");
  const vendor = await requireVendor(ctx, vendorId);

  const existing = await db.vendorContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.vendorId !== vendorId) throw notFound("Contact not found");

  await db.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.vendorContact.updateMany({
        where: { vendorId, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    await tx.vendorContact.update({
      where: { id: contactId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email: orNull(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: orNull(input.phone) } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: orNull(input.jobTitle) } : {}),
        ...(input.department !== undefined ? { department: orNull(input.department) } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: orNull(input.notes) } : {}),
      },
    });
  });

  await recordEventPair(ctx, {
    action: "vendor.contact_updated",
    vendorId,
    resourceId: contactId,
    before: { name: existing.name, isPrimary: existing.isPrimary },
    after: input,
    description: `${ctx.principal.name} updated contact ${existing.name} on ${vendor.companyName}`,
  });

  return getById(ctx, vendorId);
}

export async function removeContact(ctx: ServiceContext, vendorId: string, contactId: string) {
  await assertPermission(ctx.principal, "vendors.edit");
  const vendor = await requireVendor(ctx, vendorId);

  const existing = await db.vendorContact.findUnique({ where: { id: contactId } });
  if (!existing || existing.vendorId !== vendorId) throw notFound("Contact not found");

  await db.vendorContact.delete({ where: { id: contactId } });

  await recordEventPair(ctx, {
    action: "vendor.contact_removed",
    vendorId,
    resourceId: contactId,
    before: { name: existing.name },
    description: `${ctx.principal.name} removed contact ${existing.name} from ${vendor.companyName}`,
  });

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function setCategories(ctx: ServiceContext, vendorId: string, input: CategoriesInput) {
  await assertPermission(ctx.principal, "vendors.edit");
  const vendor = await requireVendor(ctx, vendorId);

  const categoryIds = await validCategoryIds(ctx, input.categoryIds);
  const preferred = new Set(input.preferredCategoryIds.filter((id) => categoryIds.includes(id)));

  await db.$transaction(async (tx) => {
    await tx.vendorCategoryLink.deleteMany({ where: { vendorId } });
    if (categoryIds.length > 0) {
      await tx.vendorCategoryLink.createMany({
        data: categoryIds.map((categoryId) => ({
          organizationId: ctx.principal.organizationId,
          vendorId,
          categoryId,
          isPreferred: preferred.has(categoryId),
        })),
      });
    }
  });

  await recordEventPair(ctx, {
    action: "vendor.categories_set",
    vendorId,
    after: { categoryIds },
    description: `${ctx.principal.name} set ${categoryIds.length} supply ${categoryIds.length === 1 ? "category" : "categories"} on ${vendor.companyName}`,
  });

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function addDocument(ctx: ServiceContext, vendorId: string, input: DocumentInput) {
  await assertPermission(ctx.principal, "documents.upload");
  const vendor = await requireVendor(ctx, vendorId);

  // A stored file, if named, must belong to this tenant — the id arrives from the
  // client and is not otherwise constrained.
  if (input.storedFileId) {
    const file = await scoped(ctx).storedFile.findUnique({ where: { id: input.storedFileId } });
    assertSameOrg(file, ctx.principal.organizationId, "File");
  }

  let supersedes: { id: string; version: number } | null = null;
  if (input.supersedesId) {
    const prior = await db.vendorDocument.findUnique({
      where: { id: input.supersedesId },
      select: { id: true, vendorId: true, version: true, supersededBy: { select: { id: true } } },
    });
    if (!prior || prior.vendorId !== vendorId) throw notFound("Document being replaced was not found");
    if (prior.supersededBy) throw conflict("That document has already been replaced");
    supersedes = { id: prior.id, version: prior.version };
  }

  const doc = await db.$transaction(async (tx) => {
    const created = await tx.vendorDocument.create({
      data: {
        vendorId,
        type: input.type,
        name: input.name.trim(),
        documentNumber: orNull(input.documentNumber),
        issuedAt: orDate(input.issuedAt),
        expiresAt: orDate(input.expiresAt),
        notes: orNull(input.notes),
        storedFileId: input.storedFileId ?? null,
        supersedesId: supersedes?.id ?? null,
        version: (supersedes?.version ?? 0) + 1,
        uploadedById: ctx.principal.userId,
        status: "PENDING_REVIEW",
      },
    });

    // Attaching evidence moves the requirement to SUBMITTED: the supplier has
    // provided something, and a reviewer now owes it a decision.
    if (input.requirementId) {
      const req = await tx.vendorComplianceRequirement.findUnique({
        where: { id: input.requirementId },
        select: { id: true, vendorId: true },
      });
      if (!req || req.vendorId !== vendorId) throw notFound("Compliance requirement not found");
      await tx.vendorComplianceRequirement.update({
        where: { id: input.requirementId },
        data: {
          documentId: created.id,
          status: "SUBMITTED",
          submittedAt: new Date(),
          expiresAt: orDate(input.expiresAt) ?? undefined,
        },
      });
      await refreshCompliance(tx, vendorId);
    }

    return created;
  });

  await recordEventPair(ctx, {
    action: "vendor.document_uploaded",
    vendorId,
    resourceId: doc.id,
    after: { name: doc.name, type: doc.type, expiresAt: doc.expiresAt, version: doc.version },
    description: `${ctx.principal.name} uploaded '${doc.name}' for ${vendor.companyName}`,
    eventType: "FILE_UPLOADED",
  });

  return getById(ctx, vendorId);
}

export async function verifyDocument(
  ctx: ServiceContext,
  vendorId: string,
  documentId: string,
  input: VerifyDocInput
) {
  await assertPermission(ctx.principal, "vendors.compliance");
  const vendor = await requireVendor(ctx, vendorId);

  const doc = await db.vendorDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.vendorId !== vendorId) throw notFound("Document not found");

  if (input.decision === "REJECTED" && !orNull(input.reason)) {
    throw validation("Rejecting a document requires a reason", [
      { path: "reason", message: "Say why the document was not accepted" },
    ]);
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    const verified = input.decision === "VERIFIED";
    await tx.vendorDocument.update({
      where: { id: documentId },
      data: {
        verifiedById: verified ? ctx.principal.userId : null,
        verifiedAt: verified ? now : null,
        rejectedReason: verified ? null : orNull(input.reason),
        status: verified
          ? documentStatus({ verifiedAt: now, rejectedReason: null, expiresAt: doc.expiresAt })
          : "PENDING_REVIEW",
      },
    });

    // A requirement resting on this document follows it.
    await tx.vendorComplianceRequirement.updateMany({
      where: { vendorId, documentId },
      data: verified
        ? { status: "VERIFIED", reviewedAt: now, reviewedById: ctx.principal.userId }
        : {
            status: "REJECTED",
            reviewedAt: now,
            reviewedById: ctx.principal.userId,
            reviewNotes: orNull(input.reason),
          },
    });

    await refreshCompliance(tx, vendorId);
  });

  await recordEventPair(ctx, {
    action: input.decision === "VERIFIED" ? "vendor.document_verified" : "vendor.document_rejected",
    vendorId,
    resourceId: documentId,
    before: { status: doc.status, verifiedAt: doc.verifiedAt },
    after: { decision: input.decision, reason: orNull(input.reason) },
    description: `${ctx.principal.name} ${input.decision === "VERIFIED" ? "verified" : "rejected"} '${doc.name}' for ${vendor.companyName}`,
    severity: input.decision === "VERIFIED" ? "SUCCESS" : "WARNING",
  });

  return getById(ctx, vendorId);
}

export async function removeDocument(ctx: ServiceContext, vendorId: string, documentId: string) {
  await assertPermission(ctx.principal, "vendors.compliance");
  const vendor = await requireVendor(ctx, vendorId);

  const doc = await db.vendorDocument.findUnique({
    where: { id: documentId },
    include: { requirements: { select: { id: true } } },
  });
  if (!doc || doc.vendorId !== vendorId) throw notFound("Document not found");

  // A verified document is evidence a decision was taken on. Removing it would
  // leave an approval resting on nothing, so it is superseded, never deleted.
  if (doc.verifiedAt) {
    throw conflict(
      "A verified document cannot be deleted. Upload a replacement instead — the original is kept as history."
    );
  }

  await db.$transaction(async (tx) => {
    if (doc.requirements.length > 0) {
      await tx.vendorComplianceRequirement.updateMany({
        where: { documentId },
        data: { documentId: null, status: "PENDING_SUBMISSION", submittedAt: null },
      });
    }
    await tx.vendorDocument.delete({ where: { id: documentId } });
    await refreshCompliance(tx, vendorId);
  });

  await recordEventPair(ctx, {
    action: "vendor.document_removed",
    vendorId,
    resourceId: documentId,
    before: { name: doc.name, type: doc.type },
    description: `${ctx.principal.name} removed '${doc.name}' from ${vendor.companyName}`,
    severity: "WARNING",
  });

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Compliance requirements
// ---------------------------------------------------------------------------

export async function addRequirement(ctx: ServiceContext, vendorId: string, input: RequirementInput) {
  await assertPermission(ctx.principal, "vendors.compliance");
  const vendor = await requireVendor(ctx, vendorId);

  const existing = await db.vendorComplianceRequirement.findFirst({
    where: { vendorId, type: input.type, name: input.name.trim() },
  });
  if (existing) throw conflict(`${vendor.companyName} already has a "${input.name.trim()}" requirement`);

  const requirement = await db.$transaction(async (tx) => {
    const created = await tx.vendorComplianceRequirement.create({
      data: {
        organizationId: ctx.principal.organizationId,
        vendorId,
        type: input.type,
        name: input.name.trim(),
        description: orNull(input.description),
        isMandatory: input.isMandatory,
        expiresAt: orDate(input.expiresAt),
        status: "PENDING_SUBMISSION",
      },
    });
    await refreshCompliance(tx, vendorId);
    return created;
  });

  await recordEventPair(ctx, {
    action: "vendor.compliance_requirement_added",
    vendorId,
    resourceId: requirement.id,
    after: { type: requirement.type, name: requirement.name, isMandatory: requirement.isMandatory },
    description: `${ctx.principal.name} added the "${requirement.name}" requirement to ${vendor.companyName}`,
  });

  return getById(ctx, vendorId);
}

export async function updateRequirement(
  ctx: ServiceContext,
  vendorId: string,
  requirementId: string,
  input: RequirementUpdateInput
) {
  await assertPermission(ctx.principal, "vendors.compliance");
  await requireVendor(ctx, vendorId);

  const existing = await db.vendorComplianceRequirement.findUnique({ where: { id: requirementId } });
  if (!existing || existing.vendorId !== vendorId) throw notFound("Compliance requirement not found");

  await db.$transaction(async (tx) => {
    await tx.vendorComplianceRequirement.update({
      where: { id: requirementId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: orNull(input.description) } : {}),
        ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: orDate(input.expiresAt) } : {}),
      },
    });
    await refreshCompliance(tx, vendorId);
  });

  await recordEventPair(ctx, {
    action: "vendor.compliance_requirement_updated",
    vendorId,
    resourceId: requirementId,
    before: { name: existing.name, isMandatory: existing.isMandatory },
    after: input,
    description: `${ctx.principal.name} updated the "${existing.name}" requirement on this vendor`,
  });

  return getById(ctx, vendorId);
}

export async function removeRequirement(ctx: ServiceContext, vendorId: string, requirementId: string) {
  await assertPermission(ctx.principal, "vendors.compliance");
  await requireVendor(ctx, vendorId);

  const existing = await db.vendorComplianceRequirement.findUnique({ where: { id: requirementId } });
  if (!existing || existing.vendorId !== vendorId) throw notFound("Compliance requirement not found");

  await db.$transaction(async (tx) => {
    await tx.vendorComplianceRequirement.delete({ where: { id: requirementId } });
    await refreshCompliance(tx, vendorId);
  });

  await recordEventPair(ctx, {
    action: "vendor.compliance_requirement_removed",
    vendorId,
    resourceId: requirementId,
    before: { name: existing.name, status: existing.status },
    description: `${ctx.principal.name} removed the "${existing.name}" requirement`,
    severity: "WARNING",
  });

  return getById(ctx, vendorId);
}

export async function decideRequirement(
  ctx: ServiceContext,
  vendorId: string,
  requirementId: string,
  input: ComplianceDecisionInput
) {
  await assertPermission(ctx.principal, "vendors.compliance");
  const vendor = await requireVendor(ctx, vendorId);

  const existing = await db.vendorComplianceRequirement.findUnique({ where: { id: requirementId } });
  if (!existing || existing.vendorId !== vendorId) throw notFound("Compliance requirement not found");

  // Verification asserts that someone looked at evidence. With nothing attached
  // there is nothing to have looked at — a waiver is the honest route for a
  // requirement satisfied outside the system.
  if (input.decision === "VERIFIED" && !existing.documentId) {
    throw conflict(
      "Attach the supporting document before verifying this requirement, or waive it with a reason."
    );
  }

  const now = new Date();
  const status: VendorComplianceStatus = input.decision;

  await db.$transaction(async (tx) => {
    await tx.vendorComplianceRequirement.update({
      where: { id: requirementId },
      data: {
        status,
        reviewedAt: now,
        reviewedById: ctx.principal.userId,
        reviewNotes: orNull(input.notes),
        ...(input.expiresAt !== undefined ? { expiresAt: orDate(input.expiresAt) } : {}),
        ...(input.decision === "WAIVED"
          ? { waivedById: ctx.principal.userId, waivedReason: orNull(input.notes) }
          : { waivedById: null, waivedReason: null }),
      },
    });
    await refreshCompliance(tx, vendorId);
  });

  const refreshed = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { complianceState: true },
  });

  await recordEventPair(ctx, {
    action: `vendor.compliance_${input.decision.toLowerCase()}`,
    vendorId,
    resourceId: requirementId,
    before: { status: existing.status },
    after: { status, notes: orNull(input.notes), vendorComplianceState: refreshed?.complianceState },
    description: `${ctx.principal.name} marked "${existing.name}" as ${status.toLowerCase().replace(/_/g, " ")} for ${vendor.companyName}`,
    severity: input.decision === "REJECTED" ? "WARNING" : "SUCCESS",
  });

  // A supplier falling out of compliance is something the people who buy from
  // them need to hear about, not something to find on a profile page later.
  if (refreshed?.complianceState === "NON_COMPLIANT" || refreshed?.complianceState === "EXPIRED") {
    await emit({
      type: "vendor.compliance_issue",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: await vendorWatcherIds(ctx),
      title: `${vendor.companyName} is ${refreshed.complianceState === "EXPIRED" ? "carrying expired compliance" : "non-compliant"}`,
      message: `"${existing.name}" was marked ${status.toLowerCase().replace(/_/g, " ")}.`,
      severity: "warning",
      link: "vendors",
      entityType: "VENDOR",
      entityId: vendorId,
    });
  }

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Onboarding → approval
// ---------------------------------------------------------------------------

/**
 * Sends a vendor into review.
 *
 * The gate is the point of the whole phase: a supplier does not enter an approval
 * queue until there is something for a reviewer to review. What is checked here
 * is deliberately what a reviewer cannot supply themselves — who they are, what
 * they sell, and the evidence the organization asked for.
 */
export async function submitForReview(ctx: ServiceContext, vendorId: string) {
  await assertPermission(ctx.principal, "vendors.edit");

  const tdb = scoped(ctx);
  const vendor = await tdb.vendor.findUnique({
    where: { id: vendorId },
    include: {
      contacts: true,
      categoryLinks: true,
      complianceRequirements: true,
      documents: true,
    },
  });
  if (!vendor) throw notFound("Vendor not found");

  if (!nextStates("vendor", vendor.status).includes("PENDING_APPROVAL")) {
    throw conflict(
      `${vendor.companyName} is ${vendor.status.replace(/_/g, " ").toLowerCase()} and cannot be submitted for review`
    );
  }

  const problems: { path: string; message: string }[] = [];
  if (!vendor.contacts.some((c) => c.isActive)) {
    problems.push({ path: "contacts", message: "Add at least one contact at this supplier" });
  }
  if (vendor.categoryLinks.length === 0) {
    problems.push({ path: "categoryIds", message: "Record at least one category this supplier supplies" });
  }
  if (!orNull(vendor.taxNumber) && !orNull(vendor.registrationNumber)) {
    problems.push({
      path: "taxNumber",
      message: "Record a tax identification or company registration number",
    });
  }
  const outstanding = vendor.complianceRequirements.filter(
    (r) => r.isMandatory && (r.status === "NOT_STARTED" || r.status === "PENDING_SUBMISSION")
  );
  if (outstanding.length > 0) {
    problems.push({
      path: "compliance",
      message: `Awaiting evidence for: ${outstanding.map((r) => r.name).join(", ")}`,
    });
  }
  if (problems.length > 0) {
    throw validation("This vendor is not ready for review", { issues: problems });
  }

  const facts: workflow.RequestFacts = {
    organizationId: ctx.principal.organizationId,
    // Vendor approval is not routed on value — there is no amount at onboarding.
    // The workflow's threshold columns are left unset for VENDOR workflows, and a
    // zero here matches an unbounded band.
    amount: 0,
    priority: "MEDIUM",
    departmentId: null,
    category: vendor.category,
  };

  const selected = await workflow.selectWorkflow(facts, "VENDOR");
  if (!selected) {
    throw conflict(
      "No vendor approval workflow is configured. Add one covering vendor onboarding in Settings → Workflows."
    );
  }

  // The person who put the supplier forward is excluded from approving them.
  const chain = await workflow.buildChain(selected, facts, vendor.createdById ?? ctx.principal.userId);
  if (chain.length === 0) {
    throw conflict(`Workflow "${selected.name}" produced no applicable approval stages`);
  }

  const now = new Date();
  const firstSequence = Math.min(...chain.map((c) => c.sequence));
  const target: VendorStatus = "PENDING_APPROVAL";

  await db.$transaction(async (tx) => {
    // A resubmission supersedes the previous attempt; the old instance stays as
    // history so a rejection and the revision that followed it both survive.
    await tx.approvalInstance.updateMany({
      where: { entityType: "VENDOR", entityId: vendorId, status: "IN_PROGRESS" },
      data: { status: "CANCELLED", completedAt: now, outcomeReason: "Superseded by resubmission" },
    });

    const instance = await tx.approvalInstance.create({
      data: {
        organizationId: ctx.principal.organizationId,
        workflowId: selected.id,
        entityType: "VENDOR",
        entityId: vendorId,
        status: "IN_PROGRESS",
        currency: vendor.preferredCurrency,
        context: {
          companyName: vendor.companyName,
          vendorType: vendor.vendorType,
          category: vendor.category,
          complianceState: vendor.complianceState,
          workflowVersion: selected.version,
        },
      },
    });

    await tx.approvalStep.createMany({
      data: chain.map((s) => ({
        instanceId: instance.id,
        stageId: s.stageId,
        stage: s.stage,
        sequence: s.sequence,
        approverId: s.approverId,
        approverRole: s.approverRole,
        approverRoleId: s.approverRoleId,
        decision: "PENDING" as const,
        slaHours: s.slaHours,
        slaExpiresAt: s.slaExpiresAt,
      })),
    });

    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status: transition("vendor", vendor.status, target),
        submittedForReviewAt: now,
        onboardingStartedAt: vendor.onboardingStartedAt ?? now,
        rejectedAt: null,
        rejectedReason: null,
      },
    });

    await enqueue(tx, {
      type: "vendor.approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: chain.filter((c) => c.sequence === firstSequence).map((c) => c.approverId),
      title: `Vendor approval required — ${vendor.companyName}`,
      message: `${ctx.principal.name} submitted ${vendor.companyName} for onboarding approval.`,
      severity: "approval",
      link: "approvals",
      entityType: "VENDOR",
      entityId: vendorId,
      payload: { companyName: vendor.companyName, workflow: selected.name },
    });
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "vendor.submitted_for_review",
    resource: "Vendor",
    resourceId: vendorId,
    before: { status: vendor.status },
    after: { status: target, workflow: selected.name, stages: chain.length },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: "VENDOR_SUBMITTED",
    description: `${ctx.principal.name} submitted ${vendor.companyName} into "${selected.name}"`,
    vendorId,
    context: ctx.context,
  });

  return getById(ctx, vendorId);
}

/** One approver's decision on one stage of a vendor's onboarding. */
export async function decide(ctx: ServiceContext, vendorId: string, input: DecisionInput) {
  await assertPermission(ctx.principal, "vendors.approve");

  const tdb = scoped(ctx);
  const vendor = await tdb.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw notFound("Vendor not found");

  if (vendor.status !== "PENDING_APPROVAL" && vendor.status !== "UNDER_REVIEW") {
    throw conflict(
      `${vendor.companyName} is ${vendor.status.replace(/_/g, " ").toLowerCase()} and is not awaiting approval`
    );
  }

  const instance = await tdb.approvalInstance.findFirst({
    where: { entityType: "VENDOR", entityId: vendorId, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!instance) throw conflict("There is no approval in progress for this vendor");

  // Same gate as a purchase request: the assigned approver, on the active stage,
  // and only once.
  workflow.assertCanDecide(instance.steps, input.stepId, ctx.principal.userId);

  if (input.decision === "REJECTED" && !orNull(input.comment)) {
    throw validation("Rejecting a vendor requires a reason", [
      { path: "comment", message: "Say why this supplier is not being approved" },
    ]);
  }

  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: input.stepId },
      data: {
        decision: input.decision,
        comment: orNull(input.comment),
        rejectionReason: input.decision === "REJECTED" ? orNull(input.comment) : null,
        decidedAt: now,
        decidedById: ctx.principal.userId,
      },
    });

    const steps = await tx.approvalStep.findMany({
      where: { instanceId: instance.id },
      orderBy: { sequence: "asc" },
    });
    const state = workflow.chainState(steps);

    const target: VendorStatus =
      input.decision === "REJECTED" ? "REJECTED" : state.isComplete ? "APPROVED" : "PENDING_APPROVAL";

    if (input.decision === "REJECTED" || state.isComplete) {
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          status: input.decision === "REJECTED" ? "REJECTED" : "APPROVED",
          completedAt: now,
          decidedById: ctx.principal.userId,
          outcomeReason: orNull(input.comment),
        },
      });
      // A rejection ends the chain; the remaining stages are not owed a decision.
      if (input.decision === "REJECTED") {
        await tx.approvalStep.deleteMany({ where: { instanceId: instance.id, decision: "PENDING" } });
      }
    }

    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status: transition("vendor", vendor.status, target),
        ...(target === "APPROVED"
          ? { approvedAt: now, approvedById: ctx.principal.userId, rejectedAt: null, rejectedReason: null }
          : {}),
        ...(target === "REJECTED" ? { rejectedAt: now, rejectedReason: orNull(input.comment) } : {}),
      },
    });

    return { state, target, steps };
  });

  const verb = input.decision === "APPROVED" ? "approved" : "rejected";

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: `vendor.${verb}`,
    resource: "Vendor",
    resourceId: vendorId,
    before: { status: vendor.status },
    after: { status: result.target, stepId: input.stepId, comment: orNull(input.comment) },
    context: ctx.context,
  });
  await recordActivity({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    eventType: input.decision === "APPROVED" ? "VENDOR_APPROVED" : "VENDOR_REJECTED",
    description: `${ctx.principal.name} ${verb} ${vendor.companyName}${orNull(input.comment) ? ` — "${input.comment}"` : ""}`,
    severity: input.decision === "APPROVED" ? "SUCCESS" : "WARNING",
    vendorId,
    context: ctx.context,
  });

  const interested = [
    ...(vendor.createdById ? [vendor.createdById] : []),
    ...(await vendorWatcherIds(ctx)),
  ];

  if (result.target === "APPROVED" || result.target === "REJECTED") {
    await emit({
      type: result.target === "APPROVED" ? "vendor.approved" : "vendor.rejected",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: interested,
      title: `${vendor.companyName} ${verb}`,
      message:
        result.target === "APPROVED"
          ? `${ctx.principal.name} approved ${vendor.companyName}. Activate them to begin trading.`
          : `${ctx.principal.name} rejected ${vendor.companyName}${orNull(input.comment) ? ` — ${input.comment}` : ""}.`,
      severity: result.target === "APPROVED" ? "success" : "error",
      link: "vendors",
      entityType: "VENDOR",
      entityId: vendorId,
    });
  } else {
    // Cleared this stage — hand the next one its work.
    await emit({
      type: "vendor.approval_required",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: result.state.activeSteps.map((s) => s.delegatedToId ?? s.approverId),
      title: `Vendor approval required — ${vendor.companyName}`,
      message: `${vendor.companyName} has cleared the previous stage and needs your review.`,
      severity: "approval",
      link: "approvals",
      entityType: "VENDOR",
      entityId: vendorId,
    });
  }

  return getById(ctx, vendorId);
}

/** Vendor approval steps this user can act on now. Mirrors the request queue. */
export async function myApprovalQueue(ctx: ServiceContext) {
  const tdb = scoped(ctx);

  const steps = await tdb.approvalStep.findMany({
    where: {
      decision: "PENDING",
      instance: { entityType: "VENDOR", status: "IN_PROGRESS" },
      OR: [{ approverId: ctx.principal.userId }, { delegatedToId: ctx.principal.userId }],
    },
    include: { instance: { include: { steps: { orderBy: { sequence: "asc" } } } } },
    orderBy: { slaExpiresAt: "asc" },
  });

  const actionable = steps.filter((step) => {
    if (!step.instance) return false;
    return workflow.chainState(step.instance.steps).activeSteps.some((a) => a.id === step.id);
  });
  if (actionable.length === 0) return [];

  const vendors = await tdb.vendor.findMany({
    where: { id: { in: actionable.map((s) => s.instance!.entityId) } },
    include: vendorInclude,
  });
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const bankDetails = await can(ctx.principal, "vendors.edit");

  return actionable
    .map((step) => {
      const vendor = byId.get(step.instance!.entityId);
      if (!vendor) return null;
      return {
        id: step.id,
        stage: step.stage,
        sequence: step.sequence,
        approverId: step.approverId,
        approverRole: step.approverRole,
        delegatedToId: step.delegatedToId ?? undefined,
        slaExpiresAt: iso(step.slaExpiresAt),
        waitingSince: step.createdAt.toISOString(),
        instanceId: step.instanceId ?? undefined,
        vendor: project(vendor, { bankDetails, restrictedNotes: false }),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------

/**
 * Which permission each lifecycle verb requires, and what it does.
 *
 * Written as a table because §16 and §26 are about *who* may do each of these,
 * and a table can be read and checked in one sitting in a way that a chain of
 * conditionals cannot.
 */
const ACTION_RULES: Record<
  ActionInput["action"],
  { permission: Parameters<typeof assertPermission>[1]; to: VendorStatus | null; requiresReason?: boolean }
> = {
  INVITE: { permission: "vendors.edit", to: "INVITED" },
  START_ONBOARDING: { permission: "vendors.edit", to: "ONBOARDING" },
  SUBMIT_FOR_REVIEW: { permission: "vendors.edit", to: "UNDER_REVIEW" },
  ACTIVATE: { permission: "vendors.approve", to: "ACTIVE" },
  SUSPEND: { permission: "vendors.suspend", to: "SUSPENDED", requiresReason: true },
  REACTIVATE: { permission: "vendors.suspend", to: "ACTIVE" },
  DEACTIVATE: { permission: "vendors.suspend", to: "INACTIVE", requiresReason: true },
  ARCHIVE: { permission: "vendors.archive", to: "ARCHIVED" },
  RESTORE: { permission: "vendors.archive", to: "PROSPECTIVE" },
  BLACKLIST: { permission: "vendors.archive", to: "BLACKLISTED", requiresReason: true },
  LIFT_BLACKLIST: { permission: "vendors.archive", to: "INACTIVE", requiresReason: true },
  SET_PREFERRED: { permission: "vendors.edit", to: null },
  CLEAR_PREFERRED: { permission: "vendors.edit", to: null },
};

export async function act(ctx: ServiceContext, vendorId: string, input: ActionInput) {
  const rule = ACTION_RULES[input.action];
  await assertPermission(ctx.principal, rule.permission);

  const tdb = scoped(ctx);
  const vendor = await tdb.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw notFound("Vendor not found");

  const reason = orNull(input.reason);
  if (rule.requiresReason && !reason) {
    throw validation(`${labelFor(input.action)} requires a reason`, [
      { path: "reason", message: "Record why this is being done — it goes on the vendor's record" },
    ]);
  }

  // The preferred flag is not a lifecycle move, so it does not go near the state
  // machine — see the note on `VendorStatus` in the schema.
  if (input.action === "SET_PREFERRED" || input.action === "CLEAR_PREFERRED") {
    const isPreferred = input.action === "SET_PREFERRED";
    if (isPreferred && !TRADEABLE_STATUSES.includes(vendor.status)) {
      throw conflict("Only an approved or active supplier can be marked preferred");
    }
    await db.vendor.update({ where: { id: vendorId }, data: { isPreferred } });
    await recordEventPair(ctx, {
      action: isPreferred ? "vendor.marked_preferred" : "vendor.cleared_preferred",
      vendorId,
      before: { isPreferred: vendor.isPreferred },
      after: { isPreferred },
      description: `${ctx.principal.name} ${isPreferred ? "marked" : "removed"} ${vendor.companyName} ${isPreferred ? "as a preferred supplier" : "from the preferred suppliers"}`,
    });
    return getById(ctx, vendorId);
  }

  const target = rule.to!;
  const now = new Date();
  const nextStatus = transition("vendor", vendor.status, target, reasonHint(vendor.status, target));

  const data: Prisma.VendorUpdateInput = { status: nextStatus };

  switch (input.action) {
    case "INVITE":
      data.invitedAt = now;
      break;
    case "START_ONBOARDING":
      data.onboardingStartedAt = now;
      break;
    case "ACTIVATE":
      data.activatedAt = now;
      data.onboardedAt = vendor.onboardedAt ?? now;
      data.suspendedAt = null;
      data.suspendedReason = null;
      data.deactivatedAt = null;
      data.deactivatedReason = null;
      break;
    case "SUSPEND":
      data.suspendedAt = now;
      data.suspendedReason = reason;
      break;
    case "REACTIVATE":
      data.suspendedAt = null;
      data.suspendedReason = null;
      data.deactivatedAt = null;
      data.deactivatedReason = null;
      data.activatedAt = now;
      break;
    case "DEACTIVATE":
      data.deactivatedAt = now;
      data.deactivatedReason = reason;
      break;
    case "ARCHIVE":
      data.archivedAt = now;
      break;
    case "RESTORE":
      data.archivedAt = null;
      break;
    case "BLACKLIST":
      data.blacklistedAt = now;
      data.blacklistedReason = reason;
      data.isPreferred = false;
      break;
    case "LIFT_BLACKLIST":
      data.blacklistedAt = null;
      data.blacklistedReason = null;
      break;
  }

  await db.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: vendorId }, data });

    // Barring or shelving a supplier ends any approval still running over them.
    if (target === "ARCHIVED" || target === "BLACKLISTED") {
      await tx.approvalInstance.updateMany({
        where: { entityType: "VENDOR", entityId: vendorId, status: "IN_PROGRESS" },
        data: {
          status: "CANCELLED",
          completedAt: now,
          outcomeReason: `Vendor ${target.toLowerCase()}`,
        },
      });
    }
  });

  const severity =
    input.action === "BLACKLIST"
      ? "CRITICAL"
      : input.action === "SUSPEND" || input.action === "DEACTIVATE" || input.action === "ARCHIVE"
        ? "WARNING"
        : "SUCCESS";

  await recordEventPair(ctx, {
    action: `vendor.${input.action.toLowerCase()}`,
    vendorId,
    before: { status: vendor.status },
    after: { status: nextStatus, reason },
    description: `${ctx.principal.name} ${pastTense(input.action)} ${vendor.companyName}${reason ? ` — "${reason}"` : ""}`,
    severity,
    eventType: activityTypeFor(input.action),
  });

  if (input.action === "SUSPEND" || input.action === "BLACKLIST" || input.action === "ACTIVATE") {
    await emit({
      type: input.action === "ACTIVATE" ? "vendor.activated" : "vendor.suspended",
      organizationId: ctx.principal.organizationId,
      actorId: ctx.principal.userId,
      recipientIds: await vendorWatcherIds(ctx),
      title: `${vendor.companyName} ${pastTense(input.action)}`,
      message: reason
        ? `${ctx.principal.name} ${pastTense(input.action)} ${vendor.companyName} — ${reason}`
        : `${ctx.principal.name} ${pastTense(input.action)} ${vendor.companyName}.`,
      severity: input.action === "ACTIVATE" ? "success" : "warning",
      link: "vendors",
      entityType: "VENDOR",
      entityId: vendorId,
    });
  }

  return getById(ctx, vendorId);
}

const labelFor = (action: ActionInput["action"]) =>
  action.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

const pastTense = (action: ActionInput["action"]) =>
  ({
    INVITE: "invited",
    START_ONBOARDING: "started onboarding for",
    SUBMIT_FOR_REVIEW: "submitted for review",
    ACTIVATE: "activated",
    SUSPEND: "suspended",
    REACTIVATE: "reactivated",
    DEACTIVATE: "deactivated",
    ARCHIVE: "archived",
    RESTORE: "restored",
    BLACKLIST: "blacklisted",
    LIFT_BLACKLIST: "lifted the blacklist on",
    SET_PREFERRED: "marked preferred",
    CLEAR_PREFERRED: "cleared preferred on",
  })[action];

const activityTypeFor = (action: ActionInput["action"]) =>
  action === "BLACKLIST"
    ? "VENDOR_BLACKLISTED"
    : action === "ARCHIVE"
      ? "VENDOR_ARCHIVED"
      : "VENDOR_UPDATED";

/** Explains an illegal move in the terms the user was thinking in. */
function reasonHint(from: VendorStatus, to: VendorStatus): string | undefined {
  if (to === "ACTIVE" && from === "PENDING_APPROVAL") {
    return "the onboarding approval has not been completed";
  }
  if (to === "ACTIVE" && (from === "PROSPECTIVE" || from === "ONBOARDING")) {
    return "a supplier must be approved before it can be activated";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/**
 * Records a risk assessment.
 *
 * §17: an assessment is a dated, attributed judgement kept as history, not a
 * number this platform invents. The vendor's current level is the latest
 * assessment's; the earlier ones stay, so a decision taken under an old rating
 * remains explicable.
 */
export async function assessRisk(ctx: ServiceContext, vendorId: string, input: RiskInput) {
  await assertPermission(ctx.principal, "vendors.risk");
  const vendor = await requireVendor(ctx, vendorId);

  const now = new Date();
  const nextReviewAt = orDate(input.nextReviewAt);

  const assessment = await db.$transaction(async (tx) => {
    const created = await tx.vendorRiskAssessment.create({
      data: {
        vendorId,
        level: input.level,
        score: input.score,
        factors: input.factors ?? undefined,
        summary: orNull(input.summary),
        assessedById: ctx.principal.userId,
        assessedAt: now,
        nextReviewAt,
      },
    });

    await tx.vendor.update({
      where: { id: vendorId },
      data: {
        riskLevel: input.level,
        riskScore: input.score,
        riskStatus: "ASSESSED",
        riskReviewedAt: now,
        riskNextReviewAt: nextReviewAt,
      },
    });

    return created;
  });

  await recordEventPair(ctx, {
    action: "vendor.risk_assessed",
    vendorId,
    resourceId: assessment.id,
    before: { riskLevel: vendor.riskLevel, riskScore: vendor.riskScore },
    after: { riskLevel: input.level, riskScore: input.score },
    description: `${ctx.principal.name} assessed ${vendor.companyName} as ${input.level.toLowerCase()} risk (${input.score}/100)`,
    severity: input.level === "HIGH" || input.level === "CRITICAL" ? "WARNING" : "INFO",
  });

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Internal notes
// ---------------------------------------------------------------------------

export async function listNotes(ctx: ServiceContext, vendorId: string, includeRestricted: boolean) {
  const notes = await scoped(ctx).vendorNote.findMany({
    where: {
      vendorId,
      ...(includeRestricted ? {} : { visibility: "INTERNAL" }),
    },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });

  return notes.map((n) => ({
    id: n.id,
    vendorId: n.vendorId,
    authorId: n.authorId ?? undefined,
    body: n.body,
    visibility: n.visibility,
    isPinned: n.isPinned,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function addNote(ctx: ServiceContext, vendorId: string, input: NoteInput) {
  await assertPermission(ctx.principal, "vendors.notes");
  const vendor = await requireVendor(ctx, vendorId);

  // A restricted note is only visible to vendor approvers, so only they may
  // create one — otherwise a user could write a note they cannot then read.
  if (input.visibility === "RESTRICTED" && !(await can(ctx.principal, "vendors.approve"))) {
    throw forbidden("Restricted notes can only be written by users who can approve vendors");
  }

  const note = await db.vendorNote.create({
    data: {
      organizationId: ctx.principal.organizationId,
      vendorId,
      authorId: ctx.principal.userId,
      body: input.body.trim(),
      visibility: input.visibility,
      isPinned: input.isPinned,
    },
  });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "vendor.note_added",
    resource: "VendorNote",
    resourceId: note.id,
    after: { vendorId, visibility: note.visibility },
    context: ctx.context,
  });

  return getById(ctx, vendorId);
}

export async function removeNote(ctx: ServiceContext, vendorId: string, noteId: string) {
  await assertPermission(ctx.principal, "vendors.notes");
  await requireVendor(ctx, vendorId);

  const note = await scoped(ctx).vendorNote.findUnique({ where: { id: noteId } });
  if (!note || note.vendorId !== vendorId) throw notFound("Note not found");

  // Own notes only, unless the caller administers vendors.
  if (note.authorId !== ctx.principal.userId && !(await can(ctx.principal, "vendors.approve"))) {
    throw forbidden("You can only remove notes you wrote");
  }

  await db.vendorNote.delete({ where: { id: noteId } });

  await recordAudit({
    organizationId: ctx.principal.organizationId,
    userId: ctx.principal.userId,
    action: "vendor.note_removed",
    resource: "VendorNote",
    resourceId: noteId,
    before: { vendorId, visibility: note.visibility },
    context: ctx.context,
  });

  return getById(ctx, vendorId);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * The vendor dashboard's figures.
 *
 * Every number is a count the database performed. §23 and §31: nothing here is
 * derived from a payload the browser happens to be holding, and nothing is
 * invented to make a tile look populated.
 */
export async function dashboard(ctx: ServiceContext) {
  await assertPermission(ctx.principal, "vendors.view");
  const tdb = scoped(ctx);

  const soon = new Date(Date.now() + EXPIRY_WARNING_DAYS * dayMs);
  const now = new Date();

  const [
    total,
    active,
    preferred,
    onboarding,
    pendingApproval,
    suspended,
    underReview,
    nonCompliant,
    expiringDocs,
    expiredDocs,
    highRisk,
    riskReviewDue,
  ] = await Promise.all([
    tdb.vendor.count({ where: { status: { notIn: ["ARCHIVED"] } } }),
    tdb.vendor.count({ where: { status: "ACTIVE" } }),
    tdb.vendor.count({ where: { isPreferred: true } }),
    tdb.vendor.count({ where: { status: { in: ["INVITED", "ONBOARDING", "PROSPECTIVE"] } } }),
    tdb.vendor.count({ where: { status: "PENDING_APPROVAL" } }),
    tdb.vendor.count({ where: { status: "SUSPENDED" } }),
    tdb.vendor.count({ where: { status: "UNDER_REVIEW" } }),
    tdb.vendor.count({
      where: { complianceState: { in: ["NON_COMPLIANT", "EXPIRED", "PARTIALLY_COMPLIANT"] } },
    }),
    tdb.vendor.count({
      where: {
        status: { notIn: ["ARCHIVED", "BLACKLISTED"] },
        documents: { some: { expiresAt: { gte: now, lte: soon } } },
      },
    }),
    tdb.vendor.count({
      where: {
        status: { notIn: ["ARCHIVED", "BLACKLISTED"] },
        documents: { some: { expiresAt: { lt: now } } },
      },
    }),
    tdb.vendor.count({ where: { riskLevel: { in: ["HIGH", "CRITICAL"] } } }),
    tdb.vendor.count({ where: { riskNextReviewAt: { lte: now } } }),
  ]);

  return {
    total,
    active,
    preferred,
    onboarding,
    pendingApproval,
    suspended,
    underReview,
    nonCompliant,
    expiringDocuments: expiringDocs,
    expiredDocuments: expiredDocs,
    highRisk,
    riskReviewDue,
  };
}

/** Vendors carrying documents or requirements that lapse inside the window. */
export async function expiringCompliance(ctx: ServiceContext, withinDays = EXPIRY_WARNING_DAYS) {
  await assertPermission(ctx.principal, "vendors.view");
  const cutoff = new Date(Date.now() + withinDays * dayMs);

  const vendors = await scoped(ctx).vendor.findMany({
    where: {
      status: { notIn: ["ARCHIVED", "BLACKLISTED"] },
      OR: [
        { documents: { some: { expiresAt: { lte: cutoff } } } },
        { complianceRequirements: { some: { expiresAt: { lte: cutoff } } } },
      ],
    },
    select: {
      id: true,
      companyName: true,
      status: true,
      complianceState: true,
      documents: {
        where: { expiresAt: { lte: cutoff } },
        select: { id: true, name: true, type: true, expiresAt: true, verifiedAt: true, rejectedReason: true },
      },
      complianceRequirements: {
        where: { expiresAt: { lte: cutoff } },
        select: { id: true, name: true, type: true, status: true, expiresAt: true },
      },
    },
    orderBy: { companyName: "asc" },
  });

  return vendors.map((v) => ({
    id: v.id,
    companyName: v.companyName,
    status: v.status,
    complianceState: v.complianceState,
    items: [
      ...v.documents.map((d) => ({
        kind: "DOCUMENT" as const,
        id: d.id,
        name: d.name,
        type: d.type as string,
        expiresAt: iso(d.expiresAt),
        daysToExpiry: daysUntil(d.expiresAt),
        state: documentStatus(d),
      })),
      ...v.complianceRequirements.map((r) => ({
        kind: "REQUIREMENT" as const,
        id: r.id,
        name: r.name,
        type: r.type as string,
        expiresAt: iso(r.expiresAt),
        daysToExpiry: daysUntil(r.expiresAt),
        state: r.status as string,
      })),
    ].sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0)),
  }));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireVendor(ctx: ServiceContext, vendorId: string) {
  const vendor = await scoped(ctx).vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw notFound("Vendor not found");
  return vendor;
}

/** Who hears about a vendor-level event: the people who manage suppliers. */
async function vendorWatcherIds(ctx: ServiceContext): Promise<string[]> {
  const users = await scoped(ctx).user.findMany({
    where: { status: "ACTIVE", role: { in: ["PROCUREMENT_MANAGER", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * One business event, written to both logs, with the vendor attached.
 *
 * The audit row's subject is always the *vendor*, even for an event about one of
 * its documents or contacts. An auditor asks "what has happened to this supplier",
 * and answering that has to be one query; a row claiming `resource: "Vendor"`
 * while carrying a document's id in `resourceId` answers nothing and is not even
 * self-consistent. The child record's id travels in the payload instead.
 */
async function recordEventPair(
  ctx: ServiceContext,
  input: {
    action: string;
    vendorId: string;
    /** Id of the child record this event is about, if any. */
    resourceId?: string;
    before?: unknown;
    after?: unknown;
    description: string;
    severity?: "INFO" | "WARNING" | "CRITICAL" | "SUCCESS";
    eventType?: string;
  }
) {
  const after =
    input.resourceId && input.resourceId !== input.vendorId
      ? { ...(input.after as Record<string, unknown> | undefined), recordId: input.resourceId }
      : input.after;

  await Promise.all([
    recordAudit({
      organizationId: ctx.principal.organizationId,
      userId: ctx.principal.userId,
      action: input.action,
      resource: "Vendor",
      resourceId: input.vendorId,
      before: input.before,
      after,
      context: ctx.context,
    }),
    recordActivity({
      organizationId: ctx.principal.organizationId,
      userId: ctx.principal.userId,
      eventType: input.eventType ?? "VENDOR_UPDATED",
      description: input.description,
      severity: input.severity ?? "INFO",
      vendorId: input.vendorId,
      context: ctx.context,
    }),
  ]);
}
