// NextMav Procure — tenant isolation.
//
// §23 of the mandate is explicit: an `organizationId` column does not make a system
// multi-tenant. What makes it multi-tenant is that a developer *cannot* write a
// query that forgets the filter.
//
// `tenantDb(organizationId)` returns a Prisma client extension that injects the
// organization filter into every operation on every tenant-scoped model, including
// `findUnique`, `update` and `delete` (Prisma 5+ permits non-unique filters
// alongside a unique field in those where clauses — so a cross-tenant id lookup
// resolves to null rather than to another tenant's row).
//
// Models NOT in TENANT_MODELS are either global infrastructure (RateLimitBucket)
// or reachable only through an already-scoped parent via a cascade relation
// (RequestLineItem, POLineItem, …). Those are covered because the parent query
// is scoped; adding an organizationId to them would be denormalisation for its
// own sake.

import { Prisma } from "@prisma/client";
import { db } from "./db";
import { notFound } from "./errors";

/** Models carrying `organizationId` directly. Every one of these is auto-filtered. */
const TENANT_MODELS = new Set<string>([
  "Branch",
  "Department",
  "User",
  "RolePermissionOverride",
  "SupplierUser",
  "Vendor",
  "PurchaseRequest",
  "RequestTemplate",
  "RecurringRequest",
  "ApprovalWorkflow",
  "RFQ",
  "PurchaseOrder",
  "GoodsReceipt",
  "Invoice",
  "Payment",
  "Budget",
  "Contract",
  "Asset",
  "InventoryItem",
  "StoredFile",
  "DocumentRecord",
  "ActivityLog",
  "AuditLogEntry",
  "Notification",
  "Integration",
  "SavedView",
  "AIConversation",
  "DigitalSignature",
  "WebhookDelivery",
  "DocumentSequence",
]);

/** Operations whose `args.where` must carry the tenant filter. */
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

/** Operations that write new rows and must have the tenant stamped on. */
const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

function stampCreateData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((d) => stampCreateData(d, organizationId));
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // A caller that explicitly set organizationId keeps it — the guard below in
    // `assertSameOrg` is what catches an attempt to set a *different* tenant.
    if (obj.organizationId === undefined && obj.organization === undefined) {
      return { ...obj, organizationId };
    }
  }
  return data;
}

export type TenantClient = ReturnType<typeof tenantDb>;

export function tenantDb(organizationId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) {
            return query(args);
          }

          const a = (args ?? {}) as AnyArgs;

          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), organizationId };
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === "upsert") {
              a.where = { ...(a.where ?? {}), organizationId };
              if (a.create) a.create = stampCreateData(a.create, organizationId) as Record<string, unknown>;
            } else if (a.data !== undefined) {
              a.data = stampCreateData(a.data, organizationId);
            }
          }

          return query(a);
        },
      },
    },
  });
}

/**
 * Belt-and-braces check for records fetched through an un-scoped path (a nested
 * `include`, a raw query, a relation traversal). Throws NOT_FOUND — never
 * FORBIDDEN — because telling a caller "this exists but is not yours" is itself
 * a cross-tenant information leak.
 */
export function assertSameOrg<T extends { organizationId: string }>(
  record: T | null | undefined,
  organizationId: string,
  label = "Record"
): T {
  if (!record || record.organizationId !== organizationId) {
    throw notFound(`${label} not found`);
  }
  return record;
}

/** The client handed to a `tenantTransaction` callback: tenant-scoped and transactional. */
export type TenantTx = Omit<
  TenantClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Transaction helper that keeps the tenant scope inside the transaction.
 *
 * The order matters: `$extends` is applied first and `$transaction` is called on
 * the *extended* client, so the callback's `tx` carries the tenant filter. Calling
 * `db.$transaction` and building the extended client inside the callback would
 * produce a client bound to the pool rather than to the transaction — writes would
 * escape the transaction while appearing to be inside it.
 */
export async function tenantTransaction<R>(
  organizationId: string,
  fn: (tx: TenantTx) => Promise<R>,
  options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }
): Promise<R> {
  return tenantDb(organizationId).$transaction(
    (tx) => fn(tx as unknown as TenantTx),
    options
  );
}
