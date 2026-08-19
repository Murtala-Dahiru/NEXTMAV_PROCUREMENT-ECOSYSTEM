// NextMav Procure — Enterprise Domain Types
// Comprehensive type system covering the full P2P lifecycle plus enterprise modules.

export type UserRole =
  | "SUPER_ADMIN"
  | "PROCUREMENT_MANAGER"
  | "FINANCE_OFFICER"
  | "DEPARTMENT_MANAGER"
  | "EMPLOYEE"
  | "AUDITOR";

// Mirrors the RequestStatus enum in prisma/schema.prisma. The fulfilment states
// after APPROVED are derived from receipts and payments, not chosen by a user.
export type RequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "RETURNED"
  | "REJECTED"
  | "CANCELLED"
  | "IN_PROCUREMENT"
  | "ORDERED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CLOSED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type ApprovalStage =
  | "DEPARTMENT_MANAGER"
  | "FINANCE"
  | "PROCUREMENT"
  | "EXECUTIVE";

export type ApprovalDecision =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED"
  | "DELEGATED";

export type VendorStatus = "ACTIVE" | "PROSPECTIVE" | "ARCHIVED" | "BLACKLISTED" | "PREFERRED";

export type RFQStatus = "WAITING" | "RECEIVED" | "EXPIRED" | "CLOSED" | "CANCELLED";

export type PurchaseOrderStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACKNOWLEDGED"
  | "IN_DELIVERY"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export type Currency = "USD" | "EUR" | "GBP" | "NGN" | "KES" | "ZAR" | "GHS" | "AED" | "INR";

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  industry: string;
  country: string;
  currency: Currency;
  taxId: string;
  branding?: BrandingConfig;
  plan: "STARTER" | "GROWTH" | "ENTERPRISE";
  createdAt: string;
}

export interface BrandingConfig {
  primaryColor: string;
  logoUrl?: string;
  customDomain?: string;
}

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  city: string;
  country: string;
  timezone: string;
}

export interface Department {
  id: string;
  organizationId: string;
  branchId?: string;
  name: string;
  budget: number;
  spent: number;
  budgetPeriod: "MONTHLY" | "QUARTERLY" | "ANNUALLY";
}

// ---------------------------------------------------------------------------
// Permissions — granular RBAC
// ---------------------------------------------------------------------------
export type Permission =
  | "requests.view"
  | "requests.create"
  | "requests.edit.own"
  | "requests.edit.all"
  | "requests.cancel"
  | "requests.approve"
  | "requests.reject"
  | "requests.comment"
  | "vendors.view"
  | "vendors.create"
  | "vendors.edit"
  | "vendors.archive"
  | "rfqs.view"
  | "rfqs.create"
  | "rfqs.issue"
  | "rfqs.cancel"
  | "rfqs.selectQuotation"
  | "purchaseOrders.view"
  | "purchaseOrders.create"
  | "purchaseOrders.issue"
  | "purchaseOrders.cancel"
  | "purchaseOrders.updateStatus"
  | "purchaseOrders.approve"
  | "goodsReceipts.view"
  | "goodsReceipts.create"
  | "goodsReceipts.post"
  | "invoices.view"
  | "invoices.create"
  | "invoices.match"
  | "invoices.approve"
  | "invoices.reject"
  | "payments.view"
  | "payments.create"
  | "payments.approve"
  | "payments.process"
  | "payments.reconcile"
  | "inventory.view"
  | "inventory.manage"
  | "assets.view"
  | "assets.manage"
  | "contracts.view"
  | "contracts.manage"
  | "documents.view"
  | "documents.upload"
  | "documents.delete"
  | "reports.view"
  | "reports.export"
  | "budgets.view"
  | "budgets.manage"
  | "users.view"
  | "users.invite"
  | "users.manage"
  | "settings.view"
  | "settings.manage"
  | "settings.roles"
  | "settings.workflows"
  | "settings.integrations"
  | "audit.view"
  | "ai.assistant";

export const PERMISSION_LABELS: Record<Permission, { label: string; category: string; description: string }> = {
  "requests.view": { label: "View Requests", category: "Purchase Requests", description: "View all purchase requests in the organization" },
  "requests.create": { label: "Create Requests", category: "Purchase Requests", description: "Submit new purchase requests" },
  "requests.edit.own": { label: "Edit Own Requests", category: "Purchase Requests", description: "Edit own draft or pending requests" },
  "requests.edit.all": { label: "Edit All Requests", category: "Purchase Requests", description: "Edit any request regardless of requester" },
  "requests.cancel": { label: "Cancel Requests", category: "Purchase Requests", description: "Cancel submitted requests" },
  "requests.approve": { label: "Approve Requests", category: "Purchase Requests", description: "Approve pending requests at any stage" },
  "requests.reject": { label: "Reject Requests", category: "Purchase Requests", description: "Reject pending requests" },
  "requests.comment": { label: "Comment on Requests", category: "Purchase Requests", description: "Add comments to request threads" },
  "vendors.view": { label: "View Vendors", category: "Vendors", description: "View the vendor directory" },
  "vendors.create": { label: "Create Vendors", category: "Vendors", description: "Add new vendors to the directory" },
  "vendors.edit": { label: "Edit Vendors", category: "Vendors", description: "Modify vendor information" },
  "vendors.archive": { label: "Archive Vendors", category: "Vendors", description: "Archive or blacklist vendors" },
  "rfqs.view": { label: "View RFQs", category: "RFQs", description: "View all RFQs" },
  "rfqs.create": { label: "Create RFQs", category: "RFQs", description: "Create new RFQs" },
  "rfqs.issue": { label: "Issue RFQs", category: "RFQs", description: "Send RFQs to vendors" },
  "rfqs.cancel": { label: "Cancel RFQs", category: "RFQs", description: "Cancel pending RFQs" },
  "rfqs.selectQuotation": { label: "Select Quotation", category: "RFQs", description: "Select winning quotation" },
  "purchaseOrders.view": { label: "View Purchase Orders", category: "Purchase Orders", description: "View all POs" },
  "purchaseOrders.create": { label: "Generate Purchase Orders", category: "Purchase Orders", description: "Generate POs from approved RFQs" },
  "purchaseOrders.issue": { label: "Issue Purchase Orders", category: "Purchase Orders", description: "Send POs to vendors" },
  "purchaseOrders.cancel": { label: "Cancel Purchase Orders", category: "Purchase Orders", description: "Cancel issued POs" },
  "purchaseOrders.updateStatus": { label: "Update PO Status", category: "Purchase Orders", description: "Update delivery status of POs" },
  "purchaseOrders.approve": { label: "Approve Purchase Orders", category: "Purchase Orders", description: "Approve a PO before it is issued to the vendor" },
  "goodsReceipts.view": { label: "View Goods Receipts", category: "Receiving", description: "View deliveries recorded against purchase orders" },
  "goodsReceipts.create": { label: "Record Deliveries", category: "Receiving", description: "Record what a vendor actually delivered" },
  "goodsReceipts.post": { label: "Post Receipts", category: "Receiving", description: "Post a receipt to stock and to the asset register" },
  "invoices.view": { label: "View Invoices", category: "Invoices", description: "View vendor invoices" },
  "invoices.create": { label: "Enter Invoices", category: "Invoices", description: "Enter or submit a vendor invoice" },
  "invoices.match": { label: "Match Invoices", category: "Invoices", description: "Run and review the three-way match" },
  "invoices.approve": { label: "Approve Invoices", category: "Invoices", description: "Approve an invoice for payment" },
  "invoices.reject": { label: "Reject Invoices", category: "Invoices", description: "Reject or dispute an invoice" },
  "payments.view": { label: "View Payments", category: "Payments", description: "View payments and the payment position" },
  "payments.create": { label: "Prepare Payments", category: "Payments", description: "Prepare a payment against an approved invoice" },
  "payments.approve": { label: "Approve Payments", category: "Payments", description: "Authorise a payment for release" },
  "payments.process": { label: "Process Payments", category: "Payments", description: "Release an approved payment" },
  "payments.reconcile": { label: "Reconcile Payments", category: "Payments", description: "Reconcile payments against bank records" },
  "inventory.view": { label: "View Inventory", category: "Inventory", description: "View stock levels and movements" },
  "inventory.manage": { label: "Manage Inventory", category: "Inventory", description: "Adjust, transfer and issue stock" },
  "assets.view": { label: "View Assets", category: "Assets", description: "View the asset register" },
  "assets.manage": { label: "Manage Assets", category: "Assets", description: "Assign, transfer, maintain and dispose of assets" },
  "contracts.view": { label: "View Contracts", category: "Contracts", description: "View vendor contracts" },
  "contracts.manage": { label: "Manage Contracts", category: "Contracts", description: "Create, amend, renew and terminate contracts" },
  "documents.view": { label: "View Documents", category: "Documents", description: "View the document library" },
  "documents.upload": { label: "Upload Documents", category: "Documents", description: "Upload and attach documents to records" },
  "documents.delete": { label: "Delete Documents", category: "Documents", description: "Remove documents from the library" },
  "reports.view": { label: "View Reports", category: "Reports", description: "Access spend analytics and reports" },
  "reports.export": { label: "Export Reports", category: "Reports", description: "Export reports as PDF, Excel, or CSV" },
  "budgets.view": { label: "View Budgets", category: "Budgets", description: "View department budgets" },
  "budgets.manage": { label: "Manage Budgets", category: "Budgets", description: "Set and adjust department budgets" },
  "users.view": { label: "View Users", category: "User Management", description: "View team members" },
  "users.invite": { label: "Invite Users", category: "User Management", description: "Send organization invitations" },
  "users.manage": { label: "Manage Users", category: "User Management", description: "Edit user roles and permissions" },
  "settings.view": { label: "View Settings", category: "Settings", description: "View organization settings" },
  "settings.manage": { label: "Manage Settings", category: "Settings", description: "Modify organization settings" },
  "settings.roles": { label: "Manage Roles", category: "Settings", description: "Configure roles and permissions" },
  "settings.workflows": { label: "Manage Workflows", category: "Settings", description: "Configure approval workflows" },
  "settings.integrations": { label: "Manage Integrations", category: "Settings", description: "Configure third-party integrations" },
  "audit.view": { label: "View Audit Log", category: "Security", description: "Access the audit log" },
  "ai.assistant": { label: "Use AI Assistant", category: "AI", description: "Use the AI procurement assistant" },
};

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: Object.keys(PERMISSION_LABELS) as Permission[],
  PROCUREMENT_MANAGER: [
    "requests.view", "requests.create", "requests.edit.all", "requests.cancel", "requests.approve", "requests.reject", "requests.comment",
    "vendors.view", "vendors.create", "vendors.edit", "vendors.archive",
    "rfqs.view", "rfqs.create", "rfqs.issue", "rfqs.cancel", "rfqs.selectQuotation",
    "purchaseOrders.view", "purchaseOrders.create", "purchaseOrders.issue", "purchaseOrders.cancel", "purchaseOrders.updateStatus", "purchaseOrders.approve",
    "goodsReceipts.view", "goodsReceipts.create", "goodsReceipts.post",
    "invoices.view", "invoices.create", "invoices.match",
    "payments.view",
    "inventory.view", "assets.view",
    "contracts.view", "contracts.manage",
    "documents.view", "documents.upload",
    "reports.view", "reports.export", "budgets.view",
    "users.view", "settings.view", "audit.view", "ai.assistant",
  ],
  FINANCE_OFFICER: [
    "requests.view", "requests.approve", "requests.reject", "requests.comment",
    "vendors.view", "rfqs.view", "purchaseOrders.view",
    "goodsReceipts.view",
    "invoices.view", "invoices.create", "invoices.match", "invoices.approve", "invoices.reject",
    "payments.view", "payments.create", "payments.approve", "payments.process", "payments.reconcile",
    "contracts.view", "documents.view", "documents.upload",
    "reports.view", "reports.export", "budgets.view", "budgets.manage",
    "users.view", "audit.view", "ai.assistant",
  ],
  DEPARTMENT_MANAGER: [
    "requests.view", "requests.create", "requests.edit.own", "requests.cancel", "requests.approve", "requests.reject", "requests.comment",
    "vendors.view", "rfqs.view", "purchaseOrders.view",
    "goodsReceipts.view", "invoices.view", "payments.view",
    "inventory.view", "assets.view", "contracts.view", "documents.view",
    "reports.view", "budgets.view",
    "ai.assistant",
  ],
  EMPLOYEE: [
    "requests.view", "requests.create", "requests.edit.own", "requests.cancel", "requests.comment",
    "vendors.view", "rfqs.view", "purchaseOrders.view",
    "documents.view",
    "ai.assistant",
  ],
  AUDITOR: [
    "requests.view", "vendors.view", "rfqs.view", "purchaseOrders.view",
    "goodsReceipts.view", "invoices.view", "payments.view",
    "inventory.view", "assets.view", "contracts.view", "documents.view",
    "reports.view", "reports.export", "budgets.view",
    "users.view", "settings.view", "audit.view",
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ---------------------------------------------------------------------------
// Approval Workflow Engine
// ---------------------------------------------------------------------------
export interface ApprovalWorkflow {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  isActive: boolean;
  stages: ApprovalWorkflowStage[];
  thresholdMin?: number;
  thresholdMax?: number;
  priorityFilter?: Priority[];
  createdAt: string;
}

export interface ApprovalWorkflowStage {
  id: string;
  name: string;
  stage: ApprovalStage;
  approverRole: UserRole;
  slaHours: number;
  escalationRole?: UserRole;
  allowDelegation: boolean;
  isParallel: boolean;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  organizationId: string;
  branchId?: string;
  departmentId?: string;
  email: string;
  name: string;
  role: UserRole;
  jobTitle: string;
  phone?: string;
  avatarColor: string;
  initials: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
  lastLoginAt?: string;
  mfaEnabled: boolean;
  customPermissions?: Permission[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Vendors (expanded with compliance)
// ---------------------------------------------------------------------------
export interface VendorDocument {
  id: string;
  vendorId: string;
  type: "CERTIFICATE" | "INSURANCE" | "TAX" | "CONTRACT" | "BANK_PROOF" | "OTHER";
  name: string;
  fileName: string;
  fileSize: string;
  uploadedAt: string;
  expiresAt?: string;
  status: "VALID" | "EXPIRING" | "EXPIRED" | "PENDING_REVIEW";
}

export interface Vendor {
  id: string;
  organizationId: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  category: string;
  taxNumber: string;
  bankName: string;
  bankAccount: string;
  rating: number;
  status: VendorStatus;
  totalOrders: number;
  totalValue: number;
  paymentTerms: string;
  preferredCurrency: Currency;
  complianceScore: number;
  onTimeDeliveryRate: number;
  qualityRating: number;
  documents: VendorDocument[];
  tags: string[];
  notes: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Purchase Requests (expanded with comments, templates, recurring)
// ---------------------------------------------------------------------------
export interface Comment {
  id: string;
  entityType: "REQUEST" | "PO" | "RFQ" | "VENDOR";
  entityId: string;
  authorId: string;
  content: string;
  mentions: string[];
  createdAt: string;
}

export interface LineItem {
  id: string;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
  taxRate?: number;
}

export interface RequestTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  category: string;
  departmentId?: string;
  priority: Priority;
  defaultLineItems: Omit<LineItem, "id">[];
  defaultJustification: string;
  usageCount: number;
  createdBy: string;
  createdAt: string;
}

export interface RecurringRequest {
  id: string;
  organizationId: string;
  templateName: string;
  baseRequest: Omit<PurchaseRequest, "id" | "requestNumber" | "status" | "createdAt" | "updatedAt" | "approvals">;
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUALLY";
  nextRunAt: string;
  isActive: boolean;
  lastRunAt?: string;
  createdAt: string;
}

export interface PurchaseRequest {
  id: string;
  organizationId: string;
  requestNumber: string;
  title: string;
  departmentId?: string;
  requestedById: string;
  status: RequestStatus;
  priority: Priority;
  category: string;
  tags: string[];
  businessJustification: string;
  neededByDate: string;
  totalEstimated: number;
  currency: Currency;
  attachments: { name: string; size: string; type: string }[];
  lineItems: LineItem[];
  approvals: ApprovalStep[];
  comments: Comment[];
  watchers: string[];
  submittedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ApprovalStep {
  id: string;
  requestId: string;
  stage: ApprovalStage;
  /**
   * Position in the approval chain. Steps sharing a sequence run in parallel and
   * must all approve before the chain advances. Optional because historical rows
   * created before the workflow engine do not carry one.
   */
  sequence?: number;
  approverId: string;
  approverRole: UserRole;
  decision: ApprovalDecision;
  comment?: string;
  delegatedTo?: string;
  decidedAt?: string;
  slaHours: number;
  slaExpiresAt: string;
  isEscalated: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// RFQ + Quotation
// ---------------------------------------------------------------------------
export interface RFQ {
  id: string;
  organizationId: string;
  rfqNumber: string;
  requestId?: string;
  title: string;
  description: string;
  deadline: string;
  status: RFQStatus;
  invitedVendorIds: string[];
  quotations: Quotation[];
  selectedQuotationId?: string;
  remindersSent: number;
  createdAt: string;
}

export interface Quotation {
  id: string;
  rfqId: string;
  vendorId: string;
  totalAmount: number;
  currency: Currency;
  deliveryDays: number;
  warranty: string;
  paymentTerms: string;
  validUntil: string;
  notes: string;
  status: string;
  lineItems?: LineItem[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Purchase Orders (expanded with versioning)
// ---------------------------------------------------------------------------
export interface PurchaseOrder {
  id: string;
  organizationId: string;
  poNumber: string;
  requestId?: string;
  rfqId?: string;
  quotationId?: string;
  vendorId: string;
  status: PurchaseOrderStatus;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  currency: Currency;
  taxRate: number;
  issuedAt: string;
  expectedDelivery: string;
  receivedAt?: string;
  notes?: string;
  termsAndConditions: string;
  lineItems: LineItem[];
  version: number;
  revisions: { version: number; modifiedAt: string; modifiedBy: string; reason: string }[];
  attachments: { name: string; size: string }[];
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export interface Budget {
  id: string;
  organizationId: string;
  departmentId: string;
  fiscalYear: number;
  fiscalQuarter?: number;
  totalAmount: number;
  spentAmount: number;
  committedAmount: number;
  remainingAmount: number;
  categories: BudgetCategory[];
  alerts: { threshold: number; triggered: boolean; triggeredAt?: string }[];
  status: "ACTIVE" | "EXHAUSTED" | "EXCEEDED" | "CLOSED";
  createdAt: string;
}

export interface BudgetCategory {
  name: string;
  allocated: number;
  spent: number;
}

// ---------------------------------------------------------------------------
// Activity + Notifications + Audit
// ---------------------------------------------------------------------------
export interface ActivityLog {
  id: string;
  organizationId: string;
  userId?: string;
  requestId?: string;
  purchaseOrderId?: string;
  rfqId?: string;
  vendorId?: string;
  eventType:
    | "REQUEST_CREATED" | "REQUEST_SUBMITTED" | "REQUEST_APPROVED" | "REQUEST_REJECTED"
    | "REQUEST_COMMENTED" | "REQUEST_CANCELLED" | "REQUEST_COMPLETED"
    | "RFQ_CREATED" | "RFQ_CANCELLED" | "QUOTATION_RECEIVED" | "QUOTATION_SELECTED"
    | "PO_GENERATED" | "PO_ISSUED" | "PO_STATUS_UPDATED" | "PO_REVISED"
    | "VENDOR_ADDED" | "VENDOR_UPDATED" | "VENDOR_ARCHIVED" | "VENDOR_BLACKLISTED"
    | "BUDGET_ALERT" | "WORKFLOW_ESCALATION"
    | "USER_LOGIN" | "USER_LOGOUT" | "USER_INVITED" | "USER_ROLE_CHANGED"
    | "SETTINGS_UPDATED" | "PERMISSION_GRANTED" | "PERMISSION_REVOKED"
    | "STATUS_CHANGE" | "COMMENT_ADDED" | "FILE_UPLOADED"
    | "AI_QUERY" | "AI_SUGGESTION_APPLIED";
  description: string;
  severity: "INFO" | "WARNING" | "CRITICAL" | "SUCCESS";
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "approval" | "error" | "mention" | "budget" | "sla";
  read: boolean;
  link?: string;
  entityId?: string;
  entityType?: string;
  createdAt: string;
}

export interface NotificationPreference {
  userId: string;
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    slack?: boolean;
    teams?: boolean;
    whatsapp?: boolean;
    sms?: boolean;
  };
  categories: {
    approvals: boolean;
    requests: boolean;
    rfqs: boolean;
    purchaseOrders: boolean;
    budgetAlerts: boolean;
    slaWarnings: boolean;
    mentions: boolean;
    weeklyDigest: boolean;
  };
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export interface IntegrationConfig {
  requiredCredentials: { key: string; label: string; type: "string" | "password" | "url" | "select"; required: boolean; placeholder?: string; options?: string[] }[];
  supportedEvents: { key: string; label: string; description: string }[];
  capabilities: string[];
  authType: "OAUTH2" | "API_KEY" | "WEBHOOK" | "BASIC_AUTH" | "NONE";
  docsUrl?: string;
}

export interface IntegrationLog {
  id: string;
  integrationId: string;
  timestamp: string;
  event: string;
  status: "SUCCESS" | "FAILED" | "INFO";
  message: string;
  duration?: number;
}

export interface Integration {
  id: string;
  organizationId: string;
  type: "SLACK" | "TEAMS" | "WHATSAPP" | "SMS" | "EMAIL" | "QUICKBOOKS" | "XERO" | "SAP" | "ORACLE" | "MICROSOFT_DYNAMICS" | "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ZAPIER" | "WEBHOOK" | "CLOUD_STORAGE";
  name: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | "PENDING" | "CONFIGURING";
  configuredBy: string;
  configuredAt: string;
  lastSyncAt?: string;
  lastSyncStatus?: "SUCCESS" | "FAILED";
  lastError?: string;
  config: Record<string, unknown>;
  enabledEvents: string[];
  syncFrequency: "REAL_TIME" | "HOURLY" | "DAILY" | "WEEKLY" | "MANUAL";
  healthStatus: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  logs: IntegrationLog[];
}

// ---------------------------------------------------------------------------
// Saved Views / Filters
// ---------------------------------------------------------------------------
export interface SavedView {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  entityType: "REQUESTS" | "VENDORS" | "POS" | "RFQS";
  filters: Record<string, unknown>;
  isShared: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI Conversation
// ---------------------------------------------------------------------------
export interface AIConversation {
  id: string;
  userId: string;
  messages: { role: "user" | "assistant"; content: string; timestamp: string; suggestions?: string[] }[];
  context?: { entityType?: string; entityId?: string };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Goods Receiving
// ---------------------------------------------------------------------------
export type GoodsReceiptStatus = "PENDING" | "PARTIAL" | "RECEIVED" | "REJECTED";

export interface GoodsReceipt {
  id: string;
  organizationId: string;
  receiptNumber: string;
  poId: string;
  vendorId: string;
  receivedById: string;
  status: GoodsReceiptStatus;
  receivedDate: string;
  notes?: string;
  items: {
    id: string;
    lineItemId: string;
    itemName: string;
    orderedQty: number;
    receivedQty: number;
    unit: string;
    condition: "GOOD" | "DAMAGED" | "MISSING";
    notes?: string;
  }[];
  attachments: { name: string; size: string }[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | "OVERDUE" | "CANCELLED";

export interface Invoice {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  vendorId: string;
  poId?: string;
  goodsReceiptId?: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  currency: Currency;
  paidAmount: number;
  balance: number;
  notes?: string;
  attachments: { name: string; size: string }[];
  approvedById?: string;
  approvedAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export type PaymentStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "REFUNDED";
export type PaymentMethod = "BANK_TRANSFER" | "CHEQUE" | "CASH" | "CARD" | "MOBILE_MONEY" | "WIRE";

export interface Payment {
  id: string;
  organizationId: string;
  paymentNumber: string;
  invoiceId: string;
  vendorId: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  paymentDate: string;
  reference?: string;
  notes?: string;
  processedById: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------
export type ContractStatus = "DRAFT" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "TERMINATED" | "RENEWED";

export interface Contract {
  id: string;
  organizationId: string;
  contractNumber: string;
  title: string;
  vendorId: string;
  poId?: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  value: number;
  currency: Currency;
  autoRenew: boolean;
  renewalNoticeDays: number;
  slaTerms?: string;
  description?: string;
  tags: string[];
  attachments: { name: string; size: string }[];
  versions: { version: number; modifiedAt: string; modifiedBy: string; reason: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export type AssetStatus = "IN_USE" | "IN_STORAGE" | "UNDER_REPAIR" | "RETIRED" | "LOST" | "ASSIGNED";
export type AssetCategory = "IT_EQUIPMENT" | "FURNITURE" | "VEHICLE" | "MACHINERY" | "TOOL" | "BUILDING" | "OTHER";

export interface Asset {
  id: string;
  organizationId: string;
  assetTag: string;
  name: string;
  category: AssetCategory;
  serialNumber?: string;
  poId?: string;
  vendorId?: string;
  assignedToId?: string;
  departmentId?: string;
  branchId?: string;
  location?: string;
  status: AssetStatus;
  purchaseDate: string;
  purchaseValue: number;
  currentValue: number;
  currency: Currency;
  warrantyExpiry?: string;
  depreciationRate: number;
  qrCode?: string;
  notes?: string;
  maintenanceHistory: {
    id: string;
    date: string;
    type: "PREVENTIVE" | "REPAIR" | "INSPECTION" | "UPGRADE";
    description: string;
    cost: number;
    performedBy?: string;
  }[];
  transfers: {
    id: string;
    date: string;
    fromUserId?: string;
    toUserId?: string;
    fromLocation?: string;
    toLocation?: string;
    reason: string;
  }[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export type StockMovementType = "RECEIPT" | "ISSUE" | "TRANSFER" | "ADJUSTMENT" | "RETURN" | "DISPOSAL";

export interface InventoryItem {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  reorderQty: number;
  unitCost: number;
  currency: Currency;
  location?: string;
  binLocation?: string;
  lastRestockDate?: string;
  supplierId?: string;
  movements: StockMovement[];
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  reference?: string;
  poId?: string;
  notes?: string;
  performedById: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Supplier Portal
// ---------------------------------------------------------------------------
export type SupplierPortalAccess = "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface SupplierPortalUser {
  id: string;
  vendorId: string;
  email: string;
  contactName: string;
  accessStatus: SupplierPortalAccess;
  lastLoginAt?: string;
  createdAt: string;
}

export interface SupplierActivity {
  id: string;
  vendorId: string;
  type: "RFQ_RECEIVED" | "QUOTE_SUBMITTED" | "PO_ACKNOWLEDGED" | "DELIVERY_CONFIRMED" | "INVOICE_SUBMITTED" | "PAYMENT_RECEIVED" | "MESSAGE_RECEIVED" | "DOCUMENT_UPLOADED";
  description: string;
  referenceId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Document Management
// ---------------------------------------------------------------------------
export type DocumentCategory = "PURCHASE_ORDER" | "CONTRACT" | "INVOICE" | "QUOTATION" | "DELIVERY_NOTE" | "CERTIFICATE" | "POLICY" | "ATTACHMENT" | "OTHER";

export interface DocumentRecord {
  id: string;
  organizationId: string;
  name: string;
  category: DocumentCategory;
  mimeType: string;
  fileSize: string;
  uploadedById: string;
  tags: string[];
  linkedEntityType?: "REQUEST" | "PO" | "RFQ" | "VENDOR" | "CONTRACT" | "INVOICE" | "ASSET";
  linkedEntityId?: string;
  versions: { version: number; uploadedAt: string; uploadedBy: string; size: string }[];
  currentVersion: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Digital Signatures
// ---------------------------------------------------------------------------
export interface DigitalSignature {
  id: string;
  entityType: "PO" | "CONTRACT" | "REQUEST" | "INVOICE";
  entityId: string;
  signerId: string;
  signerName: string;
  signerRole: UserRole;
  signedAt: string;
  signatureMethod: "CLICK_SIGN" | "OTP" | "CERTIFICATE" | "BIO_METRIC";
  ipAddress: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  PROCUREMENT_MANAGER: "Procurement Manager",
  FINANCE_OFFICER: "Finance Officer",
  DEPARTMENT_MANAGER: "Department Manager",
  EMPLOYEE: "Employee",
  AUDITOR: "Auditor",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: "Full system access and organization configuration",
  PROCUREMENT_MANAGER: "Manages vendors, RFQs, and purchase orders",
  FINANCE_OFFICER: "Reviews and approves financial commitments",
  DEPARTMENT_MANAGER: "Approves team purchase requests",
  EMPLOYEE: "Creates and tracks purchase requests",
  AUDITOR: "Read-only access to all procurement activity",
};

export const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  PROCUREMENT_MANAGER: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  FINANCE_OFFICER: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  DEPARTMENT_MANAGER: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  EMPLOYEE: "bg-muted text-muted-foreground border-border",
  AUDITOR: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800",
};

export const STATUS_META: Record<RequestStatus, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  SUBMITTED: { label: "Submitted", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900", dot: "bg-blue-500" },
  UNDER_REVIEW: { label: "Under Review", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  APPROVED: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  REJECTED: { label: "Rejected", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  CANCELLED: { label: "Cancelled", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/30" },
  RETURNED: { label: "Returned for Revision", color: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900", dot: "bg-orange-500" },
  IN_PROCUREMENT: { label: "In Procurement", color: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900", dot: "bg-indigo-500" },
  ORDERED: { label: "Ordered", color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900", dot: "bg-violet-500" },
  PARTIALLY_FULFILLED: { label: "Partially Fulfilled", color: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900", dot: "bg-cyan-500" },
  FULFILLED: { label: "Fulfilled", color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900", dot: "bg-teal-500" },
  CLOSED: { label: "Closed", color: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800", dot: "bg-slate-500" },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string; dot: string }> = {
  LOW: { label: "Low", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  MEDIUM: { label: "Medium", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  HIGH: { label: "High", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  URGENT: { label: "Urgent", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
};

export const PO_STATUS_META: Record<PurchaseOrderStatus, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  ISSUED: { label: "Issued", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  ACKNOWLEDGED: { label: "Acknowledged", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  IN_DELIVERY: { label: "In Delivery", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  RECEIVED: { label: "Received", color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900", dot: "bg-teal-500" },
  CLOSED: { label: "Closed", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/30" },
  CANCELLED: { label: "Cancelled", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
};

export const RFQ_STATUS_META: Record<RFQStatus, { label: string; color: string; dot: string }> = {
  WAITING: { label: "Waiting", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  RECEIVED: { label: "Received", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  EXPIRED: { label: "Expired", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  CLOSED: { label: "Closed", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/30" },
  CANCELLED: { label: "Cancelled", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
};

export const VENDOR_STATUS_META: Record<VendorStatus, { label: string; color: string; dot: string }> = {
  ACTIVE: { label: "Active", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  PROSPECTIVE: { label: "Prospective", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  ARCHIVED: { label: "Archived", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
  BLACKLISTED: { label: "Blacklisted", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  PREFERRED: { label: "Preferred", color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900", dot: "bg-violet-500" },
};

export const CURRENCY_META: Record<Currency, { symbol: string; label: string; flag: string }> = {
  USD: { symbol: "$", label: "US Dollar", flag: "🇺🇸" },
  EUR: { symbol: "€", label: "Euro", flag: "🇪🇺" },
  GBP: { symbol: "£", label: "British Pound", flag: "🇬🇧" },
  NGN: { symbol: "₦", label: "Nigerian Naira", flag: "🇳🇬" },
  KES: { symbol: "KSh", label: "Kenyan Shilling", flag: "🇰🇪" },
  ZAR: { symbol: "R", label: "South African Rand", flag: "🇿🇦" },
  GHS: { symbol: "₵", label: "Ghanaian Cedi", flag: "🇬🇭" },
  AED: { symbol: "AED", label: "UAE Dirham", flag: "🇦🇪" },
  INR: { symbol: "₹", label: "Indian Rupee", flag: "🇮🇳" },
};

// New status metadata for enterprise modules
export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  SUBMITTED: { label: "Submitted", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900", dot: "bg-blue-500" },
  APPROVED: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  REJECTED: { label: "Rejected", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  PAID: { label: "Paid", color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900", dot: "bg-teal-500" },
  OVERDUE: { label: "Overdue", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  CANCELLED: { label: "Cancelled", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/30" },
};

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; color: string; dot: string }> = {
  PENDING: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  PROCESSING: { label: "Processing", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  COMPLETED: { label: "Completed", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  FAILED: { label: "Failed", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  REFUNDED: { label: "Refunded", color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900", dot: "bg-violet-500" },
};

export const CONTRACT_STATUS_META: Record<ContractStatus, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  ACTIVE: { label: "Active", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  EXPIRING: { label: "Expiring", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  EXPIRED: { label: "Expired", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  TERMINATED: { label: "Terminated", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
  RENEWED: { label: "Renewed", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
};

export const ASSET_STATUS_META: Record<AssetStatus, { label: string; color: string; dot: string }> = {
  IN_USE: { label: "In Use", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  IN_STORAGE: { label: "In Storage", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  UNDER_REPAIR: { label: "Under Repair", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  RETIRED: { label: "Retired", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
  LOST: { label: "Lost", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  ASSIGNED: { label: "Assigned", color: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900", dot: "bg-violet-500" },
};

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  IT_EQUIPMENT: "IT Equipment",
  FURNITURE: "Furniture",
  VEHICLE: "Vehicle",
  MACHINERY: "Machinery",
  TOOL: "Tool",
  BUILDING: "Building",
  OTHER: "Other",
};

export const GOODS_RECEIPT_STATUS_META: Record<GoodsReceiptStatus, { label: string; color: string; dot: string }> = {
  PENDING: { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  PARTIAL: { label: "Partial", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  RECEIVED: { label: "Received", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  REJECTED: { label: "Rejected", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  PURCHASE_ORDER: "Purchase Order",
  CONTRACT: "Contract",
  INVOICE: "Invoice",
  QUOTATION: "Quotation",
  DELIVERY_NOTE: "Delivery Note",
  CERTIFICATE: "Certificate",
  POLICY: "Policy",
  ATTACHMENT: "Attachment",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------
// Integration Configuration Registry
// Real integration configs with required credentials and supported events
// ---------------------------------------------------------------------------
export const INTEGRATION_CONFIGS: Record<string, IntegrationConfig & { name: string; category: string; description: string; icon: string }> = {
  SLACK: {
    name: "Slack",
    category: "Communication",
    description: "Send procurement notifications to Slack channels and enable approval actions via Slack.",
    icon: "MessageSquare",
    authType: "OAUTH2",
    docsUrl: "https://api.slack.com/docs",
    requiredCredentials: [
      { key: "clientId", label: "Client ID", type: "string", required: true, placeholder: "1234567890.12345678" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "workspace", label: "Workspace Name", type: "string", required: true, placeholder: "your-company" },
      { key: "defaultChannel", label: "Default Channel", type: "string", required: true, placeholder: "#procurement" },
    ],
    supportedEvents: [
      { key: "REQUEST_SUBMITTED", label: "Request Submitted", description: "Notify when a new purchase request is submitted" },
      { key: "REQUEST_APPROVED", label: "Request Approved", description: "Notify when a request is approved" },
      { key: "PO_GENERATED", label: "PO Generated", description: "Notify when a purchase order is issued" },
      { key: "BUDGET_ALERT", label: "Budget Alert", description: "Notify when budget thresholds are exceeded" },
      { key: "SLA_WARNING", label: "SLA Warning", description: "Notify when approval SLA is at risk" },
    ],
    capabilities: ["Notifications", "Approval Actions", "Daily Digest"],
  },
  TEAMS: {
    name: "Microsoft Teams",
    category: "Communication",
    description: "Send notifications and enable approval workflows directly in Microsoft Teams.",
    icon: "MessageSquare",
    authType: "OAUTH2",
    docsUrl: "https://docs.microsoft.com/teams",
    requiredCredentials: [
      { key: "tenantId", label: "Azure Tenant ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientId", label: "Application Client ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "teamId", label: "Team ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "channelId", label: "Channel ID", type: "string", required: true, placeholder: "19:00000000000000000000000000000000@thread.tacv2" },
    ],
    supportedEvents: [
      { key: "REQUEST_SUBMITTED", label: "Request Submitted", description: "Notify channel of new requests" },
      { key: "REQUEST_APPROVED", label: "Request Approved", description: "Notify on approvals" },
      { key: "PO_GENERATED", label: "PO Generated", description: "Notify on new POs" },
      { key: "BUDGET_ALERT", label: "Budget Alert", description: "Alert on budget thresholds" },
    ],
    capabilities: ["Notifications", "Adaptive Cards", "Approval Actions"],
  },
  QUICKBOOKS: {
    name: "QuickBooks Online",
    category: "Accounting",
    description: "Sync purchase orders and invoices with QuickBooks Online for automatic bookkeeping.",
    icon: "CreditCard",
    authType: "OAUTH2",
    docsUrl: "https://developer.intuit.com",
    requiredCredentials: [
      { key: "clientId", label: "Client ID", type: "string", required: true, placeholder: "Q0ID1234567890" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "realmId", label: "Company Realm ID", type: "string", required: true, placeholder: "1234567890" },
      { key: "environment", label: "Environment", type: "select", required: true, options: ["Production", "Sandbox"] },
    ],
    supportedEvents: [
      { key: "PO_ISSUED", label: "Sync PO to QuickBooks", description: "Create bill in QuickBooks when PO is issued" },
      { key: "INVOICE_SYNC", label: "Sync Invoices", description: "Sync vendor invoices to QuickBooks" },
      { key: "PAYMENT_SYNC", label: "Sync Payments", description: "Record payments in QuickBooks" },
    ],
    capabilities: ["Bill Creation", "Invoice Sync", "Payment Recording", "Vendor Sync"],
  },
  XERO: {
    name: "Xero",
    category: "Accounting",
    description: "Sync purchase orders, invoices, and payments with Xero accounting software.",
    icon: "CreditCard",
    authType: "OAUTH2",
    docsUrl: "https://developer.xero.com",
    requiredCredentials: [
      { key: "clientId", label: "Client ID", type: "string", required: true, placeholder: "ABC123DEF456" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "tenantId", label: "Tenant ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
    ],
    supportedEvents: [
      { key: "PO_ISSUED", label: "Sync PO to Xero", description: "Create purchase order in Xero" },
      { key: "INVOICE_SYNC", label: "Sync Invoices", description: "Sync vendor invoices" },
      { key: "PAYMENT_SYNC", label: "Sync Payments", description: "Record payments" },
    ],
    capabilities: ["PO Creation", "Invoice Sync", "Payment Recording", "Contact Sync"],
  },
  SAP: {
    name: "SAP ERP",
    category: "ERP",
    description: "Bi-directional sync with SAP ERP for purchase orders, goods receipts, and invoice verification.",
    icon: "Cloud",
    authType: "BASIC_AUTH",
    docsUrl: "https://api.sap.com",
    requiredCredentials: [
      { key: "apiUrl", label: "SAP API Base URL", type: "url", required: true, placeholder: "https://your-sap-server.com/api" },
      { key: "username", label: "API Username", type: "string", required: true, placeholder: "SAP_USER" },
      { key: "password", label: "API Password", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "companyCode", label: "Company Code", type: "string", required: true, placeholder: "1000" },
    ],
    supportedEvents: [
      { key: "PO_SYNC", label: "Sync POs", description: "Sync purchase orders to SAP" },
      { key: "GR_SYNC", label: "Sync Goods Receipts", description: "Sync goods receipts to SAP" },
      { key: "INVOICE_VERIFY", label: "Invoice Verification", description: "Sync invoices for verification" },
    ],
    capabilities: ["PO Sync", "Goods Receipt Sync", "Invoice Verification", "Vendor Master Sync"],
  },
  ORACLE: {
    name: "Oracle ERP Cloud",
    category: "ERP",
    description: "Integrate with Oracle ERP Cloud for procurement document sync and financial reporting.",
    icon: "Cloud",
    authType: "OAUTH2",
    docsUrl: "https://docs.oracle.com/erp",
    requiredCredentials: [
      { key: "instanceUrl", label: "Oracle Instance URL", type: "url", required: true, placeholder: "https://your-instance.oraclecloud.com" },
      { key: "clientId", label: "Client ID", type: "string", required: true, placeholder: "abc123def456" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "scope", label: "Scope", type: "string", required: true, placeholder: "https://your-instance.oraclecloud.com/procurement" },
    ],
    supportedEvents: [
      { key: "PO_SYNC", label: "Sync POs", description: "Sync purchase orders" },
      { key: "SUPPLIER_SYNC", label: "Sync Suppliers", description: "Sync supplier master data" },
    ],
    capabilities: ["PO Sync", "Supplier Sync", "Financial Reports"],
  },
  MICROSOFT_DYNAMICS: {
    name: "Microsoft Dynamics 365",
    category: "ERP",
    description: "Connect to Dynamics 365 Finance & Operations for procurement and payables sync.",
    icon: "Cloud",
    authType: "OAUTH2",
    docsUrl: "https://docs.microsoft.com/dynamics365",
    requiredCredentials: [
      { key: "resourceUrl", label: "Dynamics Resource URL", type: "url", required: true, placeholder: "https://your-instance.operations.dynamics.com" },
      { key: "tenantId", label: "Azure Tenant ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientId", label: "Application Client ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
    ],
    supportedEvents: [
      { key: "PO_SYNC", label: "Sync POs", description: "Sync purchase orders" },
      { key: "VENDOR_SYNC", label: "Sync Vendors", description: "Sync vendor records" },
    ],
    capabilities: ["PO Sync", "Vendor Sync", "Invoice Matching"],
  },
  GOOGLE_WORKSPACE: {
    name: "Google Workspace",
    category: "Productivity",
    description: "Single Sign-On and document storage via Google Workspace integration.",
    icon: "Mail",
    authType: "OAUTH2",
    docsUrl: "https://developers.google.com/workspace",
    requiredCredentials: [
      { key: "clientId", label: "OAuth Client ID", type: "string", required: true, placeholder: "123456789-abc.apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "domain", label: "Workspace Domain", type: "string", required: true, placeholder: "yourcompany.com" },
    ],
    supportedEvents: [
      { key: "SSO", label: "Single Sign-On", description: "Enable Google SSO for users" },
      { key: "DRIVE_SYNC", label: "Drive Document Sync", description: "Sync documents to Google Drive" },
    ],
    capabilities: ["SSO", "Drive Storage", "Gmail Notifications"],
  },
  MICROSOFT_365: {
    name: "Microsoft 365",
    category: "Productivity",
    description: "Single Sign-On, Outlook email, and OneDrive document storage integration.",
    icon: "Mail",
    authType: "OAUTH2",
    docsUrl: "https://docs.microsoft.com/graph",
    requiredCredentials: [
      { key: "tenantId", label: "Azure Tenant ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientId", label: "Application Client ID", type: "string", required: true, placeholder: "00000000-0000-0000-0000-000000000000" },
      { key: "clientSecret", label: "Client Secret", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "domain", label: "Domain", type: "string", required: true, placeholder: "yourcompany.onmicrosoft.com" },
    ],
    supportedEvents: [
      { key: "SSO", label: "Single Sign-On", description: "Enable Microsoft SSO" },
      { key: "EMAIL_NOTIFICATIONS", label: "Email Notifications", description: "Send notifications via Outlook" },
      { key: "ONEDRIVE_SYNC", label: "OneDrive Sync", description: "Sync documents to OneDrive" },
    ],
    capabilities: ["SSO", "Email", "OneDrive Storage", "Teams Notifications"],
  },
  WHATSAPP: {
    name: "WhatsApp Business",
    category: "Communication",
    description: "Send procurement notifications and approval reminders via WhatsApp Business API.",
    icon: "MessageCircle",
    authType: "API_KEY",
    docsUrl: "https://business.whatsapp.com/developers/developer-hub",
    requiredCredentials: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "string", required: true, placeholder: "1234567890" },
      { key: "accessToken", label: "Access Token", type: "password", required: true, placeholder: "EAAG..." },
      { key: "verifyToken", label: "Webhook Verify Token", type: "password", required: true, placeholder: "your_verify_token" },
    ],
    supportedEvents: [
      { key: "APPROVAL_REMINDER", label: "Approval Reminders", description: "Send approval reminders to approvers" },
      { key: "PO_NOTIFICATION", label: "PO Notifications", description: "Notify vendors of new POs" },
      { key: "PAYMENT_CONFIRMATION", label: "Payment Confirmation", description: "Confirm payments to vendors" },
    ],
    capabilities: ["Notifications", "Vendor Messaging", "Approval Reminders"],
  },
  SMS: {
    name: "SMS Gateway",
    category: "Communication",
    description: "Send SMS notifications for urgent approvals and critical alerts.",
    icon: "MessageCircle",
    authType: "API_KEY",
    docsUrl: "https://www.twilio.com/docs",
    requiredCredentials: [
      { key: "provider", label: "Provider", type: "select", required: true, options: ["Twilio", "Vonage", "Africastalking", "Custom"] },
      { key: "apiKey", label: "API Key / SID", type: "string", required: true, placeholder: "AC1234567890abcdef" },
      { key: "apiSecret", label: "API Secret / Token", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "senderId", label: "Sender ID", type: "string", required: true, placeholder: "NEXTMAV" },
    ],
    supportedEvents: [
      { key: "URGENT_APPROVAL", label: "Urgent Approvals", description: "SMS for urgent approval requests" },
      { key: "CRITICAL_ALERT", label: "Critical Alerts", description: "SMS for critical system alerts" },
    ],
    capabilities: ["SMS Notifications", "Delivery Receipts"],
  },
  EMAIL: {
    name: "Email (SMTP)",
    category: "Communication",
    description: "Custom SMTP server for email notifications, reports, and document delivery.",
    icon: "Mail",
    authType: "BASIC_AUTH",
    docsUrl: "https://nodemailer.com/smtp",
    requiredCredentials: [
      { key: "host", label: "SMTP Host", type: "string", required: true, placeholder: "smtp.gmail.com" },
      { key: "port", label: "Port", type: "string", required: true, placeholder: "587" },
      { key: "username", label: "Username", type: "string", required: true, placeholder: "procurement@yourcompany.com" },
      { key: "password", label: "Password", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "fromEmail", label: "From Email", type: "string", required: true, placeholder: "procurement@yourcompany.com" },
      { key: "encryption", label: "Encryption", type: "select", required: true, options: ["TLS", "SSL", "None"] },
    ],
    supportedEvents: [
      { key: "ALL_NOTIFICATIONS", label: "All Notifications", description: "Send all notifications via email" },
      { key: "REPORT_DELIVERY", label: "Report Delivery", description: "Email scheduled reports" },
      { key: "DOCUMENT_DELIVERY", label: "Document Delivery", description: "Email POs and invoices to vendors" },
    ],
    capabilities: ["Email Notifications", "Report Delivery", "Document Delivery", "Custom Templates"],
  },
  CLOUD_STORAGE: {
    name: "Cloud Storage",
    category: "Storage",
    description: "Store procurement documents in AWS S3, Google Cloud Storage, or Azure Blob.",
    icon: "Cloud",
    authType: "API_KEY",
    docsUrl: "https://aws.amazon.com/s3",
    requiredCredentials: [
      { key: "provider", label: "Provider", type: "select", required: true, options: ["AWS S3", "Google Cloud Storage", "Azure Blob", "MinIO"] },
      { key: "bucket", label: "Bucket Name", type: "string", required: true, placeholder: "nextmav-documents" },
      { key: "accessKey", label: "Access Key", type: "string", required: true, placeholder: "AKIAIOSFODNN7EXAMPLE" },
      { key: "secretKey", label: "Secret Key", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "region", label: "Region", type: "string", required: true, placeholder: "us-east-1" },
    ],
    supportedEvents: [
      { key: "DOCUMENT_UPLOAD", label: "Document Upload", description: "Upload documents to cloud storage" },
      { key: "BACKUP", label: "Automated Backup", description: "Daily backup of all documents" },
    ],
    capabilities: ["Document Storage", "Automated Backup", "Version Control", "Access Control"],
  },
  WEBHOOK: {
    name: "Custom Webhook",
    category: "Automation",
    description: "Send HTTP webhooks to external systems for custom integrations and automation.",
    icon: "Webhook",
    authType: "WEBHOOK",
    docsUrl: "https://developer.mozilla.org/docs/Web/API/Webhook",
    requiredCredentials: [
      { key: "url", label: "Webhook URL", type: "url", required: true, placeholder: "https://your-server.com/webhooks/procurement" },
      { key: "secret", label: "Signing Secret", type: "password", required: true, placeholder: "whsec_••••••••••••" },
      { key: "retryCount", label: "Retry Count", type: "string", required: true, placeholder: "3" },
    ],
    supportedEvents: [
      { key: "PO_ISSUED", label: "PO Issued", description: "Trigger when PO is issued" },
      { key: "PO_RECEIVED", label: "PO Received", description: "Trigger when goods are received" },
      { key: "INVOICE_PAID", label: "Invoice Paid", description: "Trigger when invoice is paid" },
      { key: "VENDOR_ADDED", label: "Vendor Added", description: "Trigger when vendor is created" },
      { key: "BUDGET_EXCEEDED", label: "Budget Exceeded", description: "Trigger when budget is exceeded" },
    ],
    capabilities: ["HTTP Webhooks", "HMAC Signatures", "Retry Logic", "Event Filtering"],
  },
  ZAPIER: {
    name: "Zapier",
    category: "Automation",
    description: "Connect to 5,000+ apps via Zapier automation platform.",
    icon: "Zap",
    authType: "API_KEY",
    docsUrl: "https://zapier.com/developer",
    requiredCredentials: [
      { key: "apiKey", label: "Zapier API Key", type: "password", required: true, placeholder: "••••••••••••••••" },
      { key: "webhookUrl", label: "Zap Webhook URL", type: "url", required: true, placeholder: "https://hooks.zapier.com/hooks/catch/123456/abcdef" },
    ],
    supportedEvents: [
      { key: "ALL_EVENTS", label: "All Events", description: "Forward all procurement events to Zapier" },
    ],
    capabilities: ["5,000+ App Integrations", "Custom Workflows", "Event Forwarding"],
  },
};

