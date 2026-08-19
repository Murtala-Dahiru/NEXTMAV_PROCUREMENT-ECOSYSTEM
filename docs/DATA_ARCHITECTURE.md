# NextMav Procure — Data Architecture

**Phase 1 · database, data architecture and procurement business logic**
Database: Supabase PostgreSQL 17 · ORM: Prisma 6 · 84 tables · 64 enums

This document describes what the database *is* and why it is shaped that way. It
is the reference for anyone extending the schema; the schema file itself carries
the same reasoning inline, model by model.

---

## 1. Connection and environment

The application reaches Supabase through the Supavisor pooler, never through the
direct host:

| Variable | Mode | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | transaction | 6543 | the application at runtime |
| `DIRECT_DATABASE_URL` | session | 5432 | `prisma migrate` only |

Two things force this. Serverless containers come and go per request, so runtime
connections must come from a pooler or the database runs out of them. And new
Supabase projects publish `db.<ref>.supabase.co` over IPv6 only, which many
workstations and CI runners cannot route — the pooler answers on IPv4.

Migrations use session mode because DDL needs a real session, which a
transaction-mode pooler cannot provide.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are safe in
the browser. `SUPABASE_SECRET_KEY` and both database URLs are server-only and
must never appear in a `NEXT_PUBLIC_` name.

### Supabase exposure

Supabase publishes every table in the `public` schema through PostgREST, so the
publishable key that ships to the browser could otherwise read the entire tenant
database over HTTPS. Migration `20260819000200_supabase_rls_lockdown` enables
row-level security with **no policies** on every table and revokes `anon` and
`authenticated` access outright. Prisma connects as the table owner, and an owner
bypasses RLS unless `FORCE` is set — which it deliberately is not.

Verified: `GET /rest/v1/Vendor` with the publishable key returns
`permission denied for table Vendor`.

**Any migration that creates a table must be followed by `npm run db:harden`**,
which re-applies the lockdown to whatever is new.

---

## 2. Multi-tenancy

Every tenant-scoped table carries `organizationId` and is indexed on it. That
alone does not make a system multi-tenant — what does is that a developer cannot
write a query that forgets the filter:

- `src/server/tenancy.ts` wraps Prisma in an extension that injects the
  organization filter into every operation on all **43** tenant-scoped models,
  including `findUnique`, `update` and `delete` by primary key. A cross-tenant id
  lookup resolves to null rather than to another tenant's row.
- Route handlers receive `tdb` (already scoped) from `withUser`. They have no
  other way to obtain a client.
- `tenantTransaction()` applies the extension *before* `$transaction`, so scoping
  survives inside a transaction rather than being silently dropped.

Users are org-scoped rows: `@@unique([organizationId, email])` means the same
person can exist in two organizations without either being able to see the other.

---

## 3. Money and quantities

Every money and quantity column is `numeric(18,4)`; rates are `numeric(9,4)`.
Postgres sums them exactly, so a budget ledger cannot drift the way a column of
`double precision` does.

Prisma surfaces `numeric` as `Decimal` objects, which would push a decimal type
through every service and every view. Instead `src/server/decimal-fields.ts` — a
generated client extension covering 79 columns across 29 models — converts them
back to `number` on read, including nested `include`s and reads inside
transactions. Writes are unaffected: Prisma accepts a number for a `numeric`
column.

The one place the extension does not reach is aggregates: `_sum` and `_avg` still
return `Decimal`, and the compiler points at every call site that must convert.
That is deliberate — those are exactly the places where silent coercion would
corrupt a total.

Regenerate the map with `npm run db:generate` after changing the schema.

---

## 4. Identity, roles and permissions

```
Organization → User → UserRoleAssignment → Role → RolePermission
```

What is code and what is data:

- **Code** — the permission *catalog*: 59 `Permission` literals in
  `src/lib/types.ts`. It enumerates what the application knows how to check, so a
  permission that no code gates cannot be invented.
- **Data** — roles, the permissions each grants, and who holds which. An
  organization can define "Category Buyer", permission it precisely, and route
  approvals to it with no deploy.

Fourteen system roles are installed per organization
(`src/server/roles.ts`): Administrator, Executive, Procurement Manager,
Procurement Officer, Finance Manager, Finance Officer, Department Manager,
Approver, Vendor Manager, Warehouse/Receiving Officer, Asset Manager, Requester,
Employee, Auditor. Re-running the installer refreshes descriptions but never
restores a permission an administrator removed.

Resolution order (`src/server/permissions.ts`):

1. per-user `customPermissions` — a full replacement, if set
2. the union of every role the user holds
3. the `Role` row matching their legacy enum value — bootstrap only
4. the built-in defaults for that enum — so a database with no roles installed
   still authorises rather than locking everybody out

Supplier users are a **separate identity realm**: different table, different
cookie, different resolver, no `role` and no `userId`. A supplier principal is
structurally incapable of satisfying an internal permission check.

---

## 5. The procurement chain

```
Organization
  └─ Department (hierarchical) ─ CostCenter ─ Branch ─ Warehouse
       └─ Budget ── BudgetEntry (append-only ledger)
            └─ PurchaseRequest ── RequestLineItem
                 ├─ ApprovalInstance ── ApprovalStep
                 ├─ RFQ ── RFQLineItem · RFQVendor · RFQEvaluationCriterion
                 │     └─ Quotation ── QuotationLineItem · QuotationScore
                 │          └─ RFQAward
                 └─ PurchaseOrder ── POLineItem
                      ├─ GoodsReceipt ── GoodsReceiptItem
                      │     ├─ StockMovement ── StockBalance ── InventoryItem
                      │     └─ Asset
                      └─ Invoice ── InvoiceLineItem · InvoiceMatchException
                           └─ Payment ── PaymentAllocation · PaymentTransaction
```

Vendors hang off the second axis: profile, contacts, categories, compliance
documents, risk assessments, performance snapshots, contracts, RFQ invitations,
quotations, orders, receipts, invoices, payments.

### Lifecycles

Every status change goes through `src/server/state-machine.ts`. A service never
assigns `status` directly, so a document cannot skip a stage or be revived from a
terminal state.

**Purchase request**
`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → IN_PROCUREMENT → ORDERED →
PARTIALLY_FULFILLED → FULFILLED → CLOSED`, with `RETURNED` (revision requested),
`REJECTED` and `CANCELLED`. The fulfilment states are *derived* from receipts and
payments, not set by hand.

**Purchase order**
`DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → ACKNOWLEDGED → PARTIALLY_RECEIVED
→ RECEIVED → CLOSED`, plus `REJECTED` and `CANCELLED`. `PARTIALLY_RECEIVED` and
`RECEIVED` are reachable from each other because a receipt corrected downward is a
legitimate correction, not an illegal move.

Invoices, payments, RFQs, quotations, receipts and contracts each have their own
table in the same module.

### The four quantities

`POLineItem` tracks `orderedQty`, `receivedQty`, `rejectedQty` and `invoicedQty`
independently, and `GoodsReceiptItem` adds `deliveredQty` and `damagedQty`.
Ordered is never overwritten by a receipt. Outstanding is derived:
`ordered − received − rejected`.

`receivedQty` means *accepted*. `condition` annotates why units were turned away;
it never suppresses the accepted ones.

---

## 6. Approvals

The engine is generic. `ApprovalWorkflow` carries an `entityType`, so the same
machinery governs requests, purchase orders, invoices, payments, contracts and
budgets. Workflows are **versioned** rather than edited in place: an in-flight
approval keeps the version it started under, and `supersededById` links the chain.

`ApprovalInstance` is one running approval over one entity; `ApprovalStep` rows
hang off it. Selection is by predicate — amount band, priority, department,
category — with the narrower band winning. Stages sharing a `sequence` run in
parallel. A stage may target a configured `Role` by id, which is what lets an
organization route approval to a role the enum has never heard of.

`ApprovalDelegation` holds standing delegations ("while I am away, my approvals go
to Chidi"), applied when the chain is built. The per-step `delegatedToId` records
a delegation that actually happened.

Decisions are gated: only the assigned approver (or their delegate) of the
*currently active* step, and only while it is pending.

---

## 7. Budget

`BudgetEntry` is an append-only ledger; the columns on `Budget` are rollups
recomputed from it, so every headline figure is reconstructable rather than
asserted.

| Movement | Written when | Effect on availability |
|---|---|---|
| `REQUESTED` | request submitted | none — demand signal only |
| `RESERVED` | request approved | claims budget |
| `COMMITTED` | PO issued | claims budget; releases the reservation |
| `SPENT` | invoice approved | recognises the liability; reduces the commitment |
| `PAID` | payment completed | none — already counted at invoice |
| `RELEASED` | cancelled or rejected | negates an earlier claim |

`REQUESTED` and `PAID` are reported, not deducted. Deducting either would
double-count the same money.

Every figure on a budget reconciles against its ledger, including the seeded
demo data: the seed writes opening-balance entries rather than asserting totals,
so the invariant holds from the first boot.

`enforceHardLimit` blocks a reservation or commitment that would exceed the
budget, and the projection is read from the ledger inside the transaction — not
from the rollup columns, which would let two concurrent approvals both see room
that only one of them has.

---

## 8. Three-way matching

`PO ↔ receipt ↔ invoice`, run on invoice entry and again on approval.

The invoice keeps a headline `matchStatus`; `InvoiceMatchException` rows are the
evidence: type, the ordered/received/invoiced quantities, ordered and invoiced
prices, the variance, and the tolerance that was in force when the match ran.
Exceptions open as `OPEN` and must be accepted, disputed or resolved by a named
person — re-running the match never erases a decision somebody made.

Duplicate supplier invoices are blocked twice: by the service, and by
`@@unique([organizationId, vendorId, vendorInvoiceRef])`.

---

## 9. Inventory and assets

Stock is transactional. `StockMovement` is an append-only ledger carrying
`balanceAfter`; `StockBalance` holds the per-warehouse quantity; `InventoryItem`
holds the total. All three are written in one transaction, so they cannot
disagree. Item cost is a moving average, so valuation reflects what was paid.

Posting a receipt creates one `Asset` per accepted unit for lines flagged
`createsAsset` — an asset register tracks individual items, so receiving three
laptops creates three tagged assets, not one row of three. Each traces back to the
receipt line, the PO line, the order and the supplier.

---

## 10. Payments

`PaymentAllocation` records how a payment is split across invoices, and invoice
balances are derived from allocations rather than from payment totals — one
consolidated payment settles five invoices by the right amount each.

`PaymentTransaction` records every attempt, including failures, so a payment that
failed twice before clearing keeps that history against one record. It is the seam
a payment provider plugs into; no provider is implemented, and the schema records
that rather than pretending otherwise.

Separation of duties is enforced: the person who raised a payment cannot approve
it. The same rule applies to purchase order approval.

---

## 11. Documents, events and audit

**Documents** — `StoredFile` holds bytes; `DocumentRecord` is the library entry;
`DocumentLink` attaches one document to many records across twelve entity types,
which a single foreign key cannot express.

**Events** — `EventOutbox` is a transactional outbox. Services call
`enqueue(tx, event)` *inside* the business transaction, so an event is committed
with the change or not at all. `drain()` delivers afterwards with retry and
backoff, and is triggered after every mutating request. Without this, a
notification can be sent for an approval that later rolled back, or a committed
approval can silently notify nobody.

**Audit** — `AuditLogEntry` is append-only with server-captured IP and user agent.
`before` and `after` are `jsonb`, with `changedFields` alongside, so an auditor can
ask "every change that touched `totalAmount`" in SQL instead of pattern-matching
text. Nothing in the codebase updates or deletes rows in this table.

---

## 12. Integrity

- **202 foreign keys.** Every one is indexed (Postgres does not do this for you)
  and every one declares an explicit delete policy: `Cascade` for rows meaningless
  without their parent, `SetNull` for optional links, `Restrict` for references to
  business records. You cannot delete a user who raised a request, a vendor with
  orders, or an invoice with payments.
- **369 indexes**, including composite indexes on the filters the product actually
  uses: `(organizationId, status)`, `(organizationId, createdAt)`.
- **38 check constraints.** Quantities and amounts are non-negative, an invoice
  cannot be overpaid or fall due before it was issued, a payment cannot be for
  zero, stock cannot go negative, a contract cannot end before it starts, a fiscal
  quarter is 1–4. These hold no matter which process writes the row.
- **Human-facing numbers** (`PR-`, `RFQ-`, `PO-`, `GRN-`, `INV-`, `PAY-`) are
  unique *per organization*, allocated by `DocumentSequence` with an atomic
  per-tenant counter rather than a table scan.

---

## 13. Transactions

Critical operations are atomic, per §23 of the mandate. Approving a request
writes the decision, closes the approval instance, moves the request status,
records the budget reservation and queues the notification in **one**
transaction — a hard-limit breach therefore blocks the approval rather than being
swallowed. The same applies to PO issue (commitment, vendor order book, request
status), receipt posting (PO quantities, stock ledger, balances, assets, receipt
status), invoice approval (invoiced quantities, match record, status, budget) and
payment settlement (status, transaction record, budget, allocation).

Two settings matter and neither default is right here.

`connection_limit` sizes Prisma's pool *inside one process*. The Supabase
documentation's `connection_limit=1` is correct for serverless — many short-lived
containers, one connection each — and wrong for a long-running server, where every
request queues behind the last and a request holding a transaction blocks the rest
of the process. The symptom is 10–20 second responses that look like a hang. This
deployment uses 10; set 1 on Vercel.

The client sets a 30-second interactive-transaction budget. Prisma's 5-second
default is generous against a local database and far too tight against a pooled
one in another region: a multi-line receipt pays a round trip per statement, and
when the budget runs out the work rolls back with `Transaction not found` rather
than anything useful. This was found by running the scenario suite against
Supabase, not by reading the docs.

---

## 14. Migrations

```bash
npm run db:migrate:new -- add_supplier_scorecards   # generate SQL from the diff
npm run db:migrate                                  # apply (prisma migrate deploy)
npm run db:harden                                   # re-apply RLS to new tables
npm run db:generate                                 # regenerate client + decimal map
```

`prisma migrate dev` is not used: it needs a shadow database it can create and
drop, and a hosted Supabase project does not grant that. `migrate diff` produces
the same SQL without one. `db push` is deliberately absent from the scripts — it
skips the migration history, and a database that cannot be recreated from
migrations is not reproducible.

Applied so far:

| Migration | What |
|---|---|
| `20260819000000_init` | 84 tables, 64 enums, 202 FKs, 235 indexes |
| `20260819000100_integrity_constraints` | 38 check constraints |
| `20260819000200_supabase_rls_lockdown` | RLS + revoke on every table |
| `20260819223716_add_detail_timestamps` | created/updated timestamps on line-item and detail tables |

---

## 15. Verification

```bash
npm run typecheck          # 0 errors
npm run verify:tenancy     # 8 checks  — cross-tenant read/update/delete blocked
npm run verify:scenarios   # 59 checks — the eight scenarios of §26
npm run verify:lifecycle   # 26 checks — transition tables and the revision path (server required)
npm run verify:journeys    # 72 checks — full P2P lifecycle over real HTTP (server required)
npm run verify:ui          # 18 checks — wired-button payloads persist (server required)
```

`verify:lifecycle` imports the real transition tables rather than a copy of them:
a mirror that drifted would pass while the application refused the same move.

`verify:scenarios` runs against the real database, in a throwaway tenant of its
own, and tears it down afterwards. It asserts on what the database actually
stored, never on what the application claims.
