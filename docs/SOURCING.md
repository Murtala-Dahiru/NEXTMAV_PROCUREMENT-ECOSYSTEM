# Strategic Sourcing — RFQ, Quotation, Evaluation, Award

Phase 4 + 5. What an organization can now do, how it is enforced, and where the
decisions live.

---

## The chain

```
PurchaseRequest (APPROVED)
      ↓
SourcingEvent            SE-2026-0001
      ↓
RFQ                      RFQ-2026-0001
      ↓
RFQVendor                one row per invited supplier
      ↓
Quotation                QUO-2026-0001, revisioned
      ↓
QuotationScore           one row per (bid, criterion, evaluator)
      ↓
AwardRecommendation      the proposal, with a frozen evaluation snapshot
      ↓
RFQAward                 the decision
      ↓
PurchaseOrder            next phase — the award is shaped to be consumed
```

Every link is a foreign key. "Why was this supplier selected?" is a join, not an
archaeology exercise.

---

## What changed from Phase 3

The RFQ existed before this phase but came into the world already issued: it was
created with status `WAITING` and its supplier invitations in the same statement.
That left nowhere to put approval, no way to build a specification over more than
one sitting, and no chance to correct a mistake before the market saw it.

Three defects were also found and fixed:

| Defect | Effect | Fix |
| --- | --- | --- |
| `createRfqSchema` accepted `criteria`; the service dropped them | Evaluation criteria could never be created | Criteria are created, validated, and frozen once scoring starts |
| `QuotationScore` was unique on `(quotation, criterion)` | A second evaluator silently overwrote the first | Unique on `(quotation, criterion, evaluator)`, with a partial index closing the NULL gap |
| `DomainEvent.vendorId` was documented but never read | Every supplier-facing notification went nowhere | `fanoutToSupplier` writes the supplier's activity row and queues delivery |

---

## RFQ lifecycle

```
DRAFT → UNDER_REVIEW → APPROVED → READY_TO_PUBLISH → PUBLISHED
      → RESPONSE_PERIOD → CLOSED → UNDER_EVALUATION → AWARDED | NO_AWARD
```

Enforced by `RFQ_TRANSITIONS` in `src/server/state-machine.ts`. Three distinctions
in that chain are load-bearing:

**`APPROVED` vs `READY_TO_PUBLISH`** — approval is a decision by a person;
readiness is a fact about the document. An RFQ can be approved and still be
missing a line item or an eligible supplier. Readiness is asserted by
`publishReadiness()`, never typed in.

**`PUBLISHED` vs `RESPONSE_PERIOD`** — published means the invitations went out;
response period means at least one supplier has engaged. Collapsing them hides a
round where nobody answered.

**`CLOSED` vs `AWARDED`** — closed means the door shut on new quotations. Awarding
is a later, separate act that may not happen. `NO_AWARD` is a real outcome and is
not recorded as a cancellation.

`PUBLISHED → DRAFT` does not exist. Once suppliers hold an invitation the only ways
out are forward or `CANCELLED` — withdrawing a live tender quietly and re-issuing
it is exactly the manipulation an audit trail exists to stop.

---

## Approval

Publication and award both run on the existing `ApprovalInstance` engine, the same
one that governs purchase requests and vendor onboarding. Two workflows are
installed for a new organization by `src/server/sourcing-workflow.ts`:

- **RFQ Publication Approval** — one stage, procurement. The check is on the
  document; holding a tender through three desks before it is even published is
  how sourcing cycles stretch to months.
- **Award Approval** — value-banded stages. Procurement always; finance above
  25,000; an executive above 250,000. This is where money is committed, so this is
  where the scrutiny belongs.

Where an organization has configured no workflow, the RFQ approves itself and the
audit row says so — `{"workflow": null, "note": "No RFQ approval workflow is
configured"}`. An unconfigured control is recorded as absent, never silently
invented.

Install into an existing tenant:

```bash
npm run db:sourcing-workflows
```

---

## Confidentiality

`src/server/services/supplier-service.ts` is the only path a supplier can reach.
Two structural decisions carry §42 rather than leaving it to care:

**Every read starts from the invitation, not from the RFQ.** The supplier's own
`RFQVendor` row is the only doorway into a tender. There is no code path that loads
an RFQ by id and then checks whether the caller should have it. An id belonging to
another tender — or another tenant — returns 404, not 403: confirming that a tender
exists is itself information.

**Nothing returns a Prisma record straight out.** Every response is assembled by
`forSupplier()`. A field added to the RFQ model next year does not silently start
appearing in the supplier's payload.

A supplier never receives: another bidder's identity or price, the buyer's
estimated value, evaluation criteria, scores, ranks, weighted totals, internal
notes, approval state, or the award justification. Per-line target prices appear
only when the RFQ sets `showTargetPrice`.

The supplier principal itself carries no `role`, no `userId` and no `departmentId`,
so a supplier token is structurally incapable of satisfying an internal permission
check.

---

## Evaluation

Criteria are fixed **before** bids arrive and cannot be changed once any bid has
been scored against them (§27). Weights are percentages and must total 100 before
the RFQ can be published.

Criteria marked `isAutomatic` — price and delivery — are scored by the system from
the bid itself through linear normalisation across the field. The panel is only
asked for judgements a person has to make, and hand-scoring an automatic criterion
is refused.

The weighted total is derived, not stored by a caller:

1. Each criterion produces a raw score. Human criteria take the mean of the panel's
   marks; automatic ones are computed from the bid.
2. The raw score is divided by the criterion's maximum, giving 0–1, and inverted
   where lower is better.
3. Each is multiplied by its weight and summed.

Weights are re-normalised over the criteria actually scored so far, so a
part-finished evaluation still compares like with like.

**Visibility.** A panel member sees the aggregate and their own marks. Only the
chair, or a holder of `rfqs.manageEvaluation`, sees who scored what — knowing that
a colleague marked a supplier down turns a panel into a negotiation.

**History.** Re-scoring copies the superseded value into `QuotationScoreHistory`
before overwriting. Nothing is lost.

---

## Arithmetic

No total that the system can compute is accepted from a caller. A supplier sends
quantities, unit prices, discounts, tax rates and carriage;
`src/server/quotation-math.ts` derives line totals, tax, the quotation total, and
the normalised per-unit rates used in the comparison.

The header discount is applied after the lines, on the net subtotal, and is **not**
re-taxed — it is a concession on the computed price, not a change to each line's
taxable base. Doing it the other way would mean a buyer negotiating a settlement
discount silently reduced the tax the supplier declared, which is not the buyer's
to reduce.

The supplier portal mirrors the same arithmetic client-side for live feedback while
typing, then discards it. What is stored is what the server recomputes.

---

## Comparison

`GET /api/rfqs/:id/comparison` returns three things a naive comparison omits:

- **Coverage** — the proportion of the RFQ each bid actually priced. A cheap bid at
  60% coverage is not cheap, and the table says so before the reader reaches the
  number.
- **A per-line matrix** — the RFQ line is the spine; a supplier who did not price a
  line shows as a gap, never as zero. Scoring a missing line as free is how an
  automated comparison hands the award to the least responsive bidder.
- **The split-award total** — what the same basket costs taking every line from
  whoever is cheapest on it. It often beats the best single bid, and a buyer cannot
  see that from totals alone.

Quantity mismatches are flagged, not corrected: a supplier quoting 1,000 against a
request for 800 may be offering a pack size, and the buyer decides what that means.

---

## Business rules, and where each is enforced

| Rule | Enforced in |
| --- | --- |
| 1. A supplier cannot respond to an RFQ they were not invited to | `captureQuotation` (invitation lookup) + `invitationFor` |
| 2. No submission after the deadline | `captureQuotation`, against the server clock |
| 3. A supplier cannot see another's quotation | `supplier-service` — competitor data is never queried |
| 4. No modification of a submitted quotation without authorisation | `captureQuotation` + `RFQVendor.revisionAllowedAt` |
| 5. An inactive or suspended vendor cannot be invited | `INVITABLE_VENDOR_STATUSES`, re-checked at publish |
| 6. An RFQ cannot be published without required information | `publishReadiness`, re-run inside `publish` |
| 7. No award without a valid evaluation where required | `assertEvaluated` |
| 8. An award must reference a valid quotation | `assertAwardable` |
| 9. An evaluator cannot modify another's score | `QuotationScore` uniqueness includes the evaluator seat |
| 10. A supplier cannot access internal evaluation information | `myQuotationFor` omits every assessment field |

---

## Permissions

| Permission | Grants |
| --- | --- |
| `rfqs.view` | Read RFQs, the dashboard, the comparison |
| `rfqs.create` | Draft RFQs, set line items, invite suppliers |
| `rfqs.approve` | Decide the approval that gates publication |
| `rfqs.issue` | Publish, remind, close, invite a revision |
| `rfqs.manageEvaluation` | Define criteria, appoint the panel, see everyone's scores |
| `rfqs.evaluate` | Score bids on a panel seat |
| `rfqs.clarify` | Answer questions, issue notices |
| `rfqs.recommendAward` | Put a supplier forward |
| `rfqs.approveAward` | Decide an award approval |
| `rfqs.selectQuotation` | Record the award; close with no award |
| `rfqs.cancel` | Cancel an RFQ |

A new **Evaluator** role holds `rfqs.view` + `rfqs.evaluate` and nothing else — the
permission opens the module, the panel seat opens the document.

After a release that adds permissions:

```bash
npm run db:sync-roles
```

---

## Verification

```bash
npm run verify:sourcing
```

Drives the whole chain over HTTP as two different browsers — a buyer's and a
supplier's — and checks what is supposed to be **refused** as well as what is meant
to work: publication before approval, invitation of a suspended supplier, a
submission after the deadline, a second evaluator overwriting the first, one
supplier reading another's bid, a supplier session reaching a buyer endpoint, and a
supplier in another tenant reading this one's RFQ.

The suite creates its own suppliers, portal accounts and isolation organization,
and removes them afterwards.

---

## What was deliberately not built

The Purchase Order phase. §51 draws the line, and `RFQAward` +
`AwardRecommendationItem` carry the awarded lines, quantities and unit prices so the
next phase has an explicit list to consume rather than one it has to re-derive.
