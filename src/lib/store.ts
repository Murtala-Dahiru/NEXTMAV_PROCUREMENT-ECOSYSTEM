// NextMav Procure — Enterprise Zustand store
// Central state management with full P2P workflow, permissions, comments,
// templates, budgets, vendor compliance, audit logging, and more.

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActivityLog,
  ApprovalDecision,
  ApprovalStage,
  ApprovalWorkflow,
  Asset,
  AuditLogEntry,
  Budget,
  Branch,
  Comment,
  Contract,
  Department,
  DigitalSignature,
  DocumentCategory,
  DocumentRecord,
  GoodsReceipt,
  GoodsReceiptStatus,
  Integration,
  InventoryItem,
  Invoice,
  InvoiceStatus,
  LineItem,
  Notification,
  NotificationPreference,
  Organization,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Permission,
  Priority,
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseRequest,
  RFQ,
  RequestTemplate,
  SavedView,
  StockMovementType,
  SupplierActivity,
  SupplierPortalUser,
  User,
  Vendor,
  VendorDocument,
  UserRole,
} from "./types";
import { hasPermission, ROLE_PERMISSIONS } from "./types";
import {
  seedActivities,
  seedAssets,
  seedAuditLogs,
  seedBranches,
  seedBudgets,
  seedContracts,
  seedDepartments,
  seedDocuments,
  seedGoodsReceipts,
  seedIntegrations,
  seedInventory,
  seedInvoices,
  seedNotificationPreference,
  seedNotifications,
  seedOrganization,
  seedPayments,
  seedPurchaseOrders,
  seedRequests,
  seedRFQs,
  seedSupplierActivities,

  seedTemplates,
  seedUsers,

  seedWorkflows,
} from "./seed-data";
import { generateId, generatePoNumber, generateRequestNumber, generateRfqNumber } from "./format";

/** The lifecycle verbs `/api/vendors/[id]/actions` accepts. */
export type VendorAction =
  | "INVITE"
  | "START_ONBOARDING"
  | "SUBMIT_FOR_REVIEW"
  | "ACTIVATE"
  | "SUSPEND"
  | "REACTIVATE"
  | "DEACTIVATE"
  | "ARCHIVE"
  | "RESTORE"
  | "BLACKLIST"
  | "LIFT_BLACKLIST"
  | "SET_PREFERRED"
  | "CLEAR_PREFERRED";

/** A near-match the server found while creating or editing a vendor. */
export interface VendorDuplicate {
  id: string;
  companyName: string;
  legalName?: string;
  status: string;
  code?: string;
  reason: string;
  confidence: "HIGH" | "MEDIUM";
}

/** Whatever subset of the vendor form the caller is submitting. */
export type VendorInput = Record<string, unknown>;

export type ViewKey =
  | "dashboard"
  | "command-center"
  | "requests"
  | "request-detail"
  | "request-new"
  | "request-templates"
  | "approvals"
  | "vendors"
  | "vendor-detail"
  | "supplier-portal"
  | "rfqs"
  | "rfq-detail"
  | "rfq-new"
  | "quotations"
  | "purchase-orders"
  | "po-detail"
  | "goods-receipts"
  | "invoices"
  | "payments"
  | "contracts"
  | "assets"
  | "inventory"
  | "documents"
  | "budgets"
  | "activity"
  | "audit"
  | "notifications"
  | "reports"
  | "ai-assistant"
  | "integrations"
  | "search"
  | "settings"
  | "settings-roles"
  | "settings-workflows"
  | "settings-team"
  | "settings-integrations"
  | "settings-branding"
  | "settings-security";

interface AppState {
  // Auth/session
  //
  // Authentication itself is no longer decided here. The server resolves the
  // principal before this store is ever constructed, so by the time any of this
  // is read the caller is known to be signed in. `isAuthed` survives only as the
  // signal consumers like `use-realtime` need: "there is a live session, it is
  // safe to open a socket". It is set once bootstrap succeeds and cleared when
  // the server answers 401.
  isAuthed: boolean;
  /** True once organization data has been loaded from the server. */
  hydrated: boolean;
  loading: boolean;
  loadError: string | null;
  /** Server-resolved permissions for the signed-in user. Advisory for rendering only. */
  permissions: Permission[];
  currentUserId: string;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;

  // Navigation
  view: ViewKey;
  selectedRequestId: string | null;
  selectedRfqId: string | null;
  selectedPoId: string | null;
  selectedVendorId: string | null;
  selectedInvoiceId: string | null;
  selectedContractId: string | null;
  selectedAssetId: string | null;
  selectedItemId: string | null;
  selectedDocumentId: string | null;
  searchQuery: string;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  previousView: ViewKey | null;

  // Domain data
  organization: Organization;
  branches: Branch[];
  departments: Department[];
  users: User[];
  vendors: Vendor[];
  requests: PurchaseRequest[];
  rfqs: RFQ[];
  purchaseOrders: PurchaseOrder[];
  activities: ActivityLog[];
  notifications: Notification[];
  workflows: ApprovalWorkflow[];
  budgets: Budget[];
  templates: RequestTemplate[];
  integrations: Integration[];
  auditLogs: AuditLogEntry[];
  savedViews: SavedView[];
  notificationPreference: NotificationPreference;
  // New enterprise modules
  goodsReceipts: GoodsReceipt[];
  invoices: Invoice[];
  payments: Payment[];
  contracts: Contract[];
  assets: Asset[];
  inventory: InventoryItem[];
  supplierPortalUsers: SupplierPortalUser[];
  supplierActivities: SupplierActivity[];
  documents: DocumentRecord[];

  // Custom role permissions (override defaults)
  roleOverrides: Record<UserRole, Permission[]>;

  // Actions — auth & theme
  /** Signs out via the server action, then leaves the application. */
  logout: () => Promise<void>;
  /** Loads organization data from the server. Replaces the seed-data import. */
  hydrate: () => Promise<void>;
  /** Re-reads server state after a mutation. */
  refresh: () => Promise<void>;
  /**
   * Establishes client state for an already-authenticated caller: reads the
   * session for the user id and permissions, then loads the organization.
   */
  bootstrap: () => Promise<void>;
  setTheme: (t: "light" | "dark") => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;

  // Actions — navigation
  navigate: (view: ViewKey) => void;
  goBack: () => void;
  selectRequest: (id: string | null) => void;
  selectRfq: (id: string | null) => void;
  selectPo: (id: string | null) => void;
  selectVendor: (id: string | null) => void;
  selectInvoice: (id: string | null) => void;
  selectContract: (id: string | null) => void;
  selectAsset: (id: string | null) => void;
  selectItem: (id: string | null) => void;
  selectDocument: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setCommandOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;

  // Actions — permissions
  hasPermission: (permission: Permission) => boolean;
  grantPermission: (role: UserRole, permission: Permission) => void;
  revokePermission: (role: UserRole, permission: Permission) => void;
  resetRolePermissions: (role: UserRole) => void;

  // Actions — requests
  createRequest: (data: {
    title: string;
    departmentId: string;
    priority: Priority;
    category: string;
    tags: string[];
    businessJustification: string;
    neededByDate: string;
    lineItems: Omit<LineItem, "id">[];
    submit: boolean;
    templateId?: string;
  }) => Promise<string>;
  approveRequest: (requestId: string, decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED", comment: string) => Promise<void>;
  submitRequest: (requestId: string) => Promise<void>;
  cancelRequest: (requestId: string, reason?: string) => Promise<void>;
  duplicateRequest: (requestId: string) => string;
  bulkUpdateRequestStatus: (ids: string[], status: PurchaseRequest["status"]) => void;
  addComment: (entityType: Comment["entityType"], entityId: string, content: string, mentions?: string[]) => Promise<void>;
  addWatcher: (requestId: string, userId: string) => void;

  // Actions — templates
  createTemplate: (data: Omit<RequestTemplate, "id" | "organizationId" | "usageCount" | "createdBy" | "createdAt">) => void;
  useTemplate: (templateId: string) => Promise<void>;

  // Actions — vendors
  //
  // Every one of these is a server call. They used to be `set(...)` on the array
  // above, which is why a vendor added in the UI did not survive a refresh.
  createVendor: (data: VendorInput) => Promise<{ id: string; potentialDuplicates: VendorDuplicate[] }>;
  updateVendor: (id: string, data: VendorInput) => Promise<void>;
  vendorAction: (id: string, action: VendorAction, reason?: string) => Promise<void>;
  submitVendorForReview: (id: string) => Promise<void>;
  decideVendor: (id: string, stepId: string, decision: "APPROVED" | "REJECTED", comment?: string) => Promise<void>;
  checkVendorDuplicates: (input: {
    companyName?: string;
    legalName?: string;
    taxNumber?: string;
    registrationNumber?: string;
    email?: string;
    excludeId?: string;
  }) => Promise<VendorDuplicate[]>;
  addVendorContact: (vendorId: string, data: Record<string, unknown>) => Promise<void>;
  updateVendorContact: (vendorId: string, contactId: string, data: Record<string, unknown>) => Promise<void>;
  removeVendorContact: (vendorId: string, contactId: string) => Promise<void>;
  setVendorCategories: (vendorId: string, categoryIds: string[], preferredCategoryIds?: string[]) => Promise<void>;
  addVendorDocument: (vendorId: string, doc: Record<string, unknown>) => Promise<void>;
  verifyVendorDocument: (vendorId: string, documentId: string, decision: "VERIFIED" | "REJECTED", reason?: string) => Promise<void>;
  removeVendorDocument: (vendorId: string, documentId: string) => Promise<void>;
  addVendorRequirement: (vendorId: string, data: Record<string, unknown>) => Promise<void>;
  removeVendorRequirement: (vendorId: string, requirementId: string) => Promise<void>;
  decideVendorRequirement: (vendorId: string, requirementId: string, data: { decision: "VERIFIED" | "REJECTED" | "UNDER_REVIEW" | "WAIVED"; notes?: string; expiresAt?: string }) => Promise<void>;
  assessVendorRisk: (vendorId: string, data: { level: string; score: number; summary?: string; nextReviewAt?: string; factors?: Record<string, number> }) => Promise<void>;
  addVendorNote: (vendorId: string, body: string, visibility?: "INTERNAL" | "RESTRICTED") => Promise<void>;
  removeVendorNote: (vendorId: string, noteId: string) => Promise<void>;

  // Actions — RFQs
  createRFQ: (data: {
    title: string;
    description: string;
    deadline: string;
    invitedVendorIds: string[];
    requestId?: string;
  }) => Promise<string>;
  cancelRFQ: (rfqId: string) => void;
  duplicateRFQ: (rfqId: string) => string;
  sendRFQReminder: (rfqId: string) => void;

  // Actions — quotations
  selectQuotation: (rfqId: string, quotationId: string) => Promise<void>;

  // Actions — POs
  generatePO: (data: {
    requestId?: string;
    rfqId?: string;
    quotationId?: string;
    vendorId: string;
    lineItems: LineItem[];
    notes?: string;
    expectedDelivery: string;
    taxRate?: number;
    currency?: PurchaseOrder["currency"];
  }) => Promise<string>;
  updatePOStatus: (poId: string, status: PurchaseOrderStatus) => void;
  revisePO: (poId: string, reason: string, changes: Partial<PurchaseOrder>) => void;

  // Actions — budgets
  updateBudget: (budgetId: string, changes: Partial<Budget>) => void;
  createBudget: (data: Omit<Budget, "id" | "organizationId" | "createdAt" | "spentAmount" | "committedAmount" | "remainingAmount" | "alerts" | "status">) => void;

  // Actions — workflows
  createWorkflow: (data: Omit<ApprovalWorkflow, "id" | "organizationId" | "createdAt">) => void;
  toggleWorkflow: (id: string) => void;

  // Actions — integrations
  toggleIntegration: (id: string) => void;
  addIntegration: (data: Omit<Integration, "id" | "organizationId" | "configuredBy" | "configuredAt">) => void;

  // Actions — users
  inviteUser: (data: { email: string; name: string; role: UserRole; jobTitle: string; departmentId?: string; branchId?: string }) => void;
  updateUserRole: (userId: string, role: UserRole) => void;
  suspendUser: (userId: string) => void;

  // Actions — notifications
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  updateNotificationPreference: (pref: Partial<NotificationPreference>) => void;

  // Actions — saved views
  saveView: (data: Omit<SavedView, "id" | "organizationId" | "userId" | "createdAt">) => void;

  // Actions — settings
  updateOrganization: (changes: Partial<Organization>) => void;

  // Actions — goods receipts
  createGoodsReceipt: (data: { poId: string; vendorId: string; notes?: string; items: { lineItemId: string; itemName: string; orderedQty: number; receivedQty: number; unit: string; condition: "GOOD" | "DAMAGED" | "MISSING"; notes?: string }[] }) => Promise<string>;
  updateGoodsReceiptStatus: (id: string, status: GoodsReceiptStatus) => void;

  // Actions — invoices
  createInvoice: (data: { vendorId: string; poId?: string; issueDate: string; dueDate: string; subtotal: number; taxAmount: number; notes?: string }) => Promise<string>;
  approveInvoice: (id: string) => Promise<void>;
  rejectInvoice: (id: string, reason: string) => Promise<void>;
  updateInvoiceStatus: (id: string, status: InvoiceStatus) => void;

  // Actions — payments
  createPayment: (data: { invoiceId: string; vendorId: string; amount: number; method: PaymentMethod; paymentDate: string; reference?: string; notes?: string }) => Promise<string>;
  updatePaymentStatus: (id: string, status: PaymentStatus) => void;

  // Actions — contracts
  createContract: (data: Omit<Contract, "id" | "organizationId" | "createdAt" | "updatedAt" | "versions" | "attachments" | "tags">) => string;
  updateContract: (id: string, changes: Partial<Contract>) => void;
  renewContract: (id: string, newEndDate: string) => void;
  terminateContract: (id: string) => void;

  // Actions — assets
  createAsset: (data: Omit<Asset, "id" | "organizationId" | "createdAt" | "maintenanceHistory" | "transfers" | "currentValue">) => string;
  updateAsset: (id: string, changes: Partial<Asset>) => void;
  assignAsset: (id: string, userId: string) => void;
  transferAsset: (id: string, data: { toUserId?: string; toLocation?: string; reason: string }) => void;
  addMaintenanceRecord: (assetId: string, data: { type: "PREVENTIVE" | "REPAIR" | "INSPECTION" | "UPGRADE"; description: string; cost: number; performedBy?: string }) => void;
  retireAsset: (id: string) => void;

  // Actions — inventory
  createInventoryItem: (data: Omit<InventoryItem, "id" | "organizationId" | "createdAt" | "updatedAt" | "movements">) => string;
  updateInventoryItem: (id: string, changes: Partial<InventoryItem>) => void;
  addStockMovement: (itemId: string, data: { type: StockMovementType; quantity: number; reference?: string; poId?: string; notes?: string }) => void;

  // Actions — supplier portal
  grantSupplierAccess: (vendorId: string, email: string, contactName: string) => void;
  suspendSupplierAccess: (id: string) => void;
  revokeSupplierAccess: (id: string) => void;

  // Actions — documents
  uploadDocument: (data: { name: string; category: DocumentCategory; fileSize: string; mimeType: string; tags: string[]; linkedEntityType?: any; linkedEntityId?: string; description?: string }) => string;
  deleteDocument: (id: string) => void;
}

/**
 * Empty domain state.
 *
 * The store used to boot from `seed-data.ts`, which is why the app showed a
 * fully populated dashboard before any request was made and why every change
 * vanished on refresh. It now starts empty and is filled by `hydrate()` from
 * the database. `seed-data.ts` is still the source of the demo dataset, but it
 * is loaded once by `prisma/seed.ts` into real rows.
 */
const emptyDomainState = {
  branches: [] as Branch[],
  departments: [] as Department[],
  users: [] as User[],
  vendors: [] as Vendor[],
  requests: [] as PurchaseRequest[],
  rfqs: [] as RFQ[],
  purchaseOrders: [] as PurchaseOrder[],
  activities: [] as ActivityLog[],
  notifications: [] as Notification[],
  workflows: [] as ApprovalWorkflow[],
  budgets: [] as Budget[],
  templates: [] as RequestTemplate[],
  integrations: [] as Integration[],
  auditLogs: [] as AuditLogEntry[],
  savedViews: [] as SavedView[],
  goodsReceipts: [] as GoodsReceipt[],
  invoices: [] as Invoice[],
  payments: [] as Payment[],
  contracts: [] as Contract[],
  assets: [] as Asset[],
  inventory: [] as InventoryItem[],
  supplierPortalUsers: [] as SupplierPortalUser[],
  supplierActivities: [] as SupplierActivity[],
  documents: [] as DocumentRecord[],
  permissions: [] as Permission[],
};

const initialState = {
  isAuthed: false,
  hydrated: false,
  loading: false,
  loadError: null as string | null,
  // Replaced by the real id as soon as `bootstrap` reads the session. It is never
  // used to authorise anything — every mutation is checked server-side against
  // the principal — so a stale value here cannot grant access to another account.
  currentUserId: "",
  theme: "light" as const,
  sidebarCollapsed: false,
  view: "dashboard" as ViewKey,
  selectedRequestId: null,
  selectedRfqId: null,
  selectedPoId: null,
  selectedVendorId: null,
  selectedInvoiceId: null,
  selectedContractId: null,
  selectedAssetId: null,
  selectedItemId: null,
  selectedDocumentId: null,
  searchQuery: "",
  commandOpen: false,
  shortcutsOpen: false,
  previousView: null as ViewKey | null,
  organization: seedOrganization,
  notificationPreference: seedNotificationPreference,
  roleOverrides: {} as Record<UserRole, Permission[]>,
  ...emptyDomainState,
};

// Helper to log activity + audit + notification
function logEvent(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  params: {
    eventType: ActivityLog["eventType"];
    description: string;
    severity?: ActivityLog["severity"];
    userId?: string;
    requestId?: string;
    purchaseOrderId?: string;
    rfqId?: string;
    vendorId?: string;
  }
) {
  const state = get();
  const user = state.users.find((u) => u.id === state.currentUserId);
  const now = new Date().toISOString();
  const activity: ActivityLog = {
    id: generateId("act"),
    organizationId: state.organization.id,
    userId: params.userId ?? state.currentUserId,
    requestId: params.requestId,
    purchaseOrderId: params.purchaseOrderId,
    rfqId: params.rfqId,
    vendorId: params.vendorId,
    eventType: params.eventType,
    description: params.description,
    severity: params.severity ?? "INFO",
    ipAddress: "102.89.45.10",
    createdAt: now,
  };
  set({
    activities: [activity, ...state.activities],
    auditLogs: [
      {
        id: generateId("aud"),
        organizationId: state.organization.id,
        userId: params.userId ?? state.currentUserId,
        action: params.eventType,
        resource: params.eventType.split("_")[0],
        resourceId: params.requestId ?? params.purchaseOrderId ?? params.rfqId ?? params.vendorId,
        ipAddress: "102.89.45.10",
        userAgent: "Chrome/120",
        timestamp: now,
      },
      ...state.auditLogs,
    ],
  });
  return user;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Auth — Supabase-backed, resolved on the server.
      //
      // There is no `login` action any more. Credentials are submitted to a
      // Server Action from the sign-in page, which is what lets a password reach
      // Supabase without passing through client-side application code at all.
      logout: async () => {
        // Clear locally first, so the cached organization data is gone from
        // memory even if the network call stalls. The action redirects to
        // /login, which unmounts this tree entirely.
        set({
          isAuthed: false,
          view: "dashboard",
          hydrated: false,
          ...emptyDomainState,
        });

        const { signOutAction } = await import("@/app/(auth)/actions");
        await signOutAction();
      },

      /**
       * Loads the organization's data from the server.
       *
       * This is what replaced `seed-data.ts` as the source of truth. The payload
       * is shaped by `bootstrap-service.ts` to match the client types exactly,
       * so every existing view continues to work against it unchanged.
       */
      hydrate: async () => {
        const { api } = await import("./api/client");
        set({ loading: true, loadError: null });
        try {
          const data = await api.get<Record<string, unknown>>("/api/bootstrap");
          set({
            ...(data as Partial<AppState>),
            // A user with no notification preference row falls back to defaults
            // rather than leaving the settings screen with nothing to render.
            notificationPreference:
              (data.notificationPreference as AppState["notificationPreference"]) ??
              get().notificationPreference,
            hydrated: true,
            loading: false,
            loadError: null,
          });
        } catch (e) {
          set({
            loading: false,
            loadError: e instanceof Error ? e.message : "Could not load your organization's data",
          });
          throw e;
        }
      },

      /** Re-reads server state after a mutation. */
      refresh: async () => {
        if (!get().isAuthed) return;
        try {
          await get().hydrate();
        } catch {
          // hydrate() has already recorded the error for the UI.
        }
      },

      /**
       * Prepares client state for a caller the server has already authenticated.
       *
       * `/api/auth/session` is still the source for the user id and the effective
       * permission set — those come from the database and the role model, which
       * the Supabase token knows nothing about. A 401 here means the session died
       * between the server render and this call, so the page is reloaded and the
       * proxy sends the user to sign in.
       */
      bootstrap: async () => {
        const { api } = await import("./api/client");
        try {
          const session = await api.get<{
            authenticated: boolean;
            user?: { id: string };
            permissions?: Permission[];
          }>("/api/auth/session");

          if (!session.authenticated || !session.user) {
            // A hard navigation, not router.push. The lint rule assumes a soft
            // navigation is always preferable, but that assumption fails here:
            // a client-side transition keeps this store — and the organization
            // data in it — alive in memory across the sign-out boundary. A full
            // document load is what guarantees it is gone.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            if (typeof window !== "undefined") window.location.href = "/login";
            return;
          }

          set({
            isAuthed: true,
            currentUserId: session.user.id,
            permissions: session.permissions ?? [],
          });
          await get().hydrate();
        } catch {
          set({ loadError: "Could not confirm your session. Reload the page to try again." });
        }
      },

      // Theme
      setTheme: (t) => {
        set({ theme: t });
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", t === "dark");
          try {
            localStorage.setItem("nextmav-theme", t);
          } catch {}
        }
      },
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        get().setTheme(next);
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      // Navigation
      navigate: (view) => {
        set({ previousView: get().view, view });
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      },
      goBack: () => {
        const prev = get().previousView;
        if (prev) set({ view: prev, previousView: null });
        else set({ view: "dashboard" });
      },
      selectRequest: (id) => set({ selectedRequestId: id }),
      selectRfq: (id) => set({ selectedRfqId: id }),
      selectPo: (id) => set({ selectedPoId: id }),
      selectVendor: (id) => set({ selectedVendorId: id }),
      selectInvoice: (id) => set({ selectedInvoiceId: id }),
      selectContract: (id) => set({ selectedContractId: id }),
      selectAsset: (id) => set({ selectedAssetId: id }),
      selectItem: (id) => set({ selectedItemId: id }),
      selectDocument: (id) => set({ selectedDocumentId: id }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setCommandOpen: (open) => set({ commandOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

      // Permissions
      hasPermission: (permission) => {
        const state = get();
        const user = state.users.find((u) => u.id === state.currentUserId);
        if (!user) return false;
        const overrides = state.roleOverrides[user.role];
        if (overrides) return overrides.includes(permission);
        return hasPermission(user.role, permission);
      },
      grantPermission: (role, permission) => {
        const current = get().roleOverrides[role] ?? ROLE_PERMISSIONS[role] ?? [];
        if (!current.includes(permission)) {
          set({
            roleOverrides: {
              ...get().roleOverrides,
              [role]: [...current, permission],
            },
          });
          logEvent(get, set, {
            eventType: "PERMISSION_GRANTED",
            description: `Permission '${permission}' granted to role ${role}`,
            severity: "WARNING",
          });
        }
      },
      revokePermission: (role, permission) => {
        const current = get().roleOverrides[role] ?? ROLE_PERMISSIONS[role] ?? [];
        set({
          roleOverrides: {
            ...get().roleOverrides,
            [role]: current.filter((p) => p !== permission),
          },
        });
        logEvent(get, set, {
          eventType: "PERMISSION_REVOKED",
          description: `Permission '${permission}' revoked from role ${role}`,
          severity: "WARNING",
        });
      },
      resetRolePermissions: (role) => {
        const overrides = { ...get().roleOverrides };
        delete overrides[role];
        set({ roleOverrides: overrides });
      },

      // Requests
      createRequest: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/requests", {
          title: data.title,
          departmentId: data.departmentId,
          priority: data.priority,
          category: data.category,
          tags: data.tags,
          businessJustification: data.businessJustification,
          neededByDate: new Date(data.neededByDate).toISOString(),
          lineItems: data.lineItems.map((li) => ({
            itemName: li.itemName,
            description: li.description ?? "",
            quantity: li.quantity,
            unit: li.unit,
            estimatedCost: li.estimatedCost,
            taxRate: li.taxRate ?? 0,
          })),
          templateId: data.templateId,
          submit: data.submit,
        });
        await get().refresh();
        return created.id;
      },

      submitRequest: async (requestId) => {
        const { api } = await import("./api/client");
        await api.post(`/api/requests/${requestId}/submit`);
        await get().refresh();
      },

      approveRequest: async (requestId, decision, comment) => {
        const { api } = await import("./api/client");
        const state = get();
        const request = state.requests.find((r) => r.id === requestId);
        if (!request) throw new Error("Request not found");

        // The server decides on a specific approval *step*, not on the request as
        // a whole, so that it can verify the caller is that step's assigned
        // approver. Resolve the step this user is actually able to act on.
        const pending = request.approvals.filter((a) => a.decision === "PENDING");
        const lowestSequence = pending.reduce(
          (min, a) => Math.min(min, a.sequence ?? 0),
          Number.POSITIVE_INFINITY
        );
        const active = pending.filter((a) => (a.sequence ?? 0) === lowestSequence);
        const mine =
          active.find(
            (a) => a.approverId === state.currentUserId || a.delegatedTo === state.currentUserId
          ) ?? active[0];

        if (!mine) throw new Error("There is no approval step awaiting a decision on this request");

        await api.post(`/api/requests/${requestId}/decide`, {
          stepId: mine.id,
          decision,
          comment: comment ?? "",
        });
        await get().refresh();
      },

      cancelRequest: async (requestId, reason) => {
        const { api } = await import("./api/client");
        await api.post(`/api/requests/${requestId}/cancel`, {
          reason: reason?.trim() || "Cancelled by requester",
        });
        await get().refresh();
      },

      duplicateRequest: (requestId) => {
        const req = get().requests.find((r) => r.id === requestId);
        if (!req) return "";
        const seq = get().requests.length + 1;
        const id = generateId("req");
        const now = new Date().toISOString();
        const newReq: PurchaseRequest = {
          ...req,
          id,
          requestNumber: generateRequestNumber(seq),
          status: "DRAFT",
          approvals: [],
          comments: [],
          watchers: [get().currentUserId],
          createdAt: now,
          updatedAt: now,
          submittedAt: undefined,
          completedAt: undefined,
          version: 1,
          lineItems: req.lineItems.map((li) => ({ ...li, id: generateId("li") })),
        };
        newReq.title = `${req.title} (Copy)`;
        set((s) => ({ requests: [newReq, ...s.requests] }));
        logEvent(get, set, {
          eventType: "REQUEST_CREATED",
          description: `Duplicated ${req.requestNumber} as ${newReq.requestNumber}`,
          requestId: id,
        });
        return id;
      },

      bulkUpdateRequestStatus: (ids, status) => {
        const now = new Date().toISOString();
        set((s) => ({
          requests: s.requests.map((r) =>
            ids.includes(r.id) ? { ...r, status, updatedAt: now } : r
          ),
        }));
        logEvent(get, set, {
          eventType: "STATUS_CHANGE",
          description: `Bulk updated ${ids.length} request(s) to ${status}`,
          severity: "INFO",
        });
      },

      addComment: async (entityType, entityId, content, mentions) => {
        const { api } = await import("./api/client");
        if (entityType !== "REQUEST") {
          throw new Error("Comments are currently supported on purchase requests only");
        }
        await api.post(`/api/requests/${entityId}/comments`, {
          content,
          mentions: mentions ?? [],
        });
        await get().refresh();
      },

      addWatcher: (requestId, userId) => {
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === requestId && !r.watchers.includes(userId)
              ? { ...r, watchers: [...r.watchers, userId] }
              : r
          ),
        }));
      },

      // Templates
      createTemplate: (data) => {
        const now = new Date().toISOString();
        const newTemplate: RequestTemplate = {
          ...data,
          id: generateId("tpl"),
          organizationId: get().organization.id,
          usageCount: 0,
          createdBy: get().currentUserId,
          createdAt: now,
        };
        set((s) => ({ templates: [newTemplate, ...s.templates] }));
        logEvent(get, set, {
          eventType: "SETTINGS_UPDATED",
          description: `Created new request template: '${data.name}'`,
          severity: "INFO",
        });
      },
      useTemplate: async (templateId) => {
        const tpl = get().templates.find((t) => t.id === templateId);
        if (tpl) {
          const id = await get().createRequest({
            title: tpl.name,
            departmentId: tpl.departmentId ?? get().departments[0]?.id ?? "",
            priority: tpl.priority,
            category: tpl.category,
            tags: [],
            businessJustification: tpl.defaultJustification,
            neededByDate: new Date(Date.now() + 14 * 86400000).toISOString(),
            lineItems: tpl.defaultLineItems,
            submit: false,
            templateId,
          });
          useStore.getState().selectRequest(id);
          get().navigate("request-detail");
        }
      },

      // Vendors
      //
      // Each of these posts to the vendor API and then re-reads the organization,
      // so the store's copy is whatever the database actually holds rather than an
      // optimistic guess about what the server would have done. The server owns
      // the lifecycle, the permission check and the audit entry; nothing here
      // decides anything.

      createVendor: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string; potentialDuplicates?: VendorDuplicate[] }>(
          "/api/vendors",
          data
        );
        await get().refresh();
        return { id: created.id, potentialDuplicates: created.potentialDuplicates ?? [] };
      },

      updateVendor: async (id, data) => {
        const { api } = await import("./api/client");
        await api.patch(`/api/vendors/${id}`, data);
        await get().refresh();
      },

      vendorAction: async (id, action, reason) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${id}/actions`, { action, reason: reason ?? "" });
        await get().refresh();
      },

      submitVendorForReview: async (id) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${id}/submit`);
        await get().refresh();
      },

      decideVendor: async (id, stepId, decision, comment) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${id}/decide`, { stepId, decision, comment: comment ?? "" });
        await get().refresh();
      },

      checkVendorDuplicates: async (input) => {
        const { api } = await import("./api/client");
        return api.post<VendorDuplicate[]>("/api/vendors/duplicates", input);
      },

      addVendorContact: async (vendorId, data) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/contacts`, data);
        await get().refresh();
      },

      updateVendorContact: async (vendorId, contactId, data) => {
        const { api } = await import("./api/client");
        await api.patch(`/api/vendors/${vendorId}/contacts/${contactId}`, data);
        await get().refresh();
      },

      removeVendorContact: async (vendorId, contactId) => {
        const { api } = await import("./api/client");
        await api.del(`/api/vendors/${vendorId}/contacts/${contactId}`);
        await get().refresh();
      },

      setVendorCategories: async (vendorId, categoryIds, preferredCategoryIds) => {
        const { api } = await import("./api/client");
        await api.put(`/api/vendors/${vendorId}/categories`, {
          categoryIds,
          preferredCategoryIds: preferredCategoryIds ?? [],
        });
        await get().refresh();
      },

      addVendorDocument: async (vendorId, doc) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/documents`, doc);
        await get().refresh();
      },

      verifyVendorDocument: async (vendorId, documentId, decision, reason) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/documents/${documentId}/verify`, {
          decision,
          reason: reason ?? "",
        });
        await get().refresh();
      },

      removeVendorDocument: async (vendorId, documentId) => {
        const { api } = await import("./api/client");
        await api.del(`/api/vendors/${vendorId}/documents/${documentId}`);
        await get().refresh();
      },

      addVendorRequirement: async (vendorId, data) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/compliance`, data);
        await get().refresh();
      },

      removeVendorRequirement: async (vendorId, requirementId) => {
        const { api } = await import("./api/client");
        await api.del(`/api/vendors/${vendorId}/compliance/${requirementId}`);
        await get().refresh();
      },

      decideVendorRequirement: async (vendorId, requirementId, data) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/compliance/${requirementId}/decide`, data);
        await get().refresh();
      },

      assessVendorRisk: async (vendorId, data) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/risk`, data);
        await get().refresh();
      },

      addVendorNote: async (vendorId, body, visibility) => {
        const { api } = await import("./api/client");
        await api.post(`/api/vendors/${vendorId}/notes`, {
          body,
          visibility: visibility ?? "INTERNAL",
        });
        await get().refresh();
      },

      removeVendorNote: async (vendorId, noteId) => {
        const { api } = await import("./api/client");
        await api.del(`/api/vendors/${vendorId}/notes/${noteId}`);
        await get().refresh();
      },

      // RFQs
      createRFQ: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/rfqs", {
          title: data.title,
          description: data.description,
          deadline: new Date(data.deadline).toISOString(),
          requestId: data.requestId,
          invitedVendorIds: data.invitedVendorIds,
        });
        await get().refresh();
        return created.id;
      },

      cancelRFQ: (rfqId) => {
        set((s) => ({
          rfqs: s.rfqs.map((r) => (r.id === rfqId ? { ...r, status: "CANCELLED" } : r)),
        }));
        logEvent(get, set, {
          eventType: "RFQ_CANCELLED",
          description: `RFQ ${get().rfqs.find((r) => r.id === rfqId)?.rfqNumber} cancelled`,
          severity: "WARNING",
          rfqId,
        });
      },

      duplicateRFQ: (rfqId) => {
        const rfq = get().rfqs.find((r) => r.id === rfqId);
        if (!rfq) return "";
        const seq = get().rfqs.length + 1;
        const id = generateId("rfq");
        const newRfq: RFQ = {
          ...rfq,
          id,
          rfqNumber: generateRfqNumber(seq),
          title: `${rfq.title} (Copy)`,
          status: "PUBLISHED",
          quotations: [],
          selectedQuotationId: undefined,
          remindersSent: 0,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ rfqs: [newRfq, ...s.rfqs] }));
        return id;
      },

      sendRFQReminder: (rfqId) => {
        set((s) => ({
          rfqs: s.rfqs.map((r) =>
            r.id === rfqId ? { ...r, remindersSent: r.remindersSent + 1 } : r
          ),
        }));
        logEvent(get, set, {
          eventType: "STATUS_CHANGE",
          description: `Reminder sent for RFQ ${get().rfqs.find((r) => r.id === rfqId)?.rfqNumber}`,
          rfqId,
        });
      },

      // Quotations
      selectQuotation: async (rfqId, quotationId) => {
        const { api } = await import("./api/client");
        await api.post(`/api/rfqs/${rfqId}/award`, { quotationId, justification: "" });
        await get().refresh();
      },

      // POs
      generatePO: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/purchase-orders", {
          vendorId: data.vendorId,
          requestId: data.requestId,
          rfqId: data.rfqId,
          quotationId: data.quotationId,
          expectedDelivery: new Date(data.expectedDelivery).toISOString(),
          taxRate: data.taxRate ?? 0,
          discountAmount: 0,
          notes: data.notes ?? "",
          lineItems: data.lineItems.map((li) => ({
            itemName: li.itemName,
            description: li.description ?? "",
            quantity: li.quantity,
            unit: li.unit,
            unitPrice: li.estimatedCost,
            taxRate: li.taxRate ?? 0,
            createsAsset: false,
          })),
          issue: true,
        });
        await get().refresh();
        return created.id;
      },

      updatePOStatus: (poId, status) => {
        const now = new Date().toISOString();
        const po = get().purchaseOrders.find((p) => p.id === poId);
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((p) =>
            p.id === poId ? { ...p, status, receivedAt: status === "RECEIVED" ? now : p.receivedAt } : p
          ),
        }));
        if (po) {
          logEvent(get, set, {
            eventType: "PO_STATUS_UPDATED",
            description: `${po.poNumber} status updated to ${status.replace("_", " ").toLowerCase()}`,
            severity: status === "RECEIVED" ? "SUCCESS" : "INFO",
            purchaseOrderId: poId,
          });
        }
      },

      revisePO: (poId, reason, changes) => {
        const po = get().purchaseOrders.find((p) => p.id === poId);
        if (!po) return;
        const newVersion = po.version + 1;
        const now = new Date().toISOString();
        const newRevision = {
          version: newVersion,
          modifiedAt: now,
          modifiedBy: get().currentUserId,
          reason,
        };
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((p) =>
            p.id === poId ? { ...p, ...changes, version: newVersion, revisions: [...p.revisions, newRevision] } : p
          ),
        }));
        logEvent(get, set, {
          eventType: "PO_REVISED",
          description: `${po.poNumber} revised to v${newVersion}: ${reason}`,
          severity: "WARNING",
          purchaseOrderId: poId,
        });
      },

      // Budgets
      updateBudget: (budgetId, changes) => {
        set((s) => ({
          budgets: s.budgets.map((b) => {
            if (b.id !== budgetId) return b;
            const updated = { ...b, ...changes };
            updated.remainingAmount = updated.totalAmount - updated.spentAmount - updated.committedAmount;
            return updated;
          }),
        }));
        logEvent(get, set, {
          eventType: "SETTINGS_UPDATED",
          description: `Budget updated`,
          severity: "INFO",
        });
      },
      createBudget: (data) => {
        const newBudget: Budget = {
          ...data,
          id: generateId("bud"),
          organizationId: get().organization.id,
          spentAmount: 0,
          committedAmount: 0,
          remainingAmount: data.totalAmount,
          alerts: [
            { threshold: 75, triggered: false },
            { threshold: 90, triggered: false },
          ],
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ budgets: [...s.budgets, newBudget] }));
      },

      // Workflows
      createWorkflow: (data) => {
        const newWf: ApprovalWorkflow = {
          ...data,
          id: generateId("wf"),
          organizationId: get().organization.id,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ workflows: [...s.workflows, newWf] }));
        logEvent(get, set, {
          eventType: "SETTINGS_UPDATED",
          description: `Created approval workflow: '${data.name}'`,
        });
      },
      toggleWorkflow: (id) => {
        set((s) => ({
          workflows: s.workflows.map((w) =>
            w.id === id ? { ...w, isActive: !w.isActive } : w
          ),
        }));
      },

      // Integrations
      toggleIntegration: (id) => {
        const integ = get().integrations.find((i) => i.id === id);
        set((s) => ({
          integrations: s.integrations.map((i) =>
            i.id === id
              ? { ...i, status: i.status === "CONNECTED" ? "DISCONNECTED" : "CONNECTED", lastSyncAt: new Date().toISOString() }
              : i
          ),
        }));
        logEvent(get, set, {
          eventType: "SETTINGS_UPDATED",
          description: `Integration ${integ?.name} ${integ?.status === "CONNECTED" ? "disconnected" : "connected"}`,
        });
      },
      addIntegration: (data) => {
        const newInteg: Integration = {
          ...data,
          id: generateId("int"),
          organizationId: get().organization.id,
          configuredBy: get().currentUserId,
          configuredAt: new Date().toISOString(),
        };
        set((s) => ({ integrations: [...s.integrations, newInteg] }));
      },

      // Users
      inviteUser: (data) => {
        const newUser: User = {
          id: generateId("usr"),
          organizationId: get().organization.id,
          branchId: data.branchId,
          departmentId: data.departmentId,
          email: data.email,
          name: data.name,
          role: data.role,
          jobTitle: data.jobTitle,
          avatarColor: ["bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500", "bg-teal-500"][Math.floor(Math.random() * 6)],
          initials: data.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase(),
          status: "INVITED",
          mfaEnabled: false,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ users: [...s.users, newUser] }));
        logEvent(get, set, {
          eventType: "USER_INVITED",
          description: `${data.name} (${data.email}) invited as ${data.role}`,
          severity: "INFO",
        });
      },
      updateUserRole: (userId, role) => {
        set((s) => ({
          users: s.users.map((u) => (u.id === userId ? { ...u, role } : u)),
        }));
        const u = get().users.find((x) => x.id === userId);
        logEvent(get, set, {
          eventType: "USER_ROLE_CHANGED",
          description: `${u?.name}'s role changed to ${role}`,
          severity: "WARNING",
        });
      },
      suspendUser: (userId) => {
        set((s) => ({
          users: s.users.map((u) =>
            u.id === userId ? { ...u, status: u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" } : u
          ),
        }));
      },

      // Notifications
      markNotificationRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markAllNotificationsRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
        })),
      updateNotificationPreference: (pref) =>
        set((s) => ({
          notificationPreference: { ...s.notificationPreference, ...pref },
        })),

      // Saved views
      saveView: (data) => {
        const newView: SavedView = {
          ...data,
          id: generateId("sv"),
          organizationId: get().organization.id,
          userId: get().currentUserId,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ savedViews: [...s.savedViews, newView] }));
      },

      // Organization settings
      updateOrganization: (changes) => {
        set((s) => ({ organization: { ...s.organization, ...changes } }));
        logEvent(get, set, {
          eventType: "SETTINGS_UPDATED",
          description: `Organization settings updated`,
        });
      },

      // Goods Receipts
      createGoodsReceipt: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/goods-receipts", {
          purchaseOrderId: data.poId,
          notes: data.notes,
          items: data.items
            .filter((i) => i.receivedQty > 0 || i.condition !== "GOOD")
            .map((i) => ({
              poLineItemId: i.lineItemId,
              receivedQty: i.receivedQty,
              // A line marked MISSING accounts for the shortfall as rejected, so
              // the PO does not sit forever waiting on goods that never arrived.
              rejectedQty:
                i.condition === "MISSING" ? Math.max(0, i.orderedQty - i.receivedQty) : 0,
              condition: i.condition,
              notes: i.notes,
            })),
          post: true,
        });
        await get().refresh();
        return created.id;
      },
      updateGoodsReceiptStatus: (id, status) => {
        set((s) => ({
          goodsReceipts: s.goodsReceipts.map((gr) => (gr.id === id ? { ...gr, status } : gr)),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Goods receipt status updated to ${status}` });
      },

      // Invoices
      createInvoice: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/invoices", {
          vendorId: data.vendorId,
          purchaseOrderId: data.poId,
          issueDate: new Date(data.issueDate).toISOString(),
          dueDate: new Date(data.dueDate).toISOString(),
          notes: data.notes,
          submit: true,
        });
        await get().refresh();
        return created.id;
      },
      approveInvoice: async (id) => {
        const { api } = await import("./api/client");
        await api.post(`/api/invoices/${id}/approve`, {});
        await get().refresh();
      },
      rejectInvoice: async (id, reason) => {
        const { api } = await import("./api/client");
        await api.post(`/api/invoices/${id}/reject`, {
          reason: reason?.trim() || "Rejected on review",
        });
        await get().refresh();
      },
      updateInvoiceStatus: (id, status) => {
        set((s) => ({
          invoices: s.invoices.map((inv) => (inv.id === id ? { ...inv, status } : inv)),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Invoice status updated to ${status}` });
      },

      // Payments
      createPayment: async (data) => {
        const { api } = await import("./api/client");
        const created = await api.post<{ id: string }>("/api/payments", {
          invoiceId: data.invoiceId,
          amount: data.amount,
          method: data.method,
          scheduledFor: data.paymentDate ? new Date(data.paymentDate).toISOString() : undefined,
          reference: data.reference,
          notes: data.notes,
        });
        await get().refresh();
        return created.id;
      },
      updatePaymentStatus: (id, status) => {
        set((s) => ({
          payments: s.payments.map((p) => (p.id === id ? { ...p, status } : p)),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Payment status updated to ${status}` });
      },

      // Contracts
      createContract: (data) => {
        const seq = get().contracts.length + 1;
        const id = generateId("ctr");
        const now = new Date().toISOString();
        const newContract: Contract = {
          ...data,
          id,
          organizationId: get().organization.id,
          contractNumber: `CTR-2026-${String(seq).padStart(4, "0")}`,
          tags: [],
          attachments: [],
          versions: [{ version: 1, modifiedAt: now, modifiedBy: get().currentUserId, reason: "Initial creation" }],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ contracts: [newContract, ...s.contracts] }));
        logEvent(get, set, {
          eventType: "FILE_UPLOADED",
          description: `Contract ${newContract.contractNumber} created: '${newContract.title}'`,
          severity: "INFO",
          vendorId: data.vendorId,
        });
        return id;
      },
      updateContract: (id, changes) => {
        const now = new Date().toISOString();
        set((s) => ({
          contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...changes, updatedAt: now } : c)),
        }));
        logEvent(get, set, { eventType: "SETTINGS_UPDATED", description: `Contract updated` });
      },
      renewContract: (id, newEndDate) => {
        const now = new Date().toISOString();
        set((s) => ({
          contracts: s.contracts.map((c) =>
            c.id === id ? { ...c, status: "RENEWED", endDate: newEndDate, updatedAt: now } : c
          ),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Contract renewed until ${newEndDate}`, severity: "SUCCESS" });
      },
      terminateContract: (id) => {
        const now = new Date().toISOString();
        set((s) => ({
          contracts: s.contracts.map((c) => (c.id === id ? { ...c, status: "TERMINATED", updatedAt: now } : c)),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Contract terminated`, severity: "WARNING" });
      },

      // Assets
      createAsset: (data) => {
        const seq = get().assets.length + 1;
        const id = generateId("ast");
        const now = new Date().toISOString();
        const newAsset: Asset = {
          ...data,
          id,
          organizationId: get().organization.id,
          assetTag: data.assetTag || `AST-${String(seq).padStart(5, "0")}`,
          currentValue: data.purchaseValue,
          maintenanceHistory: [],
          transfers: [],
          createdAt: now,
        };
        set((s) => ({ assets: [newAsset, ...s.assets] }));
        logEvent(get, set, { eventType: "FILE_UPLOADED", description: `Asset ${newAsset.assetTag} created: '${newAsset.name}'` });
        return id;
      },
      updateAsset: (id, changes) => {
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, ...changes } : a)),
        }));
        logEvent(get, set, { eventType: "SETTINGS_UPDATED", description: `Asset updated` });
      },
      assignAsset: (id, userId) => {
        const now = new Date().toISOString();
        set((s) => ({
          assets: s.assets.map((a) =>
            a.id === id
              ? {
                  ...a,
                  assignedToId: userId,
                  status: "ASSIGNED",
                  transfers: [...a.transfers, { id: generateId("tr"), date: now, fromUserId: a.assignedToId, toUserId: userId, reason: "Asset assignment" }],
                }
              : a
          ),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Asset assigned`, severity: "SUCCESS" });
      },
      transferAsset: (id, data) => {
        const now = new Date().toISOString();
        set((s) => ({
          assets: s.assets.map((a) =>
            a.id === id
              ? {
                  ...a,
                  assignedToId: data.toUserId ?? a.assignedToId,
                  location: data.toLocation ?? a.location,
                  transfers: [...a.transfers, { id: generateId("tr"), date: now, fromUserId: a.assignedToId, toUserId: data.toUserId, fromLocation: a.location, toLocation: data.toLocation, reason: data.reason }],
                }
              : a
          ),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Asset transferred: ${data.reason}` });
      },
      addMaintenanceRecord: (assetId, data) => {
        const now = new Date().toISOString();
        set((s) => ({
          assets: s.assets.map((a) =>
            a.id === assetId
              ? {
                  ...a,
                  maintenanceHistory: [
                    ...a.maintenanceHistory,
                    { id: generateId("mh"), date: now, ...data },
                  ],
                }
              : a
          ),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Maintenance record added to asset`, severity: "INFO" });
      },
      retireAsset: (id) => {
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, status: "RETIRED", assignedToId: undefined } : a)),
        }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Asset retired`, severity: "WARNING" });
      },

      // Inventory
      createInventoryItem: (data) => {
        const id = generateId("inv_item");
        const now = new Date().toISOString();
        const newItem: InventoryItem = {
          ...data,
          id,
          organizationId: get().organization.id,
          movements: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ inventory: [newItem, ...s.inventory] }));
        logEvent(get, set, { eventType: "FILE_UPLOADED", description: `Inventory item created: ${data.name} (${data.sku})` });
        return id;
      },
      updateInventoryItem: (id, changes) => {
        set((s) => ({
          inventory: s.inventory.map((i) => (i.id === id ? { ...i, ...changes, updatedAt: new Date().toISOString() } : i)),
        }));
        logEvent(get, set, { eventType: "SETTINGS_UPDATED", description: `Inventory item updated` });
      },
      addStockMovement: (itemId, data) => {
        const item = get().inventory.find((i) => i.id === itemId);
        if (!item) return;
        const delta = data.type === "RECEIPT" || data.type === "RETURN" ? data.quantity : -data.quantity;
        const newBalance = item.quantity + delta;
        const now = new Date().toISOString();
        const movement = {
          id: generateId("sm"),
          itemId,
          type: data.type,
          quantity: data.quantity,
          balanceAfter: newBalance,
          reference: data.reference,
          poId: data.poId,
          notes: data.notes,
          performedById: get().currentUserId,
          createdAt: now,
        };
        set((s) => ({
          inventory: s.inventory.map((i) =>
            i.id === itemId
              ? { ...i, quantity: newBalance, lastRestockDate: data.type === "RECEIPT" ? now : i.lastRestockDate, movements: [...i.movements, movement], updatedAt: now }
              : i
          ),
        }));
        logEvent(get, set, {
          eventType: "STATUS_CHANGE",
          description: `Stock ${data.type.toLowerCase()} for ${item.name}: ${data.quantity} ${item.unit} (balance: ${newBalance})`,
          severity: newBalance < item.reorderLevel ? "WARNING" : "INFO",
        });
      },

      // Supplier Portal
      grantSupplierAccess: (vendorId, email, contactName) => {
        const id = generateId("spu");
        const newSpu: SupplierPortalUser = {
          id,
          vendorId,
          email,
          contactName,
          accessStatus: "ACTIVE",
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ supplierPortalUsers: [...s.supplierPortalUsers, newSpu] }));
        logEvent(get, set, { eventType: "USER_INVITED", description: `Supplier portal access granted to ${contactName} (${email})`, severity: "INFO", vendorId });
      },
      suspendSupplierAccess: (id) => {
        set((s) => ({
          supplierPortalUsers: s.supplierPortalUsers.map((u) => (u.id === id ? { ...u, accessStatus: "SUSPENDED" } : u)),
        }));
        logEvent(get, set, { eventType: "USER_ROLE_CHANGED", description: `Supplier portal access suspended`, severity: "WARNING" });
      },
      revokeSupplierAccess: (id) => {
        set((s) => ({
          supplierPortalUsers: s.supplierPortalUsers.map((u) => (u.id === id ? { ...u, accessStatus: "REVOKED" } : u)),
        }));
        logEvent(get, set, { eventType: "USER_ROLE_CHANGED", description: `Supplier portal access revoked`, severity: "WARNING" });
      },

      // Documents
      uploadDocument: (data) => {
        const id = generateId("doc");
        const now = new Date().toISOString();
        const newDoc: DocumentRecord = {
          id,
          organizationId: get().organization.id,
          name: data.name,
          category: data.category,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          uploadedById: get().currentUserId,
          tags: data.tags,
          linkedEntityType: data.linkedEntityType,
          linkedEntityId: data.linkedEntityId,
          versions: [{ version: 1, uploadedAt: now, uploadedBy: get().currentUserId, size: data.fileSize }],
          currentVersion: 1,
          description: data.description,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ documents: [newDoc, ...s.documents] }));
        logEvent(get, set, { eventType: "FILE_UPLOADED", description: `Document uploaded: ${data.name} (${data.category})` });
        return id;
      },
      deleteDocument: (id) => {
        set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
        logEvent(get, set, { eventType: "STATUS_CHANGE", description: `Document deleted`, severity: "WARNING" });
      },
    }),
    {
      name: "nextmav-procure-store",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage))),
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        notificationPreference: s.notificationPreference,
        roleOverrides: s.roleOverrides,
      }),
    }
  )
);

// Selector hooks
export const useCurrentUser = () =>
  useStore((s) => s.users.find((u) => u.id === s.currentUserId) ?? s.users[0]);

export const useUserById = (id?: string) =>
  useStore((s) => s.users.find((u) => u.id === id));

export const useDepartmentById = (id?: string) =>
  useStore((s) => s.departments.find((d) => d.id === id));

export const useVendorById = (id?: string) =>
  useStore((s) => s.vendors.find((v) => v.id === id));

export const useUnreadNotificationCount = () =>
  useStore((s) => s.notifications.filter((n) => !n.read).length);

export const useHasPermission = (permission: import("./types").Permission) =>
  useStore((s) => {
    const user = s.users.find((u) => u.id === s.currentUserId);
    if (!user) return false;
    const overrides = s.roleOverrides[user.role];
    if (overrides) return overrides.includes(permission);
    return hasPermission(user.role, permission);
  });
