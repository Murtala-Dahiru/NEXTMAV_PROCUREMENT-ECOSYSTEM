// NextMav Procure — procurement input schemas.
//
// Shared by the client forms and the server routes. Validation lives here once so
// the two cannot drift, and so no mutation can reach a service unvalidated.

import { z } from "zod";

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const money = z.number().finite().nonnegative();
const positiveQty = z.number().finite().positive("Quantity must be greater than zero");

// ---------------------------------------------------------------------------
// Purchase requests
// ---------------------------------------------------------------------------

export const lineItemSchema = z.object({
  itemName: z.string().trim().min(1, "Item name is required").max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  estimatedCost: money,
  taxRate: z.number().min(0).max(100).optional().default(0),
});

export const createRequestSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  departmentId: z.string().min(1, "Department is required"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  category: z.string().trim().max(100).optional().default(""),
  costCenter: z.string().trim().max(60).optional(),
  deliveryLocation: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  businessJustification: z
    .string()
    .trim()
    .min(10, "Provide a business justification of at least 10 characters")
    .max(5000),
  neededByDate: z.string().datetime({ offset: true }).or(z.string().date()),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item").max(200),
  templateId: z.string().optional(),
  /** false saves a draft; true runs it straight into the approval chain. */
  submit: z.boolean().default(false),
});

export const updateRequestSchema = createRequestSchema
  .partial()
  .omit({ submit: true, templateId: true })
  .extend({
    /** Required when editing a request that has already entered approval. */
    revisionReason: z.string().trim().max(500).optional(),
  });

export const requestDecisionSchema = z.object({
  stepId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  comment: z.string().trim().max(2000).optional().default(""),
});

export const delegateApprovalSchema = z.object({
  stepId: z.string().min(1),
  delegateToId: z.string().min(1, "Choose who to delegate to"),
  reason: z.string().trim().max(500).optional().default(""),
});

export const commentSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty").max(4000),
  mentions: z.array(z.string()).max(30).default([]),
});

// ---------------------------------------------------------------------------
// Listing — shared paging/sorting contract for every collection endpoint
// ---------------------------------------------------------------------------

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(60).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  status: z.string().trim().max(60).optional(),
  priority: z.string().trim().max(40).optional(),
  departmentId: z.string().trim().max(60).optional(),
  vendorId: z.string().trim().max(60).optional(),
  category: z.string().trim().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

// ---------------------------------------------------------------------------
// Sourcing events
// ---------------------------------------------------------------------------

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

export const SOURCING_EVENT_TYPES = ["RFQ", "RFP", "RFI", "TENDER", "DIRECT_AWARD"] as const;

export const createSourcingEventSchema = z.object({
  title: z.string().trim().min(3, "Give the event a title").max(200),
  description: z.string().trim().max(5000).optional().default(""),
  /** The approved purchase request this event exists to satisfy. */
  requestId: z.string().optional(),
  categoryId: z.string().optional(),
  ownerId: z.string().optional(),
  type: z.enum(SOURCING_EVENT_TYPES).default("RFQ"),
  currency: z.string().trim().length(3).default("USD"),
  estimatedValue: money.optional(),
  responseDeadline: isoDate.optional(),
});

export const updateSourcingEventSchema = createSourcingEventSchema
  .partial()
  .omit({ requestId: true, type: true });

// ---------------------------------------------------------------------------
// RFQ / sourcing
// ---------------------------------------------------------------------------

export const rfqLineItemSchema = z.object({
  /** Present when editing an existing line; absent when adding one. */
  id: z.string().optional(),
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  specification: z.string().trim().max(8000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  requiredDeliveryDate: isoDate.optional(),
  /** Internal reference price. Never returned to a supplier unless the RFQ says so. */
  targetPrice: money.optional(),
  notes: z.string().trim().max(2000).optional().default(""),
  requestLineItemId: z.string().optional(),
});

export const EVALUATION_CRITERION_TYPES = [
  "PRICE",
  "DELIVERY",
  "QUALITY",
  "COMPLIANCE",
  "WARRANTY",
  "EXPERIENCE",
  "TECHNICAL",
  "SERVICE_LEVEL",
  "RISK",
  "OTHER",
] as const;

export const rfqCriterionSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  type: z.enum(EVALUATION_CRITERION_TYPES).default("OTHER"),
  /** Percentage weight. The set must total 100 before the RFQ can be published. */
  weight: z.number().min(0).max(100).default(0),
  lowerIsBetter: z.boolean().default(false),
  maxScore: z.number().min(1).max(100).default(10),
  isAutomatic: z.boolean().default(false),
});

export const EVALUATOR_ROLES = [
  "PROCUREMENT",
  "TECHNICAL",
  "FINANCE",
  "DEPARTMENT",
  "EXECUTIVE",
] as const;

export const rfqEvaluatorSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(EVALUATOR_ROLES).default("PROCUREMENT"),
  isChair: z.boolean().default(false),
});

export const RFQ_EVALUATION_METHODS = [
  "LOWEST_PRICE",
  "WEIGHTED_SCORE",
  "QUALITY_THEN_PRICE",
] as const;

export const createRfqSchema = z.object({
  /** Existing event to attach this RFQ to. One is created when absent. */
  sourcingEventId: z.string().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().default(""),
  referenceNumber: z.string().trim().max(60).optional(),
  deadline: isoDate,
  questionDeadline: isoDate.optional(),
  requiredDeliveryDate: isoDate.optional(),
  deliveryTerms: z.string().trim().max(2000).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  termsAndConditions: z.string().trim().max(20000).optional(),
  requestId: z.string().optional(),
  categoryId: z.string().optional(),
  currency: z.string().trim().length(3).default("USD"),
  estimatedValue: money.optional(),
  showTargetPrice: z.boolean().default(false),
  isSealed: z.boolean().default(false),
  allowSupplierRevision: z.boolean().default(false),
  evaluationMethod: z.enum(RFQ_EVALUATION_METHODS).default("LOWEST_PRICE"),
  /** Optional at draft time; required before publication. */
  invitedVendorIds: z.array(z.string()).max(100).default([]),
  // Optional: when an RFQ is raised from an approved request, the lines are
  // derived from that request rather than re-keyed.
  lineItems: z.array(rfqLineItemSchema).max(200).optional(),
  // Defined before bids arrive, so the yardstick cannot be chosen after seeing
  // the numbers.
  criteria: z.array(rfqCriterionSchema).max(20).optional(),
  evaluators: z.array(rfqEvaluatorSchema).max(20).optional(),
});

/**
 * Editing a draft RFQ. `requestId` is deliberately not editable: re-pointing an
 * RFQ at a different requirement after the fact is how traceability is lost.
 */
export const updateRfqSchema = createRfqSchema
  .partial()
  .omit({ requestId: true, sourcingEventId: true, invitedVendorIds: true });

export const rfqLineItemsSchema = z.object({
  lineItems: z.array(rfqLineItemSchema).min(1, "An RFQ needs at least one line item").max(200),
});

export const rfqCriteriaSchema = z.object({
  criteria: z.array(rfqCriterionSchema).max(20),
});

export const rfqEvaluatorsSchema = z.object({
  evaluators: z.array(rfqEvaluatorSchema).max(20),
});

export const inviteSuppliersSchema = z.object({
  vendorIds: z.array(z.string()).min(1, "Select at least one supplier").max(100),
});

export const eligibleSupplierQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: z.string().trim().max(60).optional(),
  country: z.string().trim().max(80).optional(),
  /** Filter to suppliers whose compliance is clear. */
  compliantOnly: z.coerce.boolean().default(false),
  /** Highest acceptable risk level. */
  maxRisk: z.enum(["UNRATED", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  /** Only suppliers the organization has previously traded with. */
  existingOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const publishRfqSchema = z.object({
  /** Acknowledges publishing without an approval, where none is configured. */
  note: z.string().trim().max(500).optional(),
});

export const closeRfqSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export const rfqDecisionSchema = z.object({
  stepId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional().default(""),
});

export const allowRevisionSchema = z.object({
  vendorId: z.string().min(1),
  reason: z.string().trim().min(1, "Say why a revision is being invited").max(500),
});

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export const quotationLineItemSchema = z.object({
  rfqLineItemId: z.string().optional(),
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  unitPrice: money,
  discountPercent: z.number().min(0).max(100).default(0),
  taxRate: z.number().min(0).max(100).default(0),
  deliveryCost: money.default(0),
  deliveryDays: z.number().int().min(0).max(3650).optional(),
  isAlternative: z.boolean().default(false),
  isNoBid: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().default(""),
});

/**
 * A quotation as the supplier is working on it.
 *
 * Everything is optional except the lines, because a draft is allowed to be
 * incomplete — that is the entire point of a draft. Completeness is enforced at
 * submission, not at save.
 */
export const saveQuotationDraftSchema = z.object({
  deliveryDays: z.number().int().min(0).max(3650).default(0),
  warranty: z.string().trim().max(500).optional().default(""),
  paymentTerms: z.string().trim().max(200).optional().default(""),
  validUntil: isoDate.optional(),
  validityDays: z.number().int().min(1).max(3650).optional(),
  supplierReference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(4000).optional().default(""),
  discountAmount: money.default(0),
  shippingAmount: money.default(0),
  lineItems: z.array(quotationLineItemSchema).max(200).default([]),
});

/** Submission requires at least one line; the rest is checked in the service. */
export const submitQuotationSchema = saveQuotationDraftSchema.extend({
  lineItems: z.array(quotationLineItemSchema).min(1, "Price at least one line").max(200),
});

export const declineInvitationSchema = z.object({
  reason: z.string().trim().min(1, "Tell the buyer why").max(1000),
});

export const withdrawQuotationSchema = z.object({
  reason: z.string().trim().min(1, "Say why the quotation is being withdrawn").max(1000),
});

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export const askClarificationSchema = z.object({
  question: z.string().trim().min(5, "Ask a question of at least 5 characters").max(4000),
});

export const answerClarificationSchema = z.object({
  answer: z.string().trim().min(1, "An answer cannot be empty").max(8000),
  /**
   * ALL_SUPPLIERS turns the answer into a notice every invited supplier can read.
   * Used when the answer changes a requirement — §19.
   */
  visibility: z.enum(["PRIVATE", "ALL_SUPPLIERS"]).default("PRIVATE"),
});

export const issueNoticeSchema = z.object({
  question: z.string().trim().min(3).max(400),
  answer: z.string().trim().min(1).max(8000),
});

// ---------------------------------------------------------------------------
// Evaluation and award
// ---------------------------------------------------------------------------

export const evaluateQuotationSchema = z.object({
  evaluationScore: z.number().min(0).max(100).optional(),
  evaluationNotes: z.string().trim().max(2000).optional().default(""),
  isCompliant: z.boolean().optional(),
  complianceNotes: z.string().trim().max(2000).optional(),
  // Per-criterion scoring. The weighted total is derived from these, never sent
  // by the client — a caller cannot assert the score that wins the award.
  criterionScores: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        score: z.number().min(0).max(100),
        notes: z.string().trim().max(1000).optional(),
      })
    )
    .max(20)
    .optional(),
});

export const awardRecommendationItemSchema = z.object({
  rfqLineItemId: z.string().optional(),
  quotationLineItemId: z.string().optional(),
  quantity: positiveQty,
  unitPrice: money,
});

export const createAwardRecommendationSchema = z.object({
  quotationId: z.string().min(1, "Select the quotation being recommended"),
  type: z.enum(["FULL", "PARTIAL"]).default("FULL"),
  justification: z
    .string()
    .trim()
    .min(10, "Explain why this supplier is being recommended")
    .max(4000),
  /** Required for a partial award; ignored for a full one. */
  items: z.array(awardRecommendationItemSchema).max(200).optional(),
  /** true submits it into the approval chain immediately. */
  submit: z.boolean().default(false),
});

export const awardDecisionSchema = z.object({
  stepId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional().default(""),
});

export const awardRfqSchema = z.object({
  /** Either award straight from an approved recommendation… */
  recommendationId: z.string().optional(),
  /** …or name the winning quotation directly, where no approval is required. */
  quotationId: z.string().optional(),
  justification: z.string().trim().max(4000).optional().default(""),
});

export const noAwardSchema = z.object({
  reason: z.string().trim().min(5, "Record why no award is being made").max(2000),
});

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const poLineItemSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  unitPrice: money,
  taxRate: z.number().min(0).max(100).default(0),
  createsAsset: z.boolean().default(false),
  assetCategory: z.string().trim().max(60).optional(),
  inventoryItemId: z.string().optional(),
});

export const createPoSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  requestId: z.string().optional(),
  rfqId: z.string().optional(),
  quotationId: z.string().optional(),
  contractId: z.string().optional(),
  expectedDelivery: z.string().datetime({ offset: true }).or(z.string().date()),
  deliveryAddress: z.string().trim().max(300).optional(),
  paymentTerms: z.string().trim().max(200).optional(),
  taxRate: z.number().min(0).max(100).default(0),
  discountAmount: money.default(0),
  notes: z.string().trim().max(2000).optional().default(""),
  termsAndConditions: z.string().trim().max(8000).optional(),
  lineItems: z.array(poLineItemSchema).min(1, "Add at least one line item").max(200),
  /** true issues immediately; false leaves it as a draft awaiting approval. */
  issue: z.boolean().default(false),
});

export const revisePoSchema = z.object({
  reason: z.string().trim().min(3, "A revision reason is required").max(500),
  expectedDelivery: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  notes: z.string().trim().max(2000).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discountAmount: money.optional(),
  lineItems: z.array(poLineItemSchema).min(1).max(200).optional(),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

// ---------------------------------------------------------------------------
// Goods receiving
// ---------------------------------------------------------------------------

export const receiptItemSchema = z.object({
  poLineItemId: z.string().min(1),
  /** Accepted into stock. */
  receivedQty: z.number().finite().min(0),
  /** Turned away — counts as settled against the order, never enters stock. */
  rejectedQty: z.number().finite().min(0).default(0),
  /** Arrived broken. A subset of what was rejected, kept for supplier quality. */
  damagedQty: z.number().finite().min(0).default(0),
  condition: z.enum(["GOOD", "DAMAGED", "MISSING"]).default("GOOD"),
  warehouseId: z.string().optional(),
  batchNumber: z.string().trim().max(80).optional(),
  expiryDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  serialNumbers: z.array(z.string().trim().max(120)).max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const createReceiptSchema = z.object({
  purchaseOrderId: z.string().min(1),
  warehouseId: z.string().optional(),
  carrier: z.string().trim().max(120).optional(),
  waybillNumber: z.string().trim().max(120).optional(),
  receivedDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  location: z.string().trim().max(200).optional(),
  deliveryNoteRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(receiptItemSchema).min(1, "Record at least one line"),
  /** Posting applies the receipt to the PO, inventory and assets. */
  post: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export const invoiceLineItemSchema = z.object({
  poLineItemId: z.string().optional(),
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  unitPrice: money,
  taxRate: z.number().min(0).max(100).default(0),
});

export const createInvoiceSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  vendorInvoiceRef: z.string().trim().max(120).optional(),
  purchaseOrderId: z.string().optional(),
  goodsReceiptId: z.string().optional(),
  issueDate: z.string().datetime({ offset: true }).or(z.string().date()),
  dueDate: z.string().datetime({ offset: true }).or(z.string().date()),
  notes: z.string().trim().max(2000).optional(),
  // Optional: when an invoice is entered against a PO, the lines default to the
  // PO's received-but-uninvoiced quantities, which is the common case.
  lineItems: z.array(invoiceLineItemSchema).max(200).optional(),
  subtotal: money.optional(),
  taxAmount: money.optional(),
  submit: z.boolean().default(false),
});

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, "A rejection reason is required").max(1000),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "CHEQUE",
  "CASH",
  "CARD",
  "MOBILE_MONEY",
  "WIRE",
] as const;

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().finite().positive("Amount must be greater than zero"),
  method: z.enum(PAYMENT_METHODS).default("BANK_TRANSFER"),
  scheduledFor: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const settlePaymentSchema = z.object({
  outcome: z.enum(["COMPLETED", "FAILED"]),
  reference: z.string().trim().max(120).optional(),
  paymentDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  failureReason: z.string().trim().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const VENDOR_STATUSES = [
  "PROSPECTIVE",
  "INVITED",
  "ONBOARDING",
  "UNDER_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "REJECTED",
  "SUSPENDED",
  "INACTIVE",
  "ARCHIVED",
  "BLACKLISTED",
] as const;

export const VENDOR_TYPES = [
  "SUPPLIER",
  "MANUFACTURER",
  "DISTRIBUTOR",
  "CONTRACTOR",
  "SERVICE_PROVIDER",
  "CONSULTANT",
  "OTHER",
] as const;

export const VENDOR_BUSINESS_SIZES = ["MICRO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

export const VENDOR_CONTACT_TYPES = [
  "GENERAL",
  "SALES",
  "FINANCE",
  "OPERATIONS",
  "ACCOUNT_MANAGER",
  "EXECUTIVE",
  "TECHNICAL",
  "SUPPORT",
] as const;

export const VENDOR_COMPLIANCE_TYPES = [
  "BUSINESS_REGISTRATION",
  "TAX_CLEARANCE",
  "INSURANCE",
  "CERTIFICATION",
  "INDUSTRY_LICENCE",
  "BANK_VERIFICATION",
  "DATA_PROTECTION",
  "HEALTH_AND_SAFETY",
  "ANTI_BRIBERY",
  "OTHER",
] as const;

export const VENDOR_DOCUMENT_TYPES = [
  "CERTIFICATE",
  "INSURANCE",
  "TAX",
  "CONTRACT",
  "BANK_PROOF",
  "OTHER",
] as const;

export const VENDOR_RISK_LEVELS = ["UNRATED", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** Optional free text: an empty string from a form field means "not provided". */
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(160)
  .email("Enter a valid email")
  .optional()
  .or(z.literal(""));
const optionalDate = z.string().datetime({ offset: true }).or(z.string().date()).optional().or(z.literal(""));

export const createVendorSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(200),
  legalName: optionalText(200),
  tradingName: optionalText(200),
  vendorType: z.enum(VENDOR_TYPES).default("SUPPLIER"),
  description: optionalText(2000),
  contactPerson: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  website: optionalText(200),
  address: optionalText(400),
  city: optionalText(120),
  stateRegion: optionalText(120),
  postalCode: optionalText(40),
  country: optionalText(120),
  category: optionalText(100),
  /** ProcurementCategory ids. The many-to-many that sourcing actually queries. */
  categoryIds: z.array(z.string().min(1)).max(40).default([]),
  taxNumber: optionalText(80),
  registrationNumber: optionalText(80),
  businessClassification: optionalText(120),
  businessSize: z.enum(VENDOR_BUSINESS_SIZES).optional(),
  incorporatedOn: optionalDate,
  bankName: optionalText(120),
  bankAccount: optionalText(80),
  paymentTerms: z.string().trim().max(60).default("NET_30"),
  preferredCurrency: z.string().trim().max(8).default("USD"),
  leadTimeDays: z.number().int().min(0).max(3650).optional(),
  minimumOrderValue: money.optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  notes: optionalText(4000),
  /**
   * Set once an authorised user has reviewed the near-matches this vendor raised
   * and confirmed it is a distinct company. Without it, a likely duplicate is
   * refused rather than silently created.
   */
  acknowledgeDuplicates: z.boolean().default(false),
});

export const updateVendorSchema = createVendorSchema
  .partial()
  .omit({ acknowledgeDuplicates: true })
  // See the note above: these five carry `.default()` on create, which survives
  // `.partial()` and would make every PATCH overwrite them.
  .extend({
    vendorType: z.enum(VENDOR_TYPES).optional(),
    categoryIds: z.array(z.string().min(1)).max(40).optional(),
    tags: z.array(z.string().trim().max(40)).max(20).optional(),
    paymentTerms: z.string().trim().max(60).optional(),
    preferredCurrency: z.string().trim().max(8).optional(),
  });

/** Listing contract for the vendor directory — filtered and paged server-side. */
export const vendorListQuerySchema = listQuerySchema.extend({
  compliance: z.string().trim().max(60).optional(),
  risk: z.string().trim().max(60).optional(),
  vendorType: z.string().trim().max(40).optional(),
  country: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(60).optional(),
  preferred: z.enum(["true", "false"]).optional(),
  /** Documents or requirements lapsing within N days. */
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export const vendorContactSchema = z.object({
  name: z.string().trim().min(2, "Contact name is required").max(120),
  email: optionalEmail,
  phone: optionalText(40),
  jobTitle: optionalText(120),
  department: optionalText(120),
  type: z.enum(VENDOR_CONTACT_TYPES).default("GENERAL"),
  isPrimary: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: optionalText(2000),
});

export const updateVendorContactSchema = vendorContactSchema.partial().extend({
  // Defaulted on create; a partial edit must not silently demote a primary
  // contact or reset its type. See the note on updateVendorSchema.
  type: z.enum(VENDOR_CONTACT_TYPES).optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const vendorCategoriesSchema = z.object({
  categoryIds: z.array(z.string().min(1)).max(40),
  preferredCategoryIds: z.array(z.string().min(1)).max(40).default([]),
});

export const vendorDocumentSchema = z.object({
  type: z.enum(VENDOR_DOCUMENT_TYPES),
  name: z.string().trim().min(2, "Document name is required").max(200),
  documentNumber: optionalText(120),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
  notes: optionalText(2000),
  storedFileId: z.string().min(1).optional(),
  /** Replaces an existing document; the superseded row is kept as history. */
  supersedesId: z.string().min(1).optional(),
  /** Attach the document to a compliance requirement in the same call. */
  requirementId: z.string().min(1).optional(),
});

export const verifyDocumentSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  reason: optionalText(500),
});

export const complianceRequirementSchema = z.object({
  type: z.enum(VENDOR_COMPLIANCE_TYPES),
  name: z.string().trim().min(2, "Requirement name is required").max(160),
  description: optionalText(2000),
  isMandatory: z.boolean().default(true),
  expiresAt: optionalDate,
});

export const updateComplianceRequirementSchema = complianceRequirementSchema.partial().extend({
  // Defaulted true on create; a partial edit must not silently make an optional
  // requirement mandatory again.
  isMandatory: z.boolean().optional(),
});

export const complianceDecisionSchema = z
  .object({
    decision: z.enum(["VERIFIED", "REJECTED", "UNDER_REVIEW", "WAIVED"]),
    notes: optionalText(1000),
    expiresAt: optionalDate,
  })
  .refine((v) => v.decision !== "WAIVED" || (v.notes && v.notes.trim().length >= 10), {
    message: "A waiver must record why the requirement is being set aside (at least 10 characters)",
    path: ["notes"],
  });

export const vendorDecisionSchema = z.object({
  stepId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: optionalText(2000),
});

/**
 * Lifecycle actions, as verbs rather than as a target status.
 *
 * The client asks for "suspend", not for "status = SUSPENDED": the service owns
 * which status each verb lands on and which permission it needs, so a caller can
 * never name a state it is not entitled to move a vendor into.
 */
export const VENDOR_ACTIONS = [
  "INVITE",
  "START_ONBOARDING",
  "SUBMIT_FOR_REVIEW",
  "ACTIVATE",
  "SUSPEND",
  "REACTIVATE",
  "DEACTIVATE",
  "ARCHIVE",
  "RESTORE",
  "BLACKLIST",
  "LIFT_BLACKLIST",
  "SET_PREFERRED",
  "CLEAR_PREFERRED",
] as const;

export const vendorActionSchema = z.object({
  action: z.enum(VENDOR_ACTIONS),
  reason: optionalText(500),
});

export const vendorRiskSchema = z.object({
  level: z.enum(VENDOR_RISK_LEVELS),
  score: z.number().min(0).max(100),
  summary: optionalText(2000),
  factors: z.record(z.string().max(40), z.number().min(0).max(100)).optional(),
  nextReviewAt: optionalDate,
});

export const vendorNoteSchema = z.object({
  body: z.string().trim().min(1, "A note cannot be empty").max(4000),
  visibility: z.enum(["INTERNAL", "RESTRICTED"]).default("INTERNAL"),
  isPinned: z.boolean().default(false),
});

export const duplicateCheckSchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  legalName: z.string().trim().max(200).optional(),
  taxNumber: z.string().trim().max(80).optional(),
  registrationNumber: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().max(160).optional(),
  /** Excluded from the results — used when editing an existing vendor. */
  excludeId: z.string().max(60).optional(),
});

export const grantPortalAccessSchema = z.object({
  vendorId: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  contactName: z.string().trim().min(2, "Contact name is required").max(120),
});

// ---------------------------------------------------------------------------
// Budgets, contracts, inventory, assets
// ---------------------------------------------------------------------------

export const createBudgetSchema = z.object({
  departmentId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
  fiscalQuarter: z.number().int().min(1).max(4).optional(),
  totalAmount: money,
  enforceHardLimit: z.boolean().default(false),
  categories: z
    .array(z.object({ name: z.string().trim().min(1).max(100), allocated: money }))
    .max(50)
    .default([]),
  alertThresholds: z.array(z.number().min(1).max(200)).max(10).default([75, 90]),
});

export const createContractSchema = z.object({
  title: z.string().trim().min(3).max(200),
  vendorId: z.string().min(1),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()),
  value: money,
  autoRenew: z.boolean().default(false),
  renewalNoticeDays: z.number().int().min(0).max(365).default(30),
  slaTerms: z.string().trim().max(8000).optional(),
  description: z.string().trim().max(8000).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
});

export const createInventoryItemSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  unit: z.string().trim().min(1).max(40).default("unit"),
  quantity: z.number().finite().min(0).default(0),
  reorderLevel: z.number().finite().min(0).default(0),
  reorderQty: z.number().finite().min(0).default(0),
  unitCost: money.default(0),
  location: z.string().trim().max(200).optional(),
  binLocation: z.string().trim().max(80).optional(),
  supplierId: z.string().optional(),
});

export const stockMovementSchema = z.object({
  type: z.enum(["RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT", "RETURN", "DISPOSAL"]),
  quantity: z.number().finite().refine((v) => v !== 0, "Quantity cannot be zero"),
  reference: z.string().trim().max(120).optional(),
  fromLocation: z.string().trim().max(200).optional(),
  toLocation: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const createAssetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z
    .enum(["IT_EQUIPMENT", "FURNITURE", "VEHICLE", "MACHINERY", "TOOL", "BUILDING", "OTHER"])
    .default("OTHER"),
  serialNumber: z.string().trim().max(120).optional(),
  purchaseOrderId: z.string().optional(),
  vendorId: z.string().optional(),
  departmentId: z.string().optional(),
  branchId: z.string().optional(),
  location: z.string().trim().max(200).optional(),
  purchaseDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  purchaseValue: money.default(0),
  depreciationRate: z.number().min(0).max(100).default(0),
  warrantyExpiry: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const assignAssetSchema = z.object({
  toUserId: z.string().optional(),
  toLocation: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(1, "A reason is required").max(500),
});
