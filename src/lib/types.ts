// NextMav Procure — Domain Types
// Canonical type definitions for the entire Procure-to-Pay workflow.

export type UserRole =
  | "SUPER_ADMIN"
  | "PROCUREMENT_MANAGER"
  | "FINANCE_OFFICER"
  | "DEPARTMENT_MANAGER"
  | "EMPLOYEE"
  | "AUDITOR";

export type RequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";

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
  | "CHANGES_REQUESTED";

export type VendorStatus = "ACTIVE" | "PROSPECTIVE" | "ARCHIVED" | "BLACKLISTED";

export type RFQStatus = "WAITING" | "RECEIVED" | "EXPIRED" | "CLOSED";

export type PurchaseOrderStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACKNOWLEDGED"
  | "IN_DELIVERY"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  industry: string;
  country: string;
  currency: string;
  taxId: string;
}

export interface Branch {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  city: string;
  country: string;
}

export interface Department {
  id: string;
  organizationId: string;
  branchId?: string;
  name: string;
  budget: number;
  spent: number;
}

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
  createdAt: string;
}

export interface LineItem {
  id: string;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
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
  businessJustification: string;
  neededByDate: string;
  totalEstimated: number;
  currency: string;
  attachments: { name: string; size: string }[];
  lineItems: LineItem[];
  approvals: ApprovalStep[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface ApprovalStep {
  id: string;
  requestId: string;
  stage: ApprovalStage;
  approverId: string;
  decision: ApprovalDecision;
  comment?: string;
  decidedAt?: string;
  createdAt: string;
}

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
  createdAt: string;
  selectedQuotationId?: string;
}

export interface Quotation {
  id: string;
  rfqId: string;
  vendorId: string;
  totalAmount: number;
  currency: string;
  deliveryDays: number;
  warranty: string;
  paymentTerms: string;
  validUntil: string;
  notes: string;
  status: string;
  createdAt: string;
}

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
  currency: string;
  taxRate: number;
  issuedAt: string;
  expectedDelivery: string;
  notes?: string;
  lineItems: LineItem[];
}

export interface ActivityLog {
  id: string;
  organizationId: string;
  userId?: string;
  requestId?: string;
  purchaseOrderId?: string;
  eventType:
    | "REQUEST_CREATED"
    | "REQUEST_SUBMITTED"
    | "REQUEST_APPROVED"
    | "REQUEST_REJECTED"
    | "RFQ_CREATED"
    | "QUOTATION_RECEIVED"
    | "PO_GENERATED"
    | "VENDOR_ADDED"
    | "STATUS_CHANGE"
    | "COMMENT_ADDED";
  description: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "approval" | "error";
  read: boolean;
  link?: string;
  createdAt: string;
}

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

export const STATUS_META: Record<RequestStatus, { label: string; color: string; dot: string }> = {
  DRAFT: { label: "Draft", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/50" },
  SUBMITTED: { label: "Submitted", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900", dot: "bg-blue-500" },
  UNDER_REVIEW: { label: "Under Review", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900", dot: "bg-amber-500" },
  APPROVED: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  REJECTED: { label: "Rejected", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
  CANCELLED: { label: "Cancelled", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/30" },
  COMPLETED: { label: "Completed", color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900", dot: "bg-teal-500" },
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
};

export const VENDOR_STATUS_META: Record<VendorStatus, { label: string; color: string; dot: string }> = {
  ACTIVE: { label: "Active", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900", dot: "bg-emerald-500" },
  PROSPECTIVE: { label: "Prospective", color: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900", dot: "bg-sky-500" },
  ARCHIVED: { label: "Archived", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
  BLACKLISTED: { label: "Blacklisted", color: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900", dot: "bg-rose-500" },
};
