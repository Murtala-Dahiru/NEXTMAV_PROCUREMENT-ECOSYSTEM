# NextMav Procure — Vendor & Supplier Management

**Phase 3 · the supplier master, its lifecycle, compliance, risk and approval**

This document describes how a supplier relationship is modelled and governed. It
is the reference for anyone extending vendor behaviour; `prisma/schema.prisma`
and `src/server/services/vendor-service.ts` carry the same reasoning inline.

---

## 1. What changed, and why it mattered

Before this phase the vendor module was **read-real, write-fake**.
`bootstrap-service.ts` projected vendors out of Postgres, so the directory showed
genuine rows and looked finished. But every mutation the UI offered —
`createVendor`, `updateVendor`, `archiveVendor`, `blacklistVendor`,
`setPreferredVendor`, `addVendorDocument` — lived in `src/lib/store.ts` and only
called `set(...)` on a Zustand array. A supplier added through the interface
existed until the next page refresh and then did not.

There was no `vendor-service.ts`, no `/api/vendors` route, and therefore no
server-side authorization on any vendor action at all.

Everything below now runs on the server, through the same tenancy guard,
permission catalog, workflow engine, audit log and event outbox as purchase
requests.

---

## 2. One entity, not four

The platform buys from suppliers, contractors, service providers and consultants.
These are **not** separate models. They are one `Vendor` record with a
`vendorType` discriminator:

```
SUPPLIER · MANUFACTURER · DISTRIBUTOR · CONTRACTOR · SERVICE_PROVIDER · CONSULTANT · OTHER
```

Splitting them into separate tables would fragment the one thing that has to stay
whole — a company's spend, contracts, compliance and performance across every kind
of thing it sells you. The UI is free to use whatever terminology an organization
prefers; the record underneath stays single.

`SupplierUser` is deliberately **not** a `User`. A supplier login lives in its own
identity space with its own session table, so no internal query can resolve a
supplier into the employee identity space and no supplier session can ever carry
an internal role.

---

## 3. The lifecycle

```
PROSPECTIVE → INVITED → ONBOARDING → UNDER_REVIEW → PENDING_APPROVAL
            → APPROVED → ACTIVE ⇄ SUSPENDED → INACTIVE → ARCHIVED
                                  ↘ REJECTED        ↘ BLACKLISTED
```

Enforced by `VENDOR_TRANSITIONS` in `src/server/state-machine.ts`. No service
writes `status` directly; an illegal move is a 409 at the service boundary.

Three rules in that table are load-bearing:

**APPROVED does not equal ACTIVE.** Approval is the decision; activation is the
act of opening the supplier for business. Keeping them apart means a vendor
approved on Friday and activated on Monday has both facts on record, and it is
what stops an approval alone from making a supplier orderable.

**Lifting a blacklist lands in INACTIVE**, never straight in ACTIVE. Re-admitting
a barred supplier is a deliberate two-step act, so it cannot happen on one
mis-click.

**A rejected applicant may re-apply.** `REJECTED → ONBOARDING` is legal and the
rejection stays on the record; resubmission opens a *new* approval instance and
the rejected one survives beside it.

### Preferred is not a status

`PREFERRED` used to be a member of `VendorStatus`. It is now
`Vendor.isPreferred`, a boolean.

A preferred supplier is an active supplier the organization favours — a flag on a
trading relationship, not a stage of one. Modelling it as a status meant every
preferred vendor was invisible to a query for active vendors, which is a silent
and expensive kind of wrong. Migration `20260820020945_add_vendor_lifecycle_compliance`
carries the two existing flagged rows across explicitly rather than letting a
default lose the distinction; Postgres cannot drop an enum member in place, hence
the type swap in that file.

---

## 4. Compliance is evidence, not a checkbox

`vendor.complianceScore = 87` tells you nothing you can act on. Compliance is
expressed as individual obligations:

```
Vendor
├── VendorComplianceRequirement (TAX_CLEARANCE, mandatory, expires 2027-01-31)
│     └── VendorDocument "Tax Clearance 2026" (verified by Chidi, 2026-08-20)
├── VendorComplianceRequirement (BUSINESS_REGISTRATION, mandatory) → WAIVED
└── VendorComplianceRequirement (INSURANCE, optional) → PENDING_SUBMISSION
```

Each requirement carries its own status, evidence, expiry, reviewer and review
date. Different organizations require different things of their suppliers, which
a single boolean cannot express.

`Vendor.complianceState` is **derived** by `deriveComplianceState()` and written
only by `refreshCompliance()` after something changes the evidence. It is never a
field a user sets. The precedence is deliberate:

| Order | State | When |
|---|---|---|
| 1 | `EXPIRED` | any mandatory requirement has lapsed |
| 2 | `NON_COMPLIANT` | any mandatory requirement was rejected |
| 3 | `COMPLIANT` | every mandatory requirement is verified or waived |
| 4 | `UNDER_REVIEW` | evidence is in and awaiting a decision |
| 5 | `PARTIALLY_COMPLIANT` | some satisfied, some not |
| 6 | `IN_PROGRESS` / `NOT_STARTED` | nothing satisfied yet |

A lapsed mandatory certificate outranks a pile of verified ones, because the
question the state answers is "may we trade with them today", not "how much
paperwork have they sent us".

**Verification requires evidence.** A requirement with no document attached
cannot be marked `VERIFIED` — there is nothing to have looked at. The honest
route for an obligation satisfied outside the system is `WAIVED`, which records
who set it aside and why, and refuses a reason shorter than ten characters.

**A verified document is never deleted.** It is superseded by a replacement, and
the original stays with its `version` and its verifier, because an approval made
while a certificate was current has to remain explicable after it lapses.

### Expiry

Document status carries two different facts — has someone checked it, and is it
still in date. `documentStatus()` resolves them in that order: an unverified
document is `PENDING_REVIEW` whatever its dates say; once verified it becomes
`VALID`, `EXPIRING` (within 30 days) or `EXPIRED`, computed at read time rather
than stored, because a stored expiry status is wrong the day after it is written.

Dashboard and report queries filter on `expiresAt` directly for the same reason.

---

## 5. Approval runs on the existing engine

`ApprovalEntityType.VENDOR` already existed in the schema and was inert. It is now
live: `submitForReview()` calls the same `selectWorkflow` / `buildChain` in
`src/server/engines/workflow.ts` that purchase requests use, passing
`entityType: "VENDOR"`.

There is no second, hardcoded vendor approval engine. The default workflow is
installed as ordinary rows by `npm run db:vendor-workflow`:

| Sequence | Stage | Routed to | SLA |
|---|---|---|---|
| 1 | Compliance Review | `VENDOR_MANAGER` role → `PROCUREMENT_MANAGER` | 48h |
| 2 | Procurement Review | `PROCUREMENT_MANAGER` role → enum | 48h |
| 3 | Finance Review | `FINANCE_MANAGER` role → `FINANCE_OFFICER` | 72h |

Each stage prefers a configured `Role` and falls back to the legacy enum role, so
the chain still builds in an organization that has not assigned its roles. An
administrator can re-stage, re-target or deactivate the whole thing without a
deploy.

Vendor approval is **not routed on value** — a supplier has no amount at the point
it is approved — so the workflow's threshold columns are left unset, which is what
makes it match every vendor rather than a spend band.

### The submission gate

A vendor does not enter an approval queue until there is something to review.
`submitForReview()` refuses, with the specific list of what is missing, unless:

- at least one active contact exists;
- at least one supply category is recorded;
- a tax identification or company registration number is present;
- every **mandatory** compliance requirement has evidence against it.

What is checked is deliberately what a reviewer cannot supply themselves.

### Who may decide

The same three conditions as a purchase request, enforced by
`workflow.assertCanDecide`: the step is the currently active one, it is still
pending, and the caller is its assigned approver or delegate. The person who put
the supplier forward is excluded from approving it — `buildChain` receives
`vendor.createdById` as the excluded user.

A rejection ends the chain rather than leaving later stages owed a decision, and
requires a reason.

---

## 6. Duplicate control

Two vendor records for one company splits that supplier's spend, contracts and
compliance across two rows — a data problem no later screen can repair.

`findDuplicates()` separates decisive from suggestive:

- **HIGH** — same tax number, same registration number, or same contact email.
  These are the same legal entity.
- **MEDIUM** — a similar company name after normalising case, punctuation and
  suffixes (`Ltd`, `PLC`, `Nigeria`, …).

A high-confidence match **blocks** creation with a 409 that names what it matched,
so the user can look. An authorised user who has reviewed them and decided these
really are two different companies passes `acknowledgeDuplicates: true`, and that
acknowledgement is recorded in the audit entry.

Names alone never block. "Adeola Engineering Ltd" and "Adeola Engineering
Services Ltd" are frequently two real, distinct businesses.

Nothing merges automatically. A dedicated merge tool is a later phase.

---

## 7. Permissions

| Permission | Grants |
|---|---|
| `vendors.view` | read the directory and profiles |
| `vendors.create` | add a vendor |
| `vendors.edit` | change vendor details, contacts, categories |
| `vendors.approve` | decide onboarding stages, activate an approved vendor |
| `vendors.suspend` | suspend, reactivate, deactivate |
| `vendors.archive` | archive, restore, blacklist, lift a blacklist |
| `vendors.compliance` | set requirements, verify or reject documents |
| `vendors.risk` | record risk assessments |
| `vendors.notes` | read and write internal notes |
| `vendors.portal` | manage supplier portal logins |

Every one is checked server-side in `vendor-service.ts` before the work happens.
The profile page renders its action bar from `availableActions`, which the server
computes from the caller's permissions **and** the vendor's current state — so a
button never appears for something the service would refuse. That is a courtesy,
not the control.

Two projections are permission-dependent: bank details require `vendors.edit`,
and `RESTRICTED` internal notes are only returned to callers holding
`vendors.approve`. A user who cannot read a restricted note cannot write one
either.

> **Deploying a new permission.** `ensureSystemRoles` never rewrites an existing
> role's grants, so a permission added to the catalog in code reaches nobody until
> `npm run db:sync-roles` is run. It adds only what the catalog specifies and never
> removes.

---

## 8. Multi-tenancy

`Vendor`, `VendorCategoryLink`, `VendorComplianceRequirement` and `VendorNote` are
all in `TENANT_MODELS`, so `tenantDb()` injects the organization filter into every
operation including `findUnique`, `update` and `delete`. A cross-tenant id
resolves to null, and the service returns **404, never 403** — telling a caller
"this exists but is not yours" is itself a cross-tenant leak.

Child tables reached only through a scoped parent (`VendorContact`,
`VendorDocument`, `VendorRiskAssessment`) are covered by the parent query and are
checked explicitly against `vendorId` in every handler that takes a child id.

---

## 9. Risk and performance are recorded, not invented

`VendorRiskAssessment` rows are dated, attributed judgements kept as history. The
vendor's current level is the latest assessment's; earlier ones stay, so an award
made under an old rating remains explicable. Nothing in this platform generates a
risk score on its own.

`VendorPerformanceSnapshot` has a table and a UI and, for most organizations, no
rows. On-time delivery and quality come from goods receipts, invoices and
payments — real procurement transactions — and are computed by the scorecard path
in a later phase. Until then the Performance tab says so rather than showing a
figure nobody earned.

---

## 10. Audit, activity and notifications

Every vendor mutation writes to both logs through `recordEventPair`:

- `AuditLogEntry` — the compliance record: action, before/after state, changed
  fields, server-captured IP and user agent.
- `ActivityLog` — the human-readable timeline the profile page shows.

Recorded actions include `vendor.created`, `vendor.updated`,
`vendor.submitted_for_review`, `vendor.approved`, `vendor.rejected`,
`vendor.activate`, `vendor.suspend`, `vendor.reactivate`, `vendor.archive`,
`vendor.blacklist`, `vendor.document_uploaded`, `vendor.document_verified`,
`vendor.compliance_verified`, `vendor.compliance_waived`, `vendor.risk_assessed`,
`vendor.note_added`.

Notifications come from real events. `submitForReview` enqueues
`vendor.approval_required` to the **transactional outbox** inside the same
transaction as the status change, so the notification commits with the business
change or not at all. `decide` emits `vendor.approved` / `vendor.rejected` /
`vendor.approval_required` for the next stage. No row is written to make a screen
look populated.

---

## 11. Scale

The directory pages, filters, sorts and searches **in the database**. The previous
implementation loaded the whole supplier master into the browser and filtered it
with `array.filter`, which is fine for twelve vendors and unusable at the scale
this platform is for.

Search covers company name, legal name, trading name, vendor code, email, tax
number, registration number, category, contact name and contact email — combined
with `AND` against active filters so a search never widens one.

The dashboard's figures are `count()` queries against the tenant, not sums over a
payload the client happens to be holding.

---

## 12. Verification

`npm run verify:vendors` drives the whole lifecycle over HTTP against a running
server: create, duplicate detection, contacts, categories, compliance
requirements, documents and expiry derivation, the submission gate, the
three-stage approval walked as each assigned approver in turn, the rejection and
resubmission path, risk, notes, suspension, reactivation, blacklist, and
organization isolation.

It asserts the refusals as carefully as the successes — an employee creating a
vendor, an approver deciding someone else's step, a later stage decided before an
earlier one, a verified document deleted, a waiver without a reason, a blacklisted
vendor edited, a cross-tenant read. A control nobody has tried to break is not a
control.
