# NextMav Procure — Platform Completeness Audit

**Date:** 2026-08-18
**Scope:** Full repository inspection prior to any implementation work.
**Verdict:** The product design is sound and largely complete. The *platform* underneath it does not exist yet.

---

## 0. Headline Finding

NextMav Procure is presently a **single-page front-end prototype**, not a partially-implemented
platform. This is not a value judgement about the work that exists — the domain model and the
UI are genuinely good — but it determines everything about what "finishing it" means.

Three facts establish this:

1. **Nothing persists.** `src/lib/store.ts:1842` configures Zustand `persist` with a
   `partialize` that writes only `theme`, `sidebarCollapsed`, `notificationPreference`, and
   `roleOverrides` to `localStorage`. Every purchase request, approval, PO, invoice, payment,
   receipt and audit entry a user creates is held in memory only and is **destroyed on page
   refresh**. The app reboots to `seed-data.ts` every time.
2. **There is no server.** The API surface is three routes: a hello-world (`src/app/api/route.ts`),
   an AI proxy, and a CSV echo endpoint. No route reads or writes application data.
   `src/lib/db.ts` exports a Prisma client that **is imported by zero files**.
3. **There is no authentication.** `LoginView` collects an email and password and discards both;
   `handleLogin` calls `login()` after a 700ms `setTimeout` (`src/components/views/login-view.tsx:31`).
   `login()` sets `isAuthed = true`. `next-auth` is a dependency and is imported nowhere.
   There is no `middleware.ts`.

Under the mandate's own taxonomy (§4), this means **no module can currently be classified higher
than "Simulated"**, because no module survives a refresh. That is the honest reading, and the
rest of this audit is written against it.

**What this does *not* mean:** it does not mean the architecture should be replaced. The domain
model in `types.ts`, the workflow logic in `store.ts`, the view layer, and the design language are
the foundation to build on. The work is to give them a real spine — not to redraw them.

---

## A. Existing Platform Map

### A.1 Application shell & routing

| Item | Reality |
|---|---|
| Routes | **One.** `src/app/page.tsx` renders `<LoginView/>` or `<AppShell/>`. |
| Navigation | Client state. `view: ViewKey` in Zustand; `AppShell` is a 40-case `switch`. |
| Consequences | No deep links, no shareable URLs, no browser back/forward, no SSR, no per-route code splitting, no `notFound`/`error` boundaries. F5 returns you to the dashboard with all work lost. |
| Layout | `src/app/layout.tsx`, `globals.css`, Tailwind v4 + shadcn/ui. |

### A.2 Views (33)

`dashboard` · `command-center` · `requests` · `request-detail` · `request-new` ·
`request-templates` · `approvals` · `vendors` · `vendor-detail` · `supplier-portal` · `rfqs` ·
`rfq-detail` · `rfq-new` · `purchase-orders` · `po-detail` · `goods-receipts` · `invoices` ·
`payments` · `contracts` · `assets` · `inventory` · `documents` · `budgets` · `activity` ·
`audit` · `notifications` · `reports` · `ai-assistant` · `integrations` · `settings` ·
`settings-roles` · `settings-workflows` · `settings-team`

Declared in `ViewKey` but **not routed** in `AppShell`: `quotations`, `search`,
`settings-branding` and `settings-security` (both fall through to `SettingsView`).

### A.3 State layer — `src/lib/store.ts` (1,877 lines)

A single Zustand store holding **all** domain data plus UI state, with ~90 actions. It is
simultaneously the database, the ORM, the service layer, the authorization layer and the
event bus. The business logic inside it is better than its reputation would suggest — see §B.

### A.4 Domain model — `src/lib/types.ts` (1,339 lines)

Genuinely strong. ~45 interfaces covering organizations, branches, departments, users, vendors
(+ documents, compliance, performance), requests (+ line items, approvals, comments, watchers,
versions), RFQs, quotations, POs (+ revisions), budgets, goods receipts, invoices, payments,
contracts, assets (+ maintenance, transfers), inventory (+ stock movements), supplier portal
users, documents (+ versions), integrations (+ config, logs, health), workflows, notifications,
activity and audit logs. **This is the asset to preserve.**

Also here: 35 `Permission` literals, `PERMISSION_LABELS`, `ROLE_PERMISSIONS` for 6 roles, and
`hasPermission()`.

### A.5 Persistence — `prisma/schema.prisma`

15 models. Its own header comment concedes the position: *"the interactive demo runs on a Zustand
store … but this schema documents the canonical persistence model."* It is documentation, not
infrastructure. It is also **substantially narrower than `types.ts`** — it has no models for
invoices, payments, contracts, assets, inventory, goods receipts, documents, budgets, workflows,
supplier portal users, comments, templates, or audit logs.

`.env` points `DATABASE_URL` at `file:/home/z/my-project/db/custom.db` — an absolute path from a
different machine. It cannot resolve here.

### A.6 API surface (3 routes)

| Route | Assessment |
|---|---|
| `GET /api` | Hello-world scaffold. Dead. |
| `POST /api/ai` | Real call to `z-ai-web-dev-sdk`. **No authentication, no org scoping.** Trusts a client-supplied `context` object for org name/spend/counts, so the "AI operates on authorized data" requirement (§20) is not met — it operates on whatever the browser claims. |
| `POST /api/export` | Accepts a client-supplied array and returns it as CSV. Performs no data access, so it enforces nothing. Any caller can render any payload. |

### A.7 Real-time — `mini-services/notification-service/index.ts` (169 lines)

A competent standalone Socket.IO server (rooms per user and per org, presence, typing, activity
relay). `src/hooks/use-realtime.ts` connects to it. **But no business event ever emits into it** —
the store's `logEvent` writes to local arrays and never touches the socket. The "Real-time
connected" indicator in the footer reflects a socket that carries no procurement traffic.

### A.8 Unused dependencies — the tell

| Package | Files using it |
|---|---|
| `@tanstack/react-query` | **0** |
| `zod` | **0** |
| `@tanstack/react-table` | **0** |
| `next-auth` | **0** |
| `next-intl` | 0 |
| `uuid` | 0 |
| `@dnd-kit/*`, `@mdxeditor/editor`, `react-syntax-highlighter` | 0 |

React Query, Zod and NextAuth being present-but-unused is the clearest possible signal: **the
server, validation and data-fetching layers were planned and never built.** Building them is
completing the intended architecture, not replacing it.

---

## B. Completeness Audit

Classified per §4. "Logic quality" rates the in-memory business logic on its own terms; every row
is capped at *Simulated* overall because nothing persists.

| Module | Class | Logic quality (in-memory) | Principal gap |
|---|---|---|---|
| Purchase Requests | Simulated | **Good** — line items, versioning, watchers, comments, templates | No persistence, no server validation, no permission check on mutation |
| Approvals | Simulated | **Good** — sequential staging, SLA timestamps, escalation flags, next-approver resolution | `approveRequest` never verifies the caller is the assigned approver; no parallel/conditional/delegation despite types supporting them |
| Workflow engine | Foundation only | Types model stages/thresholds/parallel/escalation/delegation richly | `approveRequest` mostly ignores the configured workflow — it walks a hardcoded 4-stage array and only reads `slaHours` from config |
| Vendors | Simulated | **Good** — status lifecycle, compliance docs, performance fields, auto-updated spend | Performance metrics are stored values, not derived from delivery/invoice history; trend chart is `Math.random()` (`vendor-detail-view.tsx:83`) |
| Supplier Portal | **Disconnected** | Internal *management* screen only | There is **no supplier-facing application**. No supplier auth, no separate session, no permission boundary. Requirement §7 (separated supplier permissions) is entirely unmet |
| RFQ & Sourcing | Simulated | Fair — creation, invitations, comparison, award | Quotations only ever arrive from seed data; no submission path exists because there is no supplier app |
| Purchase Orders | Simulated | **Good** — cross-module wiring to vendor stats, budget commitment, request closure | No PO approval gate; `generatePO` marks the request `COMPLETED` at PO issue, which is wrong — the request should close after receipt/invoice/payment |
| Goods Receiving | Simulated | Fair — partial/damaged/rejected quantities modelled | Receipt does not reconcile against outstanding PO quantities; inventory/asset creation is not driven from receipt |
| Invoices | Simulated | Fair | No 2-way/3-way matching (PO ↔ receipt ↔ invoice), no duplicate detection, no partial-payment balance tracking |
| Payments | Simulated | **Weak** | Status transitions only. No scheduling, no reconciliation, no finance approval gate, no failure handling. Correctly *not* claiming a bank integration — but the architecture has no seam for one either |
| Budgets | Simulated | Fair — commitment on PO issue | Does not model the full chain (§13): requested → approved → committed → ordered → received → invoiced → paid. No hard overspend block |
| Contracts | Simulated | Fair | Renewal alerts are not event-driven; obligations/amendments modelled but not operational |
| Inventory | Simulated | Fair — movements ledger exists | Not driven by goods receipt; reorder levels raise no notifications |
| Assets | Simulated | Fair — transfers, maintenance, depreciation fields | `Goods Receipt → Asset` creation (§16) is manual, not controlled business logic |
| Documents | Simulated | Fair — versions, categories, links | **No file storage of any kind.** Uploads record metadata only; there is no blob, no access control, no download |
| Reporting | **Simulated** | Weak | `reports-view.tsx:87-88` hardcodes `avgApprovalDays = 2.4` and `totalSaved = 38400`. Several dashboard metrics are similarly literal |
| Executive Command Center | Simulated | Fair — derives from store arrays | Metrics are real derivations of fake data; cycle-time and bottleneck figures are approximations |
| AI Copilot | **Enterprise gap** | Real LLM call | Unauthenticated endpoint; context is client-asserted; no tenant scoping; no tool access to real data |
| Integrations | **Simulated** | Config UI is genuinely detailed | No integration executes. `integrations-view.tsx:202` fabricates sync duration with `Math.random()`. No outbound HTTP anywhere |
| Notifications | Partial | In-app notifications fire on real store events | No delivery channel (email/Slack/SMS) despite `NotificationPreference` modelling them; not wired to the WebSocket service |
| Audit log | Partial | `logEvent` captures who/what/when/severity consistently | `ipAddress` is the hardcoded literal `"102.89.45.10"` (`store.ts`); no before/after state capture; log lives in memory and is client-mutable |
| Auth & session | **Missing** | — | Credentials discarded; no session; no server identity |
| Multi-tenancy | **Missing** | — | `organizationId` is populated on records, but with no queries there is nothing to scope. One hardcoded org |
| Authorization | **Enterprise gap** | Permission map is well designed | Enforced **only** in the UI. Store actions never call `hasPermission`. Violates §22 directly |
| File handling | Missing | — | No upload endpoint, no storage, no signed access |
| Search | Missing | `search` ViewKey exists, no view implements it | — |
| Quotations view | Missing | `quotations` ViewKey declared, never routed | — |

### B.1 Enumerated fabrications (§29)

- `reports-view.tsx:87` — `const avgApprovalDays = 2.4; // simulated`
- `reports-view.tsx:88` — `const totalSaved = 38400; // simulated`
- `vendor-detail-view.tsx:80-84` — performance trend generated with `Math.random()`
- `integrations-view.tsx:202` — sync duration fabricated with `Math.random()`
- `dashboard-view.tsx:67` — "Avg approval time (simulated)"
- `store.ts` `logEvent` — audit `ipAddress` hardcoded to `"102.89.45.10"`
- `login-view.tsx:31` — credentials discarded, `setTimeout(login, 700)`
- `app-shell.tsx` footer — Privacy / Terms / Status / Docs are `<button>`s with no handler
- `ui/sidebar.tsx:611` — skeleton widths randomised (cosmetic, acceptable)

---

## C. Cross-Module Gap Map

Where the store *does* connect modules it does so well. The gaps are specific:

| Required connection (§34) | Status |
|---|---|
| Request → Department → Budget | **Partial.** Budget is only touched at PO issue. A submitted or approved request reserves nothing, so a department can have unlimited requests approved against an exhausted budget |
| Request → Approval → Procurement | Wired |
| Request → RFQ → Vendor → PO | Wired |
| PO → Vendor stats | Wired (`generatePO` updates `totalOrders`/`totalValue`) |
| PO → Receiving | **Weak.** Receipts don't reconcile outstanding quantities; PO status isn't driven by cumulative receipt |
| Receiving → Inventory | **Broken.** Both exist; neither triggers the other |
| Receiving → Assets | **Broken.** §16 requires controlled creation; today it is manual re-entry |
| PO → Invoice → Payment | **Weak.** Links exist as IDs; no matching, no balance arithmetic, no gating |
| Invoice → Budget (actual spend) | **Missing.** `spentAmount` is never advanced by invoice or payment |
| Contract → Vendor → Compliance → Renewal | **Weak.** Data linked; no alerting or enforcement |
| Vendor → performance ← deliveries/invoices | **Missing.** Performance is stored, not computed |
| Any business event → WebSocket | **Missing.** Service runs; nothing publishes to it |
| Any business event → notification channel | **Missing.** In-app only |
| `Ordered ≠ Received ≠ Invoiced ≠ Paid` (§10) | **Not modelled.** These four quantities are not tracked distinctly per line item |

---

## D. Enterprise Gap Map

Ranked by what blocks production use.

1. **No persistence.** Blocks everything. (§28)
2. **No authentication or session.** Blocks everything security-related. (§22)
3. **No server-side authorization.** All 35 permissions are advisory. (§22)
4. **No tenant isolation.** Nothing to isolate yet; must be built in from the first query, not retrofitted. (§23)
5. **No input validation.** `zod` is installed and unused; no schema validates any mutation. (§27)
6. **No file storage.** Documents, vendor compliance certificates and attachments are metadata-only. (§17)
7. **Client-mutable audit log.** An audit trail the auditee can edit is not an audit trail. (§24)
8. **Unauthenticated AI endpoint.** `/api/ai` is open and trusts client-supplied context. (§20)
9. **No rate limiting, CSRF protection, or security headers.** (§22)
10. **No routing.** No deep links to a PO, request or invoice — a hard requirement for a system people email links about. (§27)
11. **Workflow engine unused.** Rich configuration exists; the approval path is hardcoded. (§25)
12. **No integration execution layer.** No outbound HTTP, no webhook dispatch, no retry/backoff. (§21)
13. **No pagination anywhere.** Every list renders its full array. Fine at seed scale, fails at 50k POs. (§27)
14. **No tests, no CI.** Zero test files in the repository.
15. **Build config unresolved.** `node_modules` was absent; `DATABASE_URL` points at a foreign absolute path; `package.json` build script uses `cp` and assumes standalone output.

---

## E. Implementation Roadmap

The sequencing constraint: **persistence and identity must land before anything else is worth
hardening.** Deepening a module that evaporates on refresh is wasted work.

The strategy throughout is *transplant, not rewrite* — the business logic in `store.ts` is moved
into a server service layer largely intact, and Zustand is demoted from "the database" to "a
client cache" fronted by React Query. Every view, component, and design decision stays.

### P0 — Make it a real system

| # | Work | Why |
|---|---|---|
| P0.1 | Extend `prisma/schema.prisma` from 15 → full coverage of `types.ts`; fix `DATABASE_URL`; migrate; write a seed script that loads today's `seed-data.ts` into the DB | The demo data becomes real data |
| P0.2 | Real auth: NextAuth credentials provider, password hashing, server session, `middleware.ts` route protection, working login form | Identity is a precondition for authorization and audit |
| P0.3 | Server service layer + API routes per domain, with **org scoping enforced in a shared query guard**, Zod validation on every mutation, and server-side permission checks | The spine |
| P0.4 | Rewire the client: React Query for reads/mutations; Zustand keeps UI state only. **No view redesigned** | Persistence reaches the UI |
| P0.5 | Server-authoritative audit log — append-only, real IP/user-agent, before/after state | Makes it auditable |

### P1 — Complete the P2P lifecycle

| # | Work |
|---|---|
| P1.1 | Model `ordered / received / invoiced / paid` per line item; drive PO status from cumulative receipt; stop closing requests at PO issue |
| P1.2 | Receipt → Inventory movement and Receipt → Asset creation as controlled server transactions |
| P1.3 | Invoice 3-way matching (PO ↔ receipt ↔ invoice), duplicate detection, balance and partial-payment arithmetic |
| P1.4 | Payment lifecycle with finance approval gate, scheduling, failure/retry and reconciliation — with a provider interface seam, explicitly unimplemented rather than faked |
| P1.5 | Budget chain: reserve on approval, commit on PO, actualise on invoice/payment; overspend controls |
| P1.6 | Activate the workflow engine — `approveRequest` reads configured stages, thresholds, parallel/sequential, delegation, escalation |
| P1.7 | URL routing under App Router, preserving the existing navigation structure exactly; deep links for every entity |
| P1.8 | File storage: upload endpoint, access-controlled download, versioning |
| P1.9 | Supplier portal as a genuinely separate authenticated surface with its own session and permission set |
| P1.10 | Replace every hardcoded metric with a real query; delete the `Math.random()` charts |

### P2 — Enterprise hardening

Rate limiting · security headers · CSRF · notification delivery channels (email + Slack) driven by
real events · WebSocket publication from server business events · integration execution layer with
logs, health and retry · derived vendor performance scorecards · contract renewal alerting ·
pagination, filtering and sorting server-side · reporting queries.

### P3 — Enhancement

Saved views · bulk actions · MFA · SSO · advanced analytics · request recurrence · i18n
(`next-intl` already installed).

---

## Position on scope

Per §37 I am keeping the domain model, the view layer, the component library, the design
language, the navigation structure and the terminology. Three changes are architectural and I
want them explicit because they are the ones that could look like redesign:

1. **Prisma schema is substantially expanded.** Required — it currently cannot store most of the
   product.
2. **Business logic moves from `store.ts` to a server service layer.** Required — logic that runs
   only in the browser cannot be authoritative, authorized, or audited. The logic itself is
   largely preserved, not rewritten.
3. **Client-state navigation becomes URL routing.** Recommended, P1. This is the one item that is
   arguably a preference rather than a necessity; I rate it a necessity because an enterprise
   system whose records cannot be linked to is not usable by a real organization.

---

## Implementation status

### P0.1 — Persistence · **done**

- `prisma/schema.prisma` expanded from 15 models to **64 tables**, covering the whole of
  `types.ts` plus the structures the product needed and lacked: `POLineItem` with independent
  `ordered / received / rejected / invoiced` quantities, `BudgetEntry` as an append-only ledger
  behind the budget rollups, `StoredFile` for real blobs, `SupplierUser`/`SupplierSession` as a
  separate identity realm, `DocumentSequence` for race-free numbering, and delivery queues for
  notifications and webhooks.
- `DATABASE_URL` fixed (it pointed at `/home/z/my-project/db/custom.db`, a path from another
  machine). Schema pushed **non-destructively** — no reset was required.
- `prisma/seed.ts` loads the existing demo dataset from `src/lib/seed-data.ts` into the database
  with original ids preserved. All 32 enum-valued fields were validated against the new schema
  before seeding; exactly one legacy value (`Payment.status = "PENDING"`) needed mapping, to
  `PENDING_APPROVAL`, because the payment lifecycle now has an explicit finance gate.
- Verified: 9 requests, 16 approval steps, 6 POs, 3 goods receipts, 6 invoices, 12 vendors and
  the rest are live rows. `ordered ≠ received` is now true *of the data* — PO-2026-0003 carries
  4 units ordered against 2 received.

### P0.2 — Authentication · **done**

- Password hashing via scrypt (`src/server/password.ts`), self-describing hashes, constant-time
  comparison, and equal work burned on a missing hash so timing does not enumerate accounts.
- **Two separate authentication realms**, per §7: employees (`nextmav.sid` → `Session`) and
  suppliers (`nextmav.supplier_sid` → `SupplierSession`). Different cookies, different tables,
  different resolvers. A supplier principal carries no `role` and no `userId`, so it is
  structurally incapable of satisfying an internal permission check.
- Session tokens are stored as SHA-256 fingerprints; a dump of the session table does not let
  the holder impersonate anyone.
- Verified end-to-end: wrong password and unknown email return byte-identical 401s; validation
  errors return 422 with field paths; login issues an httpOnly cookie; the session endpoint
  returns the user, organization and 36 resolved permissions; logout removes the row.

### P0.3 — Server foundation · **in progress**

Done:
- `tenancy.ts` — a Prisma client extension that injects the organization filter into every
  operation on all 31 tenant-scoped models. **Verified by `npm run verify:tenancy`: 8/8**,
  including that a cross-tenant `findUnique`, `update` and `delete` by primary key all fail
  while same-tenant access is unaffected and `create` auto-stamps the tenant.
- `permissions.ts` — server-side enforcement with the documented resolution order
  (per-user override → per-org role override → role default).
- `http.ts` — `withUser` / `withSupplier` / `withPublic` wrappers providing authentication,
  tenant-scoped client, Zod validation, database-backed rate limiting, and error translation.
  A route cannot ship without these because it has no other way to obtain a principal.
- `audit.ts` — append-only audit plus the presentational activity feed, with **real** IP and
  user agent from request headers. Confirmed in the database: `ip=::1  ua=curl/8.19.0`,
  replacing the hardcoded `"102.89.45.10"` literal.
- `numbering.ts` — per-tenant, per-year atomic counters. Existing formats (`PR-2026-0001`)
  unchanged; counters seeded to continue from the demo data rather than collide with it.

Remaining: per-domain services and routes; client rewiring onto React Query (P0.4).

---

## Implementation status — round 2

### Verification suite

```bash
npm run typecheck && npm run verify:tenancy && npm run verify:journeys && npm run verify:ui
```

| Suite | Checks | Result |
|---|---|---|
| `verify:tenancy` | 8 | cross-tenant read/update/delete all blocked |
| `verify:journeys` | 72 | full P2P lifecycle over real HTTP |
| `verify:ui` | 18 | every wired button payload persists |
| **Total** | **98** | **passing** |

### Built

**Engines** — `workflow.ts` (selection by threshold/priority/department/category,
parallel sequences, conditional stages, delegation rules, SLA, escalation targets),
`budget.ts` (append-only ledger: reserved → committed → spent, hard limits, threshold
alerts), `events.ts` (typed domain events fanned out to in-app, delivery queue,
webhook queue and the realtime socket).

**Services** — request, RFQ/sourcing, purchase order, receiving, invoice, payment,
bootstrap. 37 API routes.

**Corrections to prior behaviour, each covered by a test:**

| Was | Now |
|---|---|
| Any user could advance any pending approval | Only the assigned approver of the currently active step |
| Approval chain was a hardcoded 4-stage array | Built from the configured workflow |
| PO issue marked the request `COMPLETED` | Request completes after receipt **and** payment |
| Receipts never touched inventory or assets | Posting a receipt moves stock and registers assets |
| PO status set by hand | Derived from cumulative receipts |
| No invoice matching | 2-way and 3-way with price/quantity variance detection |
| No duplicate invoice check | Blocked by service and a unique index |
| Payments were a status field | Approval gate with **separation of duties**, scheduling, failure/retry, reconciliation |
| Budget touched once, at PO issue | Full chain, reconstructable from the ledger |
| Vendor performance was a stored number; chart used `Math.random()` | Derived from real delivery and rejection history |
| Login rate limit keyed on IP | Keyed per account — an office behind one NAT no longer locks itself out |

### Two bugs the tests caught

1. **Receiving suppressed accepted units.** A line recording "6 accepted, 2 damaged"
   posted nothing to stock, because the code gated on `condition === "GOOD"`.
   `receivedQty` already means *accepted*; `condition` annotates the rejection.
2. **Rate limiting locked out shared IPs.** Surfaced by running three suites in
   sequence; the fix is per-account throttling, which also matches the actual threat.

### Not yet done — stated plainly

- **Supplier portal has no supplier-facing application.** Identity, sessions, login,
  invitation activation and isolation are built and the internal management screen
  works, but suppliers cannot yet log in and quote for themselves. §10 is unmet.
- **Only the P2P spine's mutations are server-backed.** Vendor, contract, asset,
  inventory, document, budget, workflow and settings *writes* still mutate local
  state and will not survive a refresh. Their reads are real.
- **`reports-view.tsx:87-88` still hardcodes** `avgApprovalDays = 2.4` and
  `totalSaved = 38400`; `vendor-detail-view.tsx` still charts `Math.random()`.
- **No file storage endpoint.** `StoredFile` exists; nothing writes to it.
- **`/api/ai` is still unauthenticated** and trusts client-supplied context.
- **No URL routing** — navigation remains client state, so records still cannot be linked to.
- **Notification and webhook queues have no dispatcher** — rows queue as PENDING
  and nothing claims otherwise.
- **No scheduled jobs** for SLA escalation, RFQ expiry, invoice overdue flagging or
  contract renewal alerts. The functions exist; nothing calls them on a timer.

---

# Phase 1 — database, data architecture and procurement business logic

**Date:** 2026-08-19
**Database:** Supabase PostgreSQL 17 (`aws-1-eu-west-1`, Supavisor pooler)
**Scope:** the foundation only. No UI redesign; UI changes limited to what the
data layer required.

## What was inspected first

The schema described in "Implementation status" above did exist and was better
than the audit's own headline suggested: 64 tables, a working tenancy guard, real
sessions, an approval engine and a budget ledger. The gaps were not in whether
tables existed but in whether the *business* was represented — and in three
structural weaknesses that would have been expensive to fix later.

## What changed, and why

### Structural

| Was | Now | Why it mattered |
|---|---|---|
| Money in `double precision` | `numeric(18,4)`, with a generated read-side extension keeping application types as `number` | Floating point cannot hold decimal money; a ledger of hundreds of entries drifts |
| Permissions as a hardcoded map plus a JSON override column | `Role` · `RolePermission` · `UserRoleAssignment`, 14 system roles installed as data | §5: an organization must be able to add a role and permission it without a deploy |
| Approvals only over purchase requests | `ApprovalInstance` over any entity, workflows versioned, stages targeting configured roles | §7: another organization must be able to configure a different process without code |
| Status as a free column | `src/server/state-machine.ts`, eight lifecycles, every transition asserted | §6, §11: no arbitrary status changes |
| Events emitted beside the transaction | `EventOutbox`, written inside it, drained after commit | §23: no notification for work that rolled back, and none lost after it commits |
| `db push` | Three checked-in migrations applied with `migrate deploy` | §24: a database that cannot be recreated from migrations is not reproducible |

### New to the model

Cost centres · department hierarchy · warehouses and per-warehouse stock balances
· procurement categories · vendor contacts, category qualifications, risk
assessments and performance snapshots · RFQ evaluation criteria, per-criterion
scores and award records · line-level invoice match exceptions · payment
allocations and payment transactions · standing approval delegations · polymorphic
document links · the transactional outbox.

Request lifecycle gained `IN_PROCUREMENT`, `ORDERED`, `PARTIALLY_FULFILLED`,
`FULFILLED`, `CLOSED` and `RETURNED`; purchase orders gained `APPROVED` and
`REJECTED` with a separation-of-duties gate; budgets gained the full
requested → reserved → committed → invoiced → paid chain.

### Integrity

202 foreign keys, every one indexed and every one with an explicit delete policy;
38 check constraints; 369 indexes. Row-level security enabled on all 84 tables so
the browser-side Supabase key cannot read the database through PostgREST —
confirmed by an actual request returning `permission denied`.

## Two things the tests found

1. **Prisma's 5-second interactive transaction budget is wrong for a pooled
   remote database.** Posting a receipt writes stock movements, balances and one
   asset row per unit, each paying a round trip; the budget ran out mid-transaction
   and the work rolled back as "Transaction not found". Raised to 30 seconds.
2. **A composite unique containing a nullable column is not a uniqueness
   guarantee.** Two NULLs never collide in Postgres, so an upsert keyed on
   `(userId, roleId, departmentId)` created a duplicate grant on every
   organization-wide role assignment. Replaced with an explicit find-then-write.
3. **The seed asserted budget figures with no ledger behind them.** Three of the
   four demo budgets showed six-figure spend against an empty `BudgetEntry`
   table — precisely the "asserted rather than reconstructable" state the ledger
   exists to prevent, sitting in the data the platform boots with. The seed now
   writes opening-balance entries and derives the rollups from them; all four
   budgets reconcile.
4. **`connection_limit=1` is a serverless setting, not a universal one.** Carried
   over from the Supabase docs, it serialised every request in a long-running
   server behind a single connection; responses took 10–20 seconds and the journey
   suite looked hung. Raised to 10 for the server case, with the serverless case
   documented next to it.

## Verification

| Suite | Checks | Result |
|---|---|---|
| `typecheck` | — | 0 errors |
| `verify:tenancy` | 8 | cross-tenant read, update and delete all blocked |
| `verify:scenarios` | 59 | the eight scenarios of §26, against Supabase |
| `verify:lifecycle` | 26 | transition tables and the revision path, over real HTTP |
| `verify:journeys` | 72 | full P2P lifecycle over real HTTP |

`verify:scenarios` and `verify:lifecycle` are new. The first runs the mandate's
eight scenarios in a throwaway tenant against the real database, asserts on what
was actually stored, and tears the tenant down. The second exercises the
transitions no other suite reaches — the revision path, and the moves that must be
refused — and it found two defects worth recording:

- **A returned request could not be resubmitted.** The state machine allowed
  `RETURNED → SUBMITTED`; the service still demanded `DRAFT`. Returning a request
  for revision was therefore a dead end, which defeats the point of having the
  state at all. The guard now asks the state machine instead of restating it.
- **A request already under approval could be re-submitted**, silently discarding
  decisions people had already made. `canTransition` treats a move to the status
  you are already in as legal; the guard now uses `nextStates`, which does not.

## Deliberately not done in this phase

- **The UI still reads `roleOverrides`.** The bootstrap payload now also sends the
  full `roles` array; the roles screen should be moved onto it in the UI phase.
- **No supplier-facing application.** Identity, sessions and isolation exist;
  suppliers still cannot log in and quote for themselves.
- **Vendor, contract, asset, inventory and document *writes*** still go through
  local state in the client. Their reads are real; their mutations are not yet
  server-backed.
- **No file storage endpoint.** `StoredFile` now records a provider, and Supabase
  Storage is the intended target for serverless deployments; nothing writes to it.
- **No scheduled jobs.** SLA escalation, RFQ expiry, overdue invoice flagging,
  contract renewal alerts and outbox retry all have functions and no timer.
- **`/api/ai` is still unauthenticated** and trusts client-supplied context.
