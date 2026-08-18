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
// RFQ / sourcing
// ---------------------------------------------------------------------------

export const rfqLineItemSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
});

export const createRfqSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().default(""),
  deadline: z.string().datetime({ offset: true }).or(z.string().date()),
  requestId: z.string().optional(),
  invitedVendorIds: z.array(z.string()).min(1, "Invite at least one supplier").max(50),
  // Optional: when an RFQ is raised from an approved request, the lines are
  // derived from that request rather than re-keyed.
  lineItems: z.array(rfqLineItemSchema).max(200).optional(),
});

export const quotationLineItemSchema = z.object({
  rfqLineItemId: z.string().optional(),
  itemName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  quantity: positiveQty,
  unit: z.string().trim().min(1).max(40).default("unit"),
  unitPrice: money,
  taxRate: z.number().min(0).max(100).default(0),
});

export const submitQuotationSchema = z.object({
  deliveryDays: z.number().int().min(0).max(3650),
  warranty: z.string().trim().max(500).optional().default(""),
  paymentTerms: z.string().trim().max(200).optional().default(""),
  validUntil: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  notes: z.string().trim().max(2000).optional().default(""),
  lineItems: z.array(quotationLineItemSchema).min(1).max(200),
});

export const evaluateQuotationSchema = z.object({
  evaluationScore: z.number().min(0).max(100),
  evaluationNotes: z.string().trim().max(2000).optional().default(""),
});

export const awardRfqSchema = z.object({
  quotationId: z.string().min(1, "Select the winning quotation"),
  justification: z.string().trim().max(2000).optional().default(""),
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
  receivedQty: z.number().finite().min(0),
  rejectedQty: z.number().finite().min(0).default(0),
  condition: z.enum(["GOOD", "DAMAGED", "MISSING"]).default("GOOD"),
  notes: z.string().trim().max(1000).optional(),
});

export const createReceiptSchema = z.object({
  purchaseOrderId: z.string().min(1),
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
  "ACTIVE",
  "PROSPECTIVE",
  "ARCHIVED",
  "BLACKLISTED",
  "PREFERRED",
] as const;

export const createVendorSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(200),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(400).optional(),
  category: z.string().trim().max(100).optional(),
  taxNumber: z.string().trim().max(80).optional(),
  bankName: z.string().trim().max(120).optional(),
  bankAccount: z.string().trim().max(80).optional(),
  paymentTerms: z.string().trim().max(60).default("NET_30"),
  preferredCurrency: z.string().trim().max(8).default("USD"),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  notes: z.string().trim().max(4000).optional(),
});

export const updateVendorSchema = createVendorSchema.partial();

export const vendorStatusSchema = z.object({
  status: z.enum(VENDOR_STATUSES),
  reason: z.string().trim().max(500).optional(),
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
