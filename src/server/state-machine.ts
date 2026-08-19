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
  ContractStatus,
  GoodsReceiptStatus,
  InvoiceStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  QuotationStatus,
  RFQStatus,
  RequestStatus,
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

export const RFQ_TRANSITIONS: Transitions<RFQStatus> = {
  DRAFT: ["WAITING", "CANCELLED"],
  WAITING: ["RECEIVED", "EVALUATING", "EXPIRED", "CANCELLED"],
  RECEIVED: ["RECEIVED", "EVALUATING", "AWARDED", "EXPIRED", "CANCELLED"],
  EVALUATING: ["EVALUATING", "AWARDED", "RECEIVED", "CANCELLED"],
  AWARDED: ["CLOSED", "EVALUATING"],
  EXPIRED: ["EVALUATING", "CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export const QUOTATION_TRANSITIONS: Transitions<QuotationStatus> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["RECEIVED", "UNDER_EVALUATION", "WITHDRAWN", "EXPIRED"],
  RECEIVED: ["UNDER_EVALUATION", "SELECTED", "REJECTED", "EXPIRED"],
  UNDER_EVALUATION: ["UNDER_EVALUATION", "SELECTED", "REJECTED", "EXPIRED"],
  SELECTED: ["REJECTED"],
  REJECTED: ["UNDER_EVALUATION"],
  WITHDRAWN: [],
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

const MACHINES = {
  request: REQUEST_TRANSITIONS,
  purchaseOrder: PO_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  rfq: RFQ_TRANSITIONS,
  quotation: QUOTATION_TRANSITIONS,
  receipt: RECEIPT_TRANSITIONS,
  contract: CONTRACT_TRANSITIONS,
} as const;

export type DocumentKind = keyof typeof MACHINES;

const LABEL: Record<DocumentKind, string> = {
  request: "Purchase request",
  purchaseOrder: "Purchase order",
  invoice: "Invoice",
  payment: "Payment",
  rfq: "RFQ",
  quotation: "Quotation",
  receipt: "Goods receipt",
  contract: "Contract",
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
