// NextMav Procure — Central Zustand store
// Manages all app state including navigation, theme, data, and mutations.

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActivityLog,
  ApprovalDecision,
  ApprovalStep,
  Branch,
  Department,
  LineItem,
  Notification,
  Organization,
  Priority,
  PurchaseOrder,
  PurchaseRequest,
  RFQ,
  User,
  Vendor,
} from "./types";
import {
  seedActivities,
  seedBranches,
  seedDepartments,
  seedNotifications,
  seedOrganization,
  seedPurchaseOrders,
  seedRequests,
  seedRFQs,
  seedUsers,
  seedVendors,
} from "./seed-data";
import { generateId, generatePoNumber, generateRequestNumber, generateRfqNumber } from "./format";

export type ViewKey =
  | "dashboard"
  | "requests"
  | "request-detail"
  | "request-new"
  | "approvals"
  | "vendors"
  | "rfqs"
  | "rfq-detail"
  | "rfq-new"
  | "quotations"
  | "purchase-orders"
  | "po-detail"
  | "activity"
  | "notifications"
  | "reports"
  | "search"
  | "settings";

interface AppState {
  // Auth/session
  isAuthed: boolean;
  currentUserId: string;
  theme: "light" | "dark";

  // Navigation
  view: ViewKey;
  selectedRequestId: string | null;
  selectedRfqId: string | null;
  selectedPoId: string | null;
  searchQuery: string;
  commandOpen: boolean;

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

  // Actions — auth & theme
  login: (userId?: string) => void;
  logout: () => void;
  setTheme: (t: "light" | "dark") => void;
  toggleTheme: () => void;

  // Actions — navigation
  navigate: (view: ViewKey) => void;
  selectRequest: (id: string | null) => void;
  selectRfq: (id: string | null) => void;
  selectPo: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setCommandOpen: (open: boolean) => void;

  // Actions — requests
  createRequest: (data: {
    title: string;
    departmentId: string;
    priority: Priority;
    businessJustification: string;
    neededByDate: string;
    lineItems: Omit<LineItem, "id">[];
    submit: boolean;
  }) => string;
  approveRequest: (requestId: string, decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED", comment: string) => void;
  submitRequest: (requestId: string) => void;
  cancelRequest: (requestId: string) => void;

  // Actions — vendors
  createVendor: (data: Omit<Vendor, "id" | "organizationId" | "createdAt" | "rating" | "status" | "totalOrders" | "totalValue">) => void;
  updateVendor: (id: string, data: Partial<Vendor>) => void;
  archiveVendor: (id: string) => void;

  // Actions — RFQs
  createRFQ: (data: {
    title: string;
    description: string;
    deadline: string;
    invitedVendorIds: string[];
    requestId?: string;
  }) => string;

  // Actions — quotations
  selectQuotation: (rfqId: string, quotationId: string) => void;

  // Actions — POs
  generatePO: (data: {
    requestId?: string;
    rfqId?: string;
    quotationId?: string;
    vendorId: string;
    lineItems: LineItem[];
    notes?: string;
    expectedDelivery: string;
  }) => string;
  updatePOStatus: (poId: string, status: PurchaseOrder["status"]) => void;

  // Actions — notifications
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
}

const initialState = {
  isAuthed: false,
  currentUserId: "usr_amina",
  theme: "light" as const,
  view: "dashboard" as ViewKey,
  selectedRequestId: null,
  selectedRfqId: null,
  selectedPoId: null,
  searchQuery: "",
  commandOpen: false,
  organization: seedOrganization,
  branches: seedBranches,
  departments: seedDepartments,
  users: seedUsers,
  vendors: seedVendors,
  requests: seedRequests,
  rfqs: seedRFQs,
  purchaseOrders: seedPurchaseOrders,
  activities: seedActivities,
  notifications: seedNotifications,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Auth
      login: (userId = "usr_amina") =>
        set({ isAuthed: true, currentUserId: userId, view: "dashboard" }),
      logout: () => set({ isAuthed: false, view: "dashboard" }),

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

      // Navigation
      navigate: (view) => {
        set({ view });
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      },
      selectRequest: (id) => set({ selectedRequestId: id }),
      selectRfq: (id) => set({ selectedRfqId: id }),
      selectPo: (id) => set({ selectedPoId: id }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setCommandOpen: (open) => set({ commandOpen: open }),

      // Requests
      createRequest: (data) => {
        const seq = get().requests.length + 1;
        const id = generateId("req");
        const now = new Date().toISOString();
        const total = data.lineItems.reduce((s, li) => s + li.quantity * li.estimatedCost, 0);
        const user = get().users.find((u) => u.id === get().currentUserId);
        const newRequest: PurchaseRequest = {
          id,
          organizationId: get().organization.id,
          requestNumber: generateRequestNumber(seq),
          title: data.title,
          departmentId: data.departmentId,
          requestedById: get().currentUserId,
          status: data.submit ? "SUBMITTED" : "DRAFT",
          priority: data.priority,
          businessJustification: data.businessJustification,
          neededByDate: data.neededByDate,
          totalEstimated: total,
          currency: "USD",
          attachments: [],
          lineItems: data.lineItems.map((li) => ({ ...li, id: generateId("li") })),
          approvals: data.submit
            ? [
                {
                  id: generateId("ap"),
                  requestId: id,
                  stage: "DEPARTMENT_MANAGER",
                  approverId: get().users.find((u) => u.role === "DEPARTMENT_MANAGER")?.id ?? "usr_chidi",
                  decision: "PENDING",
                  createdAt: now,
                },
              ]
            : [],
          createdAt: now,
          updatedAt: now,
          submittedAt: data.submit ? now : undefined,
        };
        set((s) => ({ requests: [newRequest, ...s.requests] }));

        const activity: ActivityLog = {
          id: generateId("act"),
          organizationId: get().organization.id,
          userId: get().currentUserId,
          requestId: id,
          eventType: data.submit ? "REQUEST_SUBMITTED" : "REQUEST_CREATED",
          description: `${user?.name ?? "User"} ${data.submit ? "submitted" : "created draft"} ${newRequest.requestNumber}: '${newRequest.title}'`,
          createdAt: now,
        };
        set((s) => ({ activities: [activity, ...s.activities] }));
        return id;
      },

      submitRequest: (requestId) => {
        const now = new Date().toISOString();
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === requestId
              ? {
                  ...r,
                  status: "SUBMITTED",
                  submittedAt: now,
                  updatedAt: now,
                  approvals:
                    r.approvals.length === 0
                      ? [
                          {
                            id: generateId("ap"),
                            requestId,
                            stage: "DEPARTMENT_MANAGER",
                            approverId: s.users.find((u) => u.role === "DEPARTMENT_MANAGER")?.id ?? "usr_chidi",
                            decision: "PENDING",
                            createdAt: now,
                          },
                        ]
                      : r.approvals,
                }
              : r
          ),
        }));
        const req = get().requests.find((r) => r.id === requestId);
        const user = get().users.find((u) => u.id === get().currentUserId);
        if (req) {
          set((s) => ({
            activities: [
              {
                id: generateId("act"),
                organizationId: get().organization.id,
                userId: get().currentUserId,
                requestId,
                eventType: "REQUEST_SUBMITTED",
                description: `${user?.name ?? "User"} submitted ${req.requestNumber}: '${req.title}'`,
                createdAt: now,
              },
              ...s.activities,
            ],
          }));
        }
      },

      approveRequest: (requestId, decision, comment) => {
        const now = new Date().toISOString();
        const state = get();
        const req = state.requests.find((r) => r.id === requestId);
        if (!req) return;

        // Find current pending approval
        const pendingIdx = req.approvals.findIndex((a) => a.decision === "PENDING");
        if (pendingIdx === -1) return;
        const currentStage = req.approvals[pendingIdx].stage;
        const updatedApprovals = [...req.approvals];
        updatedApprovals[pendingIdx] = {
          ...updatedApprovals[pendingIdx],
          decision,
          comment,
          decidedAt: now,
        };

        // Determine next status & whether to add next stage approval
        let newStatus = req.status;
        let nextApproval: ApprovalStep | null = null;

        if (decision === "REJECTED") {
          newStatus = "REJECTED";
        } else if (decision === "CHANGES_REQUESTED") {
          newStatus = "UNDER_REVIEW";
        } else if (decision === "APPROVED") {
          // Advance to next stage
          const stages: ApprovalStep["stage"][] = ["DEPARTMENT_MANAGER", "FINANCE", "PROCUREMENT"];
          const stageIdx = stages.indexOf(currentStage);
          if (stageIdx < stages.length - 1) {
            newStatus = "UNDER_REVIEW";
            const nextStage = stages[stageIdx + 1];
            const nextApprover = state.users.find((u) => {
              if (nextStage === "FINANCE") return u.role === "FINANCE_OFFICER";
              if (nextStage === "PROCUREMENT") return u.role === "PROCUREMENT_MANAGER";
              return false;
            });
            if (nextApprover) {
              nextApproval = {
                id: generateId("ap"),
                requestId,
                stage: nextStage,
                approverId: nextApprover.id,
                decision: "PENDING",
                createdAt: now,
              };
            }
          } else {
            // Final stage approved
            newStatus = "APPROVED";
          }
        }

        const finalApprovals = nextApproval ? [...updatedApprovals, nextApproval] : updatedApprovals;
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === requestId ? { ...r, approvals: finalApprovals, status: newStatus, updatedAt: now } : r
          ),
        }));

        const user = state.users.find((u) => u.id === state.currentUserId);
        const decisionText = decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "requested changes on";
        const newActivity: ActivityLog = {
          id: generateId("act"),
          organizationId: state.organization.id,
          userId: state.currentUserId,
          requestId,
          eventType: decision === "APPROVED" ? "REQUEST_APPROVED" : decision === "REJECTED" ? "REQUEST_REJECTED" : "STATUS_CHANGE",
          description: `${user?.name ?? "User"} ${decisionText} ${req.requestNumber} at the ${currentStage.replace("_", " ").toLowerCase()} stage${comment ? ` — "${comment}"` : ""}`,
          createdAt: now,
        };
        set((s) => ({ activities: [newActivity, ...s.activities] }));

        // Create notification for the requester
        const notification: Notification = {
          id: generateId("ntf"),
          organizationId: state.organization.id,
          userId: req.requestedById,
          title: `${req.requestNumber} ${decisionText}`,
          message: `${user?.name} ${decisionText} your request: "${req.title}"${comment ? ` — ${comment}` : ""}`,
          type: decision === "APPROVED" ? "success" : decision === "REJECTED" ? "error" : "warning",
          read: false,
          link: "requests",
          createdAt: now,
        };
        set((s) => ({ notifications: [notification, ...s.notifications] }));
      },

      cancelRequest: (requestId) => {
        const now = new Date().toISOString();
        set((s) => ({
          requests: s.requests.map((r) =>
            r.id === requestId ? { ...r, status: "CANCELLED", updatedAt: now } : r
          ),
        }));
        const req = get().requests.find((r) => r.id === requestId);
        const user = get().users.find((u) => u.id === get().currentUserId);
        if (req) {
          set((s) => ({
            activities: [
              {
                id: generateId("act"),
                organizationId: get().organization.id,
                userId: get().currentUserId,
                requestId,
                eventType: "STATUS_CHANGE",
                description: `${user?.name ?? "User"} cancelled ${req.requestNumber}`,
                createdAt: now,
              },
              ...s.activities,
            ],
          }));
        }
      },

      // Vendors
      createVendor: (data) => {
        const now = new Date().toISOString();
        const newVendor: Vendor = {
          ...data,
          id: generateId("vnd"),
          organizationId: get().organization.id,
          rating: 0,
          status: "PROSPECTIVE",
          totalOrders: 0,
          totalValue: 0,
          createdAt: now,
        };
        set((s) => ({ vendors: [newVendor, ...s.vendors] }));
        const user = get().users.find((u) => u.id === get().currentUserId);
        set((s) => ({
          activities: [
            {
              id: generateId("act"),
              organizationId: get().organization.id,
              userId: get().currentUserId,
              eventType: "VENDOR_ADDED",
              description: `${user?.name ?? "User"} added new vendor: ${data.companyName}`,
              createdAt: now,
            },
            ...s.activities,
          ],
        }));
      },

      updateVendor: (id, data) =>
        set((s) => ({
          vendors: s.vendors.map((v) => (v.id === id ? { ...v, ...data } : v)),
        })),

      archiveVendor: (id) =>
        set((s) => ({
          vendors: s.vendors.map((v) =>
            v.id === id ? { ...v, status: v.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" } : v
          ),
        })),

      // RFQs
      createRFQ: (data) => {
        const seq = get().rfqs.length + 1;
        const id = generateId("rfq");
        const now = new Date().toISOString();
        const newRFQ: RFQ = {
          id,
          organizationId: get().organization.id,
          rfqNumber: generateRfqNumber(seq),
          requestId: data.requestId,
          title: data.title,
          description: data.description,
          deadline: data.deadline,
          status: "WAITING",
          invitedVendorIds: data.invitedVendorIds,
          quotations: [],
          createdAt: now,
        };
        set((s) => ({ rfqs: [newRFQ, ...s.rfqs] }));
        const user = get().users.find((u) => u.id === get().currentUserId);
        const vendorCount = data.invitedVendorIds.length;
        set((s) => ({
          activities: [
            {
              id: generateId("act"),
              organizationId: get().organization.id,
              userId: get().currentUserId,
              eventType: "RFQ_CREATED",
              description: `${user?.name ?? "User"} created ${newRFQ.rfqNumber}: '${newRFQ.title}' — invited ${vendorCount} vendor${vendorCount !== 1 ? "s" : ""}`,
              createdAt: now,
            },
            ...s.activities,
          ],
        }));
        return id;
      },

      // Quotations
      selectQuotation: (rfqId, quotationId) => {
        const now = new Date().toISOString();
        set((s) => ({
          rfqs: s.rfqs.map((r) =>
            r.id === rfqId ? { ...r, selectedQuotationId: quotationId, status: "CLOSED" } : r
          ),
        }));
        const rfq = get().rfqs.find((r) => r.id === rfqId);
        const quote = rfq?.quotations.find((q) => q.id === quotationId);
        const vendor = get().vendors.find((v) => v.id === quote?.vendorId);
        const user = get().users.find((u) => u.id === get().currentUserId);
        if (rfq && vendor && quote) {
          set((s) => ({
            activities: [
              {
                id: generateId("act"),
                organizationId: get().organization.id,
                userId: get().currentUserId,
                eventType: "STATUS_CHANGE",
                description: `${user?.name ?? "User"} selected ${vendor.companyName}'s quotation ($${quote.totalAmount.toLocaleString()}) for ${rfq.rfqNumber}`,
                createdAt: now,
              },
              ...s.activities,
            ],
          }));
        }
      },

      // POs
      generatePO: (data) => {
        const seq = get().purchaseOrders.length + 1;
        const id = generateId("po");
        const now = new Date().toISOString();
        const subtotal = data.lineItems.reduce((s, li) => s + li.quantity * li.estimatedCost, 0);
        const vendor = get().vendors.find((v) => v.id === data.vendorId);
        const newPO: PurchaseOrder = {
          id,
          organizationId: get().organization.id,
          poNumber: generatePoNumber(seq),
          requestId: data.requestId,
          rfqId: data.rfqId,
          quotationId: data.quotationId,
          vendorId: data.vendorId,
          status: "ISSUED",
          totalAmount: subtotal,
          currency: "USD",
          taxRate: 7.5,
          issuedAt: now,
          expectedDelivery: data.expectedDelivery,
          notes: data.notes,
          lineItems: data.lineItems,
        };
        set((s) => ({ purchaseOrders: [newPO, ...s.purchaseOrders] }));
        const user = get().users.find((u) => u.id === get().currentUserId);
        if (vendor) {
          set((s) => ({
            vendors: s.vendors.map((v) =>
              v.id === vendor.id
                ? { ...v, totalOrders: v.totalOrders + 1, totalValue: v.totalValue + subtotal, status: "ACTIVE" }
                : v
            ),
          }));
        }
        set((s) => ({
          activities: [
            {
              id: generateId("act"),
              organizationId: get().organization.id,
              userId: get().currentUserId,
              purchaseOrderId: id,
              eventType: "PO_GENERATED",
              description: `${user?.name ?? "User"} generated Purchase Order ${newPO.poNumber} to ${vendor?.companyName ?? "vendor"} ($${subtotal.toLocaleString()})`,
              createdAt: now,
            },
            ...s.activities,
          ],
        }));
        return id;
      },

      updatePOStatus: (poId, status) => {
        const now = new Date().toISOString();
        const po = get().purchaseOrders.find((p) => p.id === poId);
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((p) =>
            p.id === poId ? { ...p, status } : p
          ),
        }));
        if (po) {
          const user = get().users.find((u) => u.id === get().currentUserId);
          set((s) => ({
            activities: [
              {
                id: generateId("act"),
                organizationId: get().organization.id,
                userId: get().currentUserId,
                purchaseOrderId: poId,
                eventType: "STATUS_CHANGE",
                description: `${user?.name ?? "User"} updated ${po.poNumber} status to ${status.replace("_", " ").toLowerCase()}`,
                createdAt: now,
              },
              ...s.activities,
            ],
          }));
        }
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
    }),
    {
      name: "nextmav-procure-store",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage))),
      partialize: (s) => ({
        theme: s.theme,
        // Don't persist most state — seed data is rich enough; users get fresh demo each load
      }),
    }
  )
);

// Selector hooks
export const useCurrentUser = () => {
  return useStore((s) => s.users.find((u) => u.id === s.currentUserId) ?? s.users[0]);
};

export const useUserById = (id?: string) =>
  useStore((s) => s.users.find((u) => u.id === id));

export const useDepartmentById = (id?: string) =>
  useStore((s) => s.departments.find((d) => d.id === id));

export const useVendorById = (id?: string) =>
  useStore((s) => s.vendors.find((v) => v.id === id));

export const useUnreadNotificationCount = () =>
  useStore((s) => s.notifications.filter((n) => !n.read).length);
