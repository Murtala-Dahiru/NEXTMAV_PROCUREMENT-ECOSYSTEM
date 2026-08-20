// NextMav Procure — document state machines.
//
// §6 and §11 of the mandate are explicit: a document must not accept an
// arbitrary status change. Before this module the status column was a free
// field — any service (and, before the server existed, any browser) could move a
// request straight from DRAFT to CLOSED, or re-approve a rejected invoice.
//
// Every transition in the platform now goes through `transition()`, which knows
// the legal moves for that document type and refuses the rest. The tables below
// are the authoritative definition of each lifecycle; the diagrams in the schema
// comments describe these tables, they are not a second source of truth.

import type {
  AwardRecommendationStatus,
  ContractStatus,
  VendorStatus,
  GoodsReceiptStatus,
  InvoiceStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  QuotationStatus,
  RFQStatus,
  RequestStatus,
  SourcingEventStatus,
} from "@prisma/client";
// Explicit extension: the verification scripts load this module through plain
// node, which has no path or extension resolution of its own.
import { conflict } from "./errors.ts";

type Transitions<S extends string> = Record<S, readonly S[]>;

/**
 * Purchase request.
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → IN_PROCUREMENT → ORDERED
 *         → PARTIALLY_FULFILLED → FULFILLED → CLOSED
 *
 * RETURNED is the "needs revision" path: the request goes back to its owner for
 * another draft rather than dying as a rejection. APPROVED reaches CLOSED
 * directly for the case where an approved request is satisfied without a
 * purchase order — fulfilled from stock, or superseded.
 */
export const REQUEST_TRANSITIONS: Transitions<RequestStatus> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "RETURNED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "RETURNED", "CANCELLED"],
  RETURNED: ["DRAFT", "SUBMITTED", "CANCELLED"],
  APPROVED: ["IN_PROCUREMENT", "ORDERED", "CLOSED", "CANCELLED"],
  IN_PROCUREMENT: ["ORDERED", "APPROVED", "CANCELLED"],
  ORDERED: ["PARTIALLY_FULFILLED", "FULFILLED", "CANCELLED"],
  PARTIALLY_FULFILLED: ["PARTIALLY_FULFILLED", "FULFILLED", "CANCELLED"],
  FULFILLED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * Purchase order.
 *
 * PARTIALLY_RECEIVED and RECEIVED are reachable from each other because they are
 * derived from the receipt ledger: a receipt corrected downward moves a RECEIVED
 * order back to PARTIALLY_RECEIVED, which is a legitimate correction rather than
 * an illegal move.
 */
export const PO_TRANSITIONS: Transitions<PurchaseOrderStatus> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ISSUED", "CANCELLED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  ISSUED: ["ACKNOWLEDGED", "IN_DELIVERY", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  ACKNOWLEDGED: ["IN_DELIVERY", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  IN_DELIVERY: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"],
  RECEIVED: ["PARTIALLY_RECEIVED", "CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

/** Invoice. Matching gates approval; approval gates payment. */
export const INVOICE_TRANSITIONS: Transitions<InvoiceStatus> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "MATCHED", "APPROVED", "REJECTED", "DISPUTED", "CANCELLED"],
  UNDER_REVIEW: ["MATCHED", "APPROVED", "REJECTED", "DISPUTED", "CANCELLED"],
  MATCHED: ["APPROVED", "REJECTED", "DISPUTED", "CANCELLED"],
  APPROVED: ["PARTIALLY_PAID", "PAID", "OVERDUE", "DISPUTED", "CANCELLED"],
  PARTIALLY_PAID: ["PARTIALLY_PAID", "PAID", "OVERDUE", "DISPUTED"],
  OVERDUE: ["PARTIALLY_PAID", "PAID", "DISPUTED", "CANCELLED"],
  DISPUTED: ["UNDER_REVIEW", "MATCHED", "APPROVED", "REJECTED", "CANCELLED"],
  REJECTED: ["DRAFT", "SUBMITTED", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

/**
 * Payment.
 *
 * A failed payment returns to SCHEDULED for retry rather than being recreated,
 * so the attempt history stays attached to a single payment record.
 */
export const PAYMENT_TRANSITIONS: Transitions<PaymentStatus> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["SCHEDULED", "PROCESSING", "CANCELLED"],
  SCHEDULED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  FAILED: ["SCHEDULED", "PROCESSING", "CANCELLED"],
  COMPLETED: ["REFUNDED"],
  REFUNDED: [],
  CANCELLED: [],
};

/**
 * Sourcing event. Deliberately coarse: the event is a container for the process,
 * and the fine-grained control lives on the RFQ inside it.
 */
export const SOURCING_EVENT_TRANSITIONS: Transitions<SourcingEventStatus> = {
  DRAFT: ["PLANNING", "ACTIVE", "CANCELLED"],
  PLANNING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["EVALUATION", "AWARDED", "CLOSED", "CANCELLED"],
  EVALUATION: ["EVALUATION", "AWARDED", "CLOSED", "CANCELLED"],
  AWARDED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * RFQ.
 *
 *   DRAFT → UNDER_REVIEW → APPROVED → READY_TO_PUBLISH → PUBLISHED
 *         → RESPONSE_PERIOD → CLOSED → UNDER_EVALUATION → AWARDED
 *
 * Notes on the moves that are not a straight line:
 *
 *   UNDER_REVIEW → DRAFT is a rejected approval going back to its author, the
 *   same "needs revision" path a purchase request has. The rejection stays in the
 *   approval instance; the document becomes editable again.
 *
 *   APPROVED and READY_TO_PUBLISH both reach PUBLISHED. Readiness is a
 *   completeness check, not a permission, so an approved-but-incomplete RFQ can
 *   still be published the moment it is completed — publish re-runs the check.
 *
 *   PUBLISHED → DRAFT does not exist. Once suppliers hold an invitation the only
 *   ways out are forward or CANCELLED, because withdrawing a live tender quietly
 *   and re-issuing it is precisely the manipulation an audit trail exists to stop.
 *
 *   CLOSED ⇄ UNDER_EVALUATION lets an evaluation be reopened before an award; and
 *   EXPIRED reaches CLOSED so a round nobody answered can still be wound up.
 */
export const RFQ_TRANSITIONS: Transitions<RFQStatus> = {
  DRAFT: ["UNDER_REVIEW", "APPROVED", "READY_TO_PUBLISH", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "READY_TO_PUBLISH", "DRAFT", "CANCELLED"],
  APPROVED: ["READY_TO_PUBLISH", "PUBLISHED", "CANCELLED"],
  READY_TO_PUBLISH: ["PUBLISHED", "APPROVED", "DRAFT", "CANCELLED"],
  PUBLISHED: ["RESPONSE_PERIOD", "CLOSED", "EXPIRED", "CANCELLED"],
  RESPONSE_PERIOD: ["RESPONSE_PERIOD", "CLOSED", "EXPIRED", "CANCELLED"],
  CLOSED: ["UNDER_EVALUATION", "AWARDED", "NO_AWARD", "CANCELLED"],
  UNDER_EVALUATION: ["UNDER_EVALUATION", "CLOSED", "AWARDED", "NO_AWARD", "CANCELLED"],
  EXPIRED: ["CLOSED", "UNDER_EVALUATION", "NO_AWARD", "CANCELLED"],
  AWARDED: [],
  NO_AWARD: [],
  CANCELLED: [],
};

/**
 * Award recommendation. The proposal that the approval engine acts on.
 *
 * REJECTED returns to DRAFT rather than dying: an approver sending a
 * recommendation back for a different supplier or a better justification is the
 * normal case, and forcing a new record would detach it from its evaluation.
 */
export const AWARD_RECOMMENDATION_TRANSITIONS: Transitions<AwardRecommendationStatus> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "WITHDRAWN"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "WITHDRAWN"],
  REJECTED: ["DRAFT", "WITHDRAWN"],
  APPROVED: [],
  WITHDRAWN: [],
};

/**
 * Quotation.
 *
 * DRAFT is the supplier's private workspace — the buyer cannot see it, and it can
 * be abandoned without trace, which is why it reaches no terminal state but
 * WITHDRAWN.
 *
 * SUPERSEDED is where a revised bid's predecessor lands. It is terminal, and
 * separate from WITHDRAWN, because "replaced by a better price" and "the supplier
 * pulled out" are different facts about a tender and a comparison must not read
 * them as the same.
 */
export const QUOTATION_TRANSITIONS: Transitions<QuotationStatus> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["RECEIVED", "UNDER_EVALUATION", "SELECTED", "REJECTED", "WITHDRAWN", "SUPERSEDED", "EXPIRED"],
  RECEIVED: ["UNDER_EVALUATION", "SELECTED", "REJECTED", "SUPERSEDED", "EXPIRED"],
  UNDER_EVALUATION: ["UNDER_EVALUATION", "SELECTED", "REJECTED", "SUPERSEDED", "EXPIRED"],
  SELECTED: ["REJECTED"],
  REJECTED: ["UNDER_EVALUATION"],
  WITHDRAWN: [],
  SUPERSEDED: [],
  EXPIRED: ["UNDER_EVALUATION"],
};

export const RECEIPT_TRANSITIONS: Transitions<GoodsReceiptStatus> = {
  DRAFT: ["PENDING", "PARTIAL", "RECEIVED", "REJECTED"],
  PENDING: ["PARTIAL", "RECEIVED", "REJECTED"],
  PARTIAL: ["RECEIVED", "REJECTED"],
  RECEIVED: [],
  REJECTED: [],
};

export const CONTRACT_TRANSITIONS: Transitions<ContractStatus> = {
  DRAFT: ["PENDING_APPROVAL", "ACTIVE", "TERMINATED"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT", "TERMINATED"],
  ACTIVE: ["EXPIRING", "EXPIRED", "RENEWED", "TERMINATED"],
  EXPIRING: ["EXPIRED", "RENEWED", "TERMINATED"],
  EXPIRED: ["RENEWED", "TERMINATED"],
  RENEWED: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
};

/**
 * Vendor.
 *
 * The onboarding half of this table (PROSPECTIVE → … → APPROVED) is a funnel: a
 * supplier moves forward as evidence arrives and a decision is taken. The trading
 * half (ACTIVE ⇄ SUSPENDED → INACTIVE) is a relationship that can be paused and
 * resumed for as long as the organization deals with them.
 *
 * Two rules are worth stating because they are enforcement, not documentation:
 *
 *   APPROVED does not equal ACTIVE. Approval is the decision; activation is the
 *   act of opening the supplier for business. Keeping them apart means a vendor
 *   approved on Friday and activated on Monday has both facts on record, and it
 *   is what stops an approval alone from making a supplier orderable.
 *
 *   Lifting a blacklist lands in INACTIVE, never straight in ACTIVE. Re-admitting
 *   a barred supplier is a deliberate two-step act, so it cannot be done by a
 *   single mis-click.
 */
export const VENDOR_TRANSITIONS: Transitions<VendorStatus> = {
  // PENDING_APPROVAL is reachable directly from the early states: submitting a
  // supplier for review IS the act that puts it in front of an approver, and
  // requiring a separate "start onboarding" click first would be ceremony rather
  // than control. The gate on submission is the completeness check in
  // vendor-service.submitForReview, not an extra status hop.
  PROSPECTIVE: ["INVITED", "ONBOARDING", "UNDER_REVIEW", "PENDING_APPROVAL", "REJECTED", "ARCHIVED", "BLACKLISTED"],
  INVITED: ["ONBOARDING", "UNDER_REVIEW", "PENDING_APPROVAL", "PROSPECTIVE", "REJECTED", "ARCHIVED", "BLACKLISTED"],
  ONBOARDING: ["UNDER_REVIEW", "PENDING_APPROVAL", "REJECTED", "ARCHIVED", "BLACKLISTED"],
  UNDER_REVIEW: ["PENDING_APPROVAL", "APPROVED", "ONBOARDING", "REJECTED", "ARCHIVED", "BLACKLISTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "UNDER_REVIEW", "ONBOARDING", "ARCHIVED", "BLACKLISTED"],
  APPROVED: ["ACTIVE", "SUSPENDED", "INACTIVE", "ARCHIVED", "BLACKLISTED"],
  ACTIVE: ["SUSPENDED", "INACTIVE", "ARCHIVED", "BLACKLISTED"],
  SUSPENDED: ["ACTIVE", "INACTIVE", "ARCHIVED", "BLACKLISTED"],
  INACTIVE: ["ACTIVE", "ARCHIVED", "BLACKLISTED"],
  // A rejected applicant may re-apply; the rejection stays on the record.
  REJECTED: ["ONBOARDING", "ARCHIVED", "BLACKLISTED"],
  ARCHIVED: ["PROSPECTIVE", "INACTIVE"],
  BLACKLISTED: ["INACTIVE", "ARCHIVED"],
};

const MACHINES = {
  request: REQUEST_TRANSITIONS,
  sourcingEvent: SOURCING_EVENT_TRANSITIONS,
  awardRecommendation: AWARD_RECOMMENDATION_TRANSITIONS,
  purchaseOrder: PO_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  rfq: RFQ_TRANSITIONS,
  quotation: QUOTATION_TRANSITIONS,
  receipt: RECEIPT_TRANSITIONS,
  contract: CONTRACT_TRANSITIONS,
  vendor: VENDOR_TRANSITIONS,
} as const;

export type DocumentKind = keyof typeof MACHINES;

const LABEL: Record<DocumentKind, string> = {
  request: "Purchase request",
  sourcingEvent: "Sourcing event",
  awardRecommendation: "Award recommendation",
  purchaseOrder: "Purchase order",
  invoice: "Invoice",
  payment: "Payment",
  rfq: "RFQ",
  quotation: "Quotation",
  receipt: "Goods receipt",
  contract: "Contract",
  vendor: "Vendor",
};

const table = (kind: DocumentKind): Record<string, readonly string[]> =>
  MACHINES[kind] as Record<string, readonly string[]>;

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** Whether a move is legal, without throwing. Used to render available actions. */
export function canTransition(kind: DocumentKind, from: string, to: string): boolean {
  if (from === to) return true;
  return (table(kind)[from] ?? []).includes(to);
}

/**
 * Asserts a transition is legal and returns the target status.
 *
 * Services call this instead of assigning `status` directly, so an illegal move
 * fails as a 409 at the service boundary rather than silently corrupting the
 * document history.
 */
export function transition<S extends string>(
  kind: DocumentKind,
  from: S,
  to: S,
  detail?: string
): S {
  if (from === to) return to;
  if (!canTransition(kind, from, to)) {
    throw conflict(
      `${LABEL[kind]} cannot move from ${pretty(from)} to ${pretty(to)}${detail ? ` — ${detail}` : ""}`,
      { kind, from, to, allowed: table(kind)[from] ?? [] }
    );
  }
  return to;
}

/** The moves available from a status, for building UI actions and for tests. */
export function nextStates(kind: DocumentKind, from: string): readonly string[] {
  return table(kind)[from] ?? [];
}

/** Statuses from which no further movement is possible. */
export function isTerminal(kind: DocumentKind, status: string): boolean {
  return nextStates(kind, status).length === 0;
}
