// NextMav Procure — the shapes the sourcing screens read.
//
// These describe what the sourcing endpoints actually return, which is not the
// same as the database model: the RFQ detail response carries derived fields the
// server computes (readiness, available transitions, the seal state), and the
// supplier-facing payloads are deliberately narrower than their tables.
//
// Declared here rather than in `types.ts` because that file describes the
// *client's* legacy in-memory model — the one the Zustand store hydrates from
// /api/bootstrap. Sourcing does not use that store: these screens fetch, page and
// filter against the server, so their types belong with the feature.

import type {
  Priority,
  QuotationStatus,
  RFQInvitationStatus,
  RFQStatus,
  RequestStatus,
  SourcingEventStatus,
  VendorComplianceState,
  VendorRiskLevel,
  VendorStatus,
} from "./types";

export type EvaluationMethod = "LOWEST_PRICE" | "WEIGHTED_SCORE" | "QUALITY_THEN_PRICE";

export type CriterionType =
  | "PRICE"
  | "DELIVERY"
  | "QUALITY"
  | "COMPLIANCE"
  | "WARRANTY"
  | "EXPERIENCE"
  | "TECHNICAL"
  | "SERVICE_LEVEL"
  | "RISK"
  | "OTHER";

export type EvaluatorRole = "PROCUREMENT" | "TECHNICAL" | "FINANCE" | "DEPARTMENT" | "EXECUTIVE";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export interface RfqListRow {
  id: string;
  rfqNumber: string;
  referenceNumber: string | null;
  title: string;
  description: string | null;
  status: RFQStatus;
  currency: string;
  deadline: string;
  publishedAt: string | null;
  createdAt: string;
  sourcingEvent: { id: string; eventNumber: string; title: string } | null;
  categoryRef: { id: string; name: string } | null;
  request: { id: string; requestNumber: string } | null;
  /** Counted from the invitation rows, never from a loaded page (§23). */
  responseSummary: {
    invited: number;
    viewed: number;
    responded: number;
    declined: number;
    pending: number;
  };
  lowestQuote: number | null;
}

export interface SourcingDashboard {
  rfqs: {
    draft: number;
    pendingApproval: number;
    approved: number;
    published: number;
    closingSoon: number;
    closed: number;
    underEvaluation: number;
    awarded: number;
    noAward: number;
    expired: number;
    cancelled: number;
    total: number;
  };
  suppliers: {
    invited: number;
    viewed: number;
    accepted: number;
    responded: number;
    declined: number;
    pending: number;
    noResponse: number;
  };
  quotations: { received: number; totalValue: number };
  awaitingMe: { awardApprovals: number; evaluations: number };
}

// ---------------------------------------------------------------------------
// The RFQ document
// ---------------------------------------------------------------------------

export interface RfqLineItem {
  id: string;
  itemName: string;
  description: string | null;
  specification: string | null;
  quantity: number;
  unit: string;
  requiredDeliveryDate: string | null;
  targetPrice: number | null;
  notes: string | null;
  requestLineItemId: string | null;
  sortOrder: number;
}

export interface RfqCriterion {
  id: string;
  name: string;
  description: string | null;
  type: CriterionType;
  weight: number;
  lowerIsBetter: boolean;
  maxScore: number;
  isAutomatic: boolean;
  sortOrder: number;
}

export interface RfqEvaluator {
  id: string;
  userId: string;
  role: EvaluatorRole;
  isChair: boolean;
  completedAt: string | null;
  user: { id: string; name: string; email: string; initials: string; avatarColor: string };
}

export interface RfqInvitation {
  id: string;
  vendorId: string;
  status: RFQInvitationStatus;
  invitedAt: string;
  viewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  acceptedAt: string | null;
  respondedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  revisionAllowedAt: string | null;
  revisionReason: string | null;
  vendor: {
    id: string;
    companyName: string;
    email: string | null;
    phone: string | null;
    status: VendorStatus;
    rating: number;
    onTimeDeliveryRate: number;
    qualityRating: number;
    complianceState: VendorComplianceState;
    riskLevel: VendorRiskLevel;
    country: string | null;
  };
}

export interface QuotationLine {
  id: string;
  rfqLineItemId: string | null;
  itemName: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  deliveryCost: number;
  lineTotal: number;
  deliveryDays: number | null;
  isAlternative: boolean;
  isNoBid: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface BuyerQuotation {
  id: string;
  quotationNumber: string | null;
  vendorId: string;
  revision: number;
  status: QuotationStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  deliveryDays: number;
  warranty: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  notes: string | null;
  supplierReference: string | null;
  submittedAt: string | null;
  evaluationScore: number | null;
  weightedScore: number | null;
  rank: number | null;
  isCompliant: boolean;
  /** True while a sealed RFQ is still open: the bid exists, its contents do not. */
  sealed?: boolean;
  lineItems: QuotationLine[];
  vendor: { id: string; companyName: string; rating: number; status: VendorStatus };
}

export interface Clarification {
  id: string;
  question: string;
  answer: string | null;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  visibility: "PRIVATE" | "ALL_SUPPLIERS";
  createdAt: string;
  answeredAt: string | null;
  vendor: { id: string; companyName: string } | null;
  askedByUser: { id: string; name: string } | null;
  answeredBy: { id: string; name: string } | null;
}

export interface AwardRecommendation {
  id: string;
  quotationId: string;
  vendorId: string;
  type: "FULL" | "PARTIAL";
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  recommendedAmount: number;
  currency: string;
  justification: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  vendor: { id: string; companyName: string };
  quotation: { id: string; totalAmount: number; currency: string; revision: number };
  recommendedBy: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
  items: { id: string; quantity: number; unitPrice: number; lineTotal: number }[];
  /** Frozen at the moment the recommendation was raised — §32. */
  evaluationSummary: {
    method?: string;
    capturedAt?: string;
    rows?: {
      vendorName: string;
      quotationNumber: string | null;
      totalAmount: number;
      deliveryDays: number;
      coverage: number;
      weightedScore: number | null;
      rank: number | null;
    }[];
  } | null;
  /** The award's own approval chain, routed on value rather than on the RFQ. */
  approval: ApprovalView | null;
}

export interface ApprovalStepView {
  id: string;
  sequence: number;
  stage: string;
  decision: "PENDING" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "SKIPPED" | "DELEGATED";
  comment: string | null;
  decidedAt: string | null;
  slaExpiresAt: string | null;
  approver: { id: string; name: string; initials: string; avatarColor: string };
  delegatedTo: { id: string; name: string } | null;
  stageRef: { id: string; name: string; description: string | null } | null;
}

export interface ApprovalView {
  id: string;
  status: "IN_PROGRESS" | "APPROVED" | "REJECTED" | "CANCELLED" | "RETURNED";
  workflow: { id: string; name: string; version: number } | null;
  steps: ApprovalStepView[];
  activeStepIds: string[];
  isComplete: boolean;
  isRejected: boolean;
  /** The step this viewer can decide right now, if any. */
  myStepId: string | null;
}

export interface RfqDetail {
  id: string;
  rfqNumber: string;
  referenceNumber: string | null;
  title: string;
  description: string | null;
  status: RFQStatus;
  currency: string;
  estimatedValue: number | null;
  deadline: string;
  questionDeadline: string | null;
  requiredDeliveryDate: string | null;
  deliveryTerms: string | null;
  deliveryAddress: string | null;
  termsAndConditions: string | null;
  showTargetPrice: boolean;
  isSealed: boolean;
  allowSupplierRevision: boolean;
  evaluationMethod: EvaluationMethod;
  submittedForApprovalAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  awardedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  remindersSent: number;
  createdAt: string;
  createdById: string | null;
  selectedQuotationId: string | null;
  sourcingEvent: {
    id: string;
    eventNumber: string;
    title: string;
    status: SourcingEventStatus;
    type: string;
    requestId: string | null;
  } | null;
  request: { id: string; requestNumber: string; title: string; status: RequestStatus } | null;
  categoryRef: { id: string; code: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  publishedBy: { id: string; name: string } | null;
  closedBy: { id: string; name: string } | null;
  lineItems: RfqLineItem[];
  criteria: RfqCriterion[];
  evaluators: RfqEvaluator[];
  invitedVendors: RfqInvitation[];
  quotations: BuyerQuotation[];
  clarifications: Clarification[];
  recommendations: AwardRecommendation[];
  approval: ApprovalView | null;
  purchaseOrders: { id: string; poNumber: string; status: string }[];
  /** What is still missing before this RFQ can go to the market (§10). */
  readiness: { path: string; message: string }[];
  availableTransitions: string[];
  isSealedAndLocked: boolean;
}

// ---------------------------------------------------------------------------
// Comparison and evaluation
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  quotationId: string;
  quotationNumber: string | null;
  vendorId: string;
  vendorName: string;
  revision: number;
  status: QuotationStatus;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  deliveryDays: number;
  paymentTerms: string | null;
  warranty: string | null;
  validUntil: string | null;
  isExpired: boolean;
  isCompliant: boolean;
  vendorRating: number;
  onTimeDeliveryRate: number;
  qualityRating: number;
  varianceFromLowest: number;
  variancePercent: number;
  isLowest: boolean;
  isFastest: boolean;
  linesQuoted: number;
  linesRequested: number;
  /** Percentage of the RFQ's lines this supplier actually priced (§26). */
  coverage: number;
  weightedScore: number | null;
  rank: number | null;
}

export interface ComparisonBid {
  quotationId: string;
  vendorId: string;
  vendorName: string;
  quoted: boolean;
  isNoBid: boolean;
  isAlternative?: boolean;
  itemName?: string;
  quotedQuantity?: number;
  requestedQuantity?: number;
  quantityMatches?: boolean;
  unit?: string;
  unitPrice?: number;
  discountAmount?: number;
  taxAmount?: number;
  deliveryCost?: number;
  lineTotal?: number;
  deliveryDays?: number | null;
  effectiveUnitRate?: number | null;
  notes?: string | null;
}

export interface ComparisonLine {
  rfqLineItemId: string;
  itemName: string;
  description: string | null;
  specification: string | null;
  quantity: number;
  unit: string;
  targetPrice: number | null;
  requiredDeliveryDate: string | null;
  bids: ComparisonBid[];
  bestVendorId: string | null;
  bestUnitRate: number | null;
}

export interface Comparison {
  rfqId: string;
  currency: string;
  rows: ComparisonRow[];
  lines: ComparisonLine[];
  evaluation: { method: EvaluationMethod; criteria: RfqCriterion[] } | null;
  summary: {
    invited: number;
    responded: number;
    lowestAmount: number | null;
    highestAmount: number | null;
    spread: number | null;
    averageAmount: number | null;
    estimatedValue: number | null;
    splitAwardTotal?: number;
    splitAwardSaving?: number;
  };
}

export interface CriterionResult {
  criterionId: string;
  name: string;
  type: string;
  weight: number;
  maxScore: number;
  lowerIsBetter: boolean;
  isAutomatic: boolean;
  rawScore: number | null;
  normalised: number | null;
  /** normalised × weight. These sum to the weighted total (§31). */
  contribution: number;
  evaluatorCount: number;
}

export interface EvaluationResult {
  quotationId: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  criteria: CriterionResult[];
  weightedScore: number | null;
  completeness: number;
  rank: number;
}

export interface EvaluationSummary {
  rfqId: string;
  sealed: boolean;
  method: EvaluationMethod;
  criteria: RfqCriterion[];
  evaluators: RfqEvaluator[];
  results: EvaluationResult[];
  myScores: {
    quotationId: string;
    criterionId: string;
    score: number;
    notes: string | null;
    scoredAt: string;
    revisions: number;
  }[];
  panelScores:
    | {
        quotationId: string;
        vendorName: string;
        scores: {
          criterionId: string;
          criterionName: string;
          evaluatorId: string | null;
          evaluatorRole: string | null;
          scoredBy: string | null;
          score: number;
          notes: string | null;
          scoredAt: string;
        }[];
      }[]
    | null;
  canSeeAll: boolean;
  isPanelMember: boolean;
}

// ---------------------------------------------------------------------------
// Supplier selection
// ---------------------------------------------------------------------------

export interface EligibleSupplier {
  id: string;
  code: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  status: VendorStatus;
  complianceState: VendorComplianceState;
  riskLevel: VendorRiskLevel;
  rating: number;
  qualityRating: number;
  onTimeDeliveryRate: number;
  totalOrders: number;
  totalValue: number;
  preferredCurrency: string;
  categories: { id: string; name: string }[];
  /** Whether anyone at this supplier can actually sign in and answer. */
  hasPortalAccess: boolean;
}

// ---------------------------------------------------------------------------
// Sourcing events
// ---------------------------------------------------------------------------

export interface SourcingEventRow {
  id: string;
  eventNumber: string;
  title: string;
  description: string | null;
  status: SourcingEventStatus;
  type: string;
  currency: string;
  estimatedValue: number | null;
  responseDeadline: string | null;
  publishedAt: string | null;
  awardedAt: string | null;
  createdAt: string;
  request: { id: string; requestNumber: string; title: string; status: RequestStatus } | null;
  category: { id: string; code: string; name: string } | null;
  owner: { id: string; name: string; initials: string; avatarColor: string } | null;
  rfqs: {
    id: string;
    rfqNumber: string;
    title: string;
    status: RFQStatus;
    deadline: string;
    _count: { invitedVendors: number; quotations: number };
  }[];
}

export interface QuotationInboxRow {
  id: string;
  quotationNumber: string | null;
  revision: number;
  status: QuotationStatus;
  currency: string;
  totalAmount: number;
  deliveryDays: number;
  validUntil: string | null;
  submittedAt: string | null;
  sealed: boolean;
  isExpired: boolean;
  vendor: { id: string; companyName: string; rating: number; status: VendorStatus };
  rfq: { id: string; rfqNumber: string; title: string; status: RFQStatus; deadline: string };
  _count: { lineItems: number };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Human phrasing for a lifecycle value, used in prose rather than in a badge. */
export const prettyStatus = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * How long is left, in the words a buyer uses. Returns null once it has passed,
 * so a caller can render "closed" rather than a negative countdown.
 */
export function timeRemaining(deadline: string): string | null {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return `${hours} hours left`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes} minutes left`;
}

/** Deadline urgency, for colouring a countdown without inventing a scale. */
export function deadlineTone(deadline: string): "past" | "urgent" | "soon" | "normal" {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "past";
  if (ms < 2 * 86_400_000) return "urgent";
  if (ms < 5 * 86_400_000) return "soon";
  return "normal";
}

/** Statuses in which the buyer may still edit the document. */
export const RFQ_EDITABLE: RFQStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "READY_TO_PUBLISH"];

/** Statuses in which suppliers can still respond. */
export const RFQ_OPEN: RFQStatus[] = ["PUBLISHED", "RESPONSE_PERIOD"];

export type { Priority, RFQStatus, QuotationStatus, RFQInvitationStatus, SourcingEventStatus };
