// NextMav Procure — strategic sourcing verification (Phase 4 + 5).
//
// Drives the whole sourcing chain over HTTP, as two different kinds of browser
// would: a buyer's, and a supplier's.
//
//   Approved request → sourcing event → RFQ → criteria → panel → suppliers
//     → approval → publish → supplier responds → close → compare → score
//     → recommend → approve → award
//
// Two things this suite does that a happy-path script would not, and they are the
// reason it exists:
//
//   It checks what is supposed to be *refused*. A deadline that is only a disabled
//   button, a supplier who can read a competitor's price, a score one evaluator can
//   overwrite — none of those show up in a test that only does the right thing.
//
//   It signs in as a real supplier, over the supplier realm's own cookie, and
//   tries to reach buyer endpoints and other tenants' documents. §42 and §49 are
//   claims about what happens when someone actually tries.
//
// Run:  npm run verify:sourcing          (dev server must be running)
//       BASE_URL=https://… npm run verify:sourcing

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/server/password.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "NextMav#2026";
const SUPPLIER_PASSWORD = "SupplierVerify#2026";

const db = new PrismaClient();

let pass = 0;
let fail = 0;
const failures = [];

const ok = (n, d = "") => {
  pass++;
  console.log(`  \x1b[32mPASS\x1b[0m  ${n}${d ? `  \x1b[90m${d}\x1b[0m` : ""}`);
};
const bad = (n, d = "") => {
  fail++;
  failures.push(`${n}${d ? ` — ${d}` : ""}`);
  console.log(`  \x1b[31mFAIL\x1b[0m  ${n}${d ? `  \x1b[90m${d}\x1b[0m` : ""}`);
};
const check = (cond, n, d = "") => (cond ? ok(n, d) : bad(n, d));
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** An HTTP client with its own cookie jar. Used for both realms. */
function makeClient() {
  const jar = new Map();
  let cookie = "";

  const req = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Supabase chunks its auth cookie when the JWT exceeds 4KB, so every cookie is
    // kept rather than one fixed name.
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [p] = c.split(";");
      const eq = p.indexOf("=");
      if (eq < 1) continue;
      const name = p.slice(0, eq);
      const value = p.slice(eq + 1);
      if (value === "" || value === "deleted") jar.delete(name);
      else jar.set(name, value);
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const t = await res.text();
    let b = null;
    if (t) {
      try {
        b = JSON.parse(t);
      } catch {
        b = t;
      }
    }
    return { status: res.status, body: b };
  };

  return {
    raw: req,
    get: (p, q) => req("GET", q ? `${p}?${new URLSearchParams(q)}` : p),
    post: (p, b) => req("POST", p, b),
    patch: (p, b) => req("PATCH", p, b),
    put: (p, b) => req("PUT", p, b),
    del: (p) => req("DELETE", p),
  };
}

async function employee(email) {
  const c = makeClient();
  const r = await c.post("/api/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { ...c, email };
}

async function supplier(email, password = SUPPLIER_PASSWORD) {
  const c = makeClient();
  const r = await c.post("/api/supplier/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`supplier login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { ...c, email };
}

const iso = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString();
const stamp = Date.now();
const money = (n) => Math.round(n * 100) / 100;

/** Signs in as whoever owns the currently-active approval step and decides it. */
async function decideAs(entityType, entityId, decision, comment, endpoint) {
  const instance = await db.approvalInstance.findFirst({
    where: { entityType, entityId, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  if (!instance) return { status: 0, body: null, approver: null };

  const step = instance.steps
    .filter((s) => s.decision === "PENDING")
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!step) return { status: 0, body: null, approver: null };

  const user = await db.user.findUnique({
    where: { id: step.delegatedToId ?? step.approverId },
    select: { email: true, name: true },
  });
  const who = await employee(user.email);
  const res = await who.post(endpoint, { stepId: step.id, decision, comment });
  return { ...res, approver: user };
}

async function main() {
  console.log(`\x1b[1mStrategic sourcing — ${BASE}\x1b[0m`);

  const cleanup = { rfqIds: [], eventIds: [], vendorIds: [], requestIds: [], orgIds: [] };

  // =========================================================================
  section("Setup");
  // =========================================================================
  const org = await db.organization.findFirst({
    where: { name: { not: { startsWith: "Isolation Org" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!org) throw new Error("no organization in the database");

  const rfqWorkflow = await db.approvalWorkflow.findFirst({
    where: { organizationId: org.id, entityType: "RFQ", isActive: true },
    include: { stages: true },
  });
  const awardWorkflow = await db.approvalWorkflow.findFirst({
    where: { organizationId: org.id, entityType: "AWARD", isActive: true },
    include: { stages: true },
  });
  check(
    Boolean(rfqWorkflow?.stages.length) && Boolean(awardWorkflow?.stages.length),
    "RFQ publication and award approval workflows are configured",
    `${rfqWorkflow?.stages.length ?? 0} + ${awardWorkflow?.stages.length ?? 0} stages`
  );

  const admin = await employee("amina.okafor@apex.com");
  const buyer = await employee("tunde.bello@apex.com");
  const clerk = await employee("emeka.eze@apex.com");
  ok("signed in as an administrator, a procurement manager and an ordinary employee");

  // Three suppliers: two that will bid, one suspended to prove Rule 5.
  const makeVendor = async (name, status, orgId = org.id) => {
    const v = await db.vendor.create({
      data: {
        organizationId: orgId,
        code: `VS-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
        companyName: name,
        email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@verify.test`,
        status,
        complianceState: "COMPLIANT",
        preferredCurrency: "USD",
      },
    });
    cleanup.vendorIds.push(v.id);
    return v;
  };

  const alpha = await makeVendor(`Alpha Sourcing ${stamp}`, "ACTIVE");
  const beta = await makeVendor(`Beta Supplies ${stamp}`, "ACTIVE");
  const gamma = await makeVendor(`Gamma Trading ${stamp}`, "ACTIVE");
  const suspended = await makeVendor(`Suspended Co ${stamp}`, "SUSPENDED");

  const hash = await hashPassword(SUPPLIER_PASSWORD);
  const makeContact = async (vendor, orgId = org.id) =>
    db.supplierUser.create({
      data: {
        organizationId: orgId,
        vendorId: vendor.id,
        email: `portal.${vendor.id.slice(-8)}@verify.test`,
        contactName: `${vendor.companyName} Contact`,
        passwordHash: hash,
        accessStatus: "ACTIVE",
      },
    });

  const alphaUser = await makeContact(alpha);
  const betaUser = await makeContact(beta);
  await makeContact(gamma);
  ok("three supplier portal accounts created, plus one suspended vendor");

  // =========================================================================
  section("1. An approved purchase request becomes a sourcing event");
  // =========================================================================
  const dept = await db.department.findFirst({ where: { organizationId: org.id }, select: { id: true } });

  const prCreated = await clerk.post("/api/requests", {
    departmentId: dept.id,
    title: `Sourcing verification requirement ${stamp}`,
    priority: "MEDIUM",
    businessJustification:
      "Raised by the sourcing verification suite to prove the request-to-award chain end to end.",
    neededByDate: iso(45),
    lineItems: [
      { itemName: "Industrial Laptop", description: "Rugged field unit", quantity: 10, unit: "unit", estimatedCost: 1800 },
      { itemName: "Docking Station", description: "USB-C, dual display", quantity: 10, unit: "unit", estimatedCost: 220 },
    ],
    submit: true,
  });
  check(prCreated.status === 200, "an employee can raise a purchase request", `HTTP ${prCreated.status}`);
  const requestId = prCreated.body?.id;
  if (!requestId) throw new Error(`request not created: ${JSON.stringify(prCreated.body)}`);
  cleanup.requestIds.push(requestId);

  // Walk the request's own approval chain to APPROVED.
  for (let i = 0; i < 6; i++) {
    const steps = await db.approvalStep.findMany({
      where: { requestId, decision: "PENDING" },
      orderBy: { sequence: "asc" },
    });
    if (steps.length === 0) break;
    const approver = await db.user.findUnique({
      where: { id: steps[0].delegatedToId ?? steps[0].approverId },
      select: { email: true },
    });
    const who = await employee(approver.email);
    await who.post(`/api/requests/${requestId}/decide`, {
      stepId: steps[0].id,
      decision: "APPROVED",
      comment: "Approved by the verification suite",
    });
  }
  const approvedRequest = await db.purchaseRequest.findUnique({ where: { id: requestId } });
  check(
    approvedRequest.status === "APPROVED",
    "the request reaches APPROVED through the real approval chain",
    approvedRequest.status
  );

  const eventRes = await admin.post("/api/sourcing-events", {
    title: `Field hardware refresh ${stamp}`,
    description: "Competitive sourcing for the approved laptop and docking requirement.",
    requestId,
    currency: "USD",
  });
  check(eventRes.status === 200, "an approved request can open a sourcing event", `HTTP ${eventRes.status}`);
  const eventId = eventRes.body?.id;
  if (eventId) cleanup.eventIds.push(eventId);
  check(
    eventRes.body?.requestId === requestId && Boolean(eventRes.body?.eventNumber),
    "the event is numbered and traceable back to the request",
    eventRes.body?.eventNumber
  );

  const draftRequest = await db.purchaseRequest.findFirst({
    where: { organizationId: org.id, status: "DRAFT" },
    select: { id: true, requestNumber: true },
  });
  if (draftRequest) {
    const fromDraft = await admin.post("/api/sourcing-events", {
      title: `Should not open ${stamp}`,
      requestId: draftRequest.id,
    });
    check(
      fromDraft.status === 409,
      "sourcing cannot start from a request that has not been approved",
      `HTTP ${fromDraft.status}`
    );
  }

  // =========================================================================
  section("2. RFQ drafting");
  // =========================================================================
  const rfqRes = await admin.post("/api/rfqs", {
    sourcingEventId: eventId,
    requestId,
    title: `Field hardware RFQ ${stamp}`,
    description: "Supply and delivery of rugged laptops and docking stations.",
    deadline: iso(14),
    questionDeadline: iso(7),
    requiredDeliveryDate: iso(60),
    deliveryTerms: "DDP, buyer's Lagos warehouse",
    termsAndConditions: "Standard NextMav purchasing terms apply.",
    currency: "USD",
    estimatedValue: 20200,
    evaluationMethod: "WEIGHTED_SCORE",
    invitedVendorIds: [alpha.id, beta.id],
  });
  check(rfqRes.status === 200, "a buyer can draft an RFQ", `HTTP ${rfqRes.status}`);
  const rfqId = rfqRes.body?.id;
  if (!rfqId) throw new Error(`RFQ not created: ${JSON.stringify(rfqRes.body)}`);
  cleanup.rfqIds.push(rfqId);
  if (rfqRes.body?.sourcingEventId) cleanup.eventIds.push(rfqRes.body.sourcingEventId);

  check(rfqRes.body.status === "DRAFT", "a new RFQ starts as a draft, not issued", rfqRes.body.status);
  check(
    rfqRes.body.lineItems?.length === 2 &&
      rfqRes.body.lineItems.every((l) => Boolean(l.requestLineItemId)),
    "line items are inherited from the request and keep a pointer back to it",
    `${rfqRes.body.lineItems?.length} lines`
  );

  const barred = await admin.post("/api/rfqs", {
    title: `Should not exist ${stamp}`,
    deadline: iso(10),
    invitedVendorIds: [suspended.id],
    lineItems: [{ itemName: "Anything", quantity: 1, unit: "unit" }],
  });
  check(
    barred.status === 422,
    "Rule 5 — a suspended supplier cannot be invited to a new RFQ",
    `HTTP ${barred.status}`
  );

  const eligible = await admin.get("/api/rfqs/eligible-suppliers", { search: `Suspended Co ${stamp}` });
  check(
    Array.isArray(eligible.body) && eligible.body.length === 0,
    "the eligible-supplier search does not return a suspended supplier at all"
  );

  // =========================================================================
  section("3. Evaluation criteria and panel");
  // =========================================================================
  const badWeights = await admin.put(`/api/rfqs/${rfqId}/criteria`, {
    criteria: [
      { name: "Price", type: "PRICE", weight: 40, maxScore: 10, isAutomatic: true },
      { name: "Technical", type: "TECHNICAL", weight: 30, maxScore: 10 },
    ],
  });
  check(badWeights.status === 200, "criteria can be defined on a draft RFQ", `HTTP ${badWeights.status}`);

  const notReady = await admin.post(`/api/rfqs/${rfqId}/submit`, {});
  check(
    notReady.status === 422 &&
      JSON.stringify(notReady.body).includes("100%"),
    "§27 — an RFQ whose evaluation weights do not total 100% cannot go for review",
    `HTTP ${notReady.status}`
  );

  const criteria = await admin.put(`/api/rfqs/${rfqId}/criteria`, {
    criteria: [
      { name: "Price", type: "PRICE", weight: 40, maxScore: 10, isAutomatic: true },
      { name: "Delivery", type: "DELIVERY", weight: 15, maxScore: 10, isAutomatic: true },
      { name: "Technical Compliance", type: "TECHNICAL", weight: 25, maxScore: 10 },
      { name: "Warranty", type: "WARRANTY", weight: 10, maxScore: 10 },
      { name: "Experience", type: "EXPERIENCE", weight: 10, maxScore: 10 },
    ],
  });
  check(criteria.status === 200, "weights totalling 100% are accepted", `HTTP ${criteria.status}`);

  const financeUser = await db.user.findFirst({
    where: { organizationId: org.id, role: "FINANCE_OFFICER", status: "ACTIVE" },
    select: { id: true, email: true },
  });
  const deptUser = await db.user.findFirst({
    where: { organizationId: org.id, role: "DEPARTMENT_MANAGER", status: "ACTIVE" },
    select: { id: true, email: true },
  });
  const buyerUser = await db.user.findFirst({
    where: { organizationId: org.id, email: "tunde.bello@apex.com" },
    select: { id: true },
  });

  const panel = await admin.put(`/api/rfqs/${rfqId}/evaluators`, {
    evaluators: [
      { userId: buyerUser.id, role: "PROCUREMENT", isChair: true },
      { userId: financeUser.id, role: "FINANCE" },
      { userId: deptUser.id, role: "DEPARTMENT" },
    ],
  });
  check(panel.status === 200, "§29 — an evaluation panel of three can be appointed", `HTTP ${panel.status}`);

  // =========================================================================
  section("4. Approval and publication");
  // =========================================================================
  const early = await admin.post(`/api/rfqs/${rfqId}/publish`, {});
  check(
    early.status === 409,
    "§7 — an unapproved RFQ cannot be published",
    `HTTP ${early.status}`
  );

  const submitted = await admin.post(`/api/rfqs/${rfqId}/submit`, {});
  check(
    submitted.status === 200 && submitted.body?.status === "UNDER_REVIEW",
    "a complete RFQ goes to the approval engine",
    submitted.body?.status
  );
  check(
    Boolean(submitted.body?.approval?.workflow?.name),
    "the approval runs on the configured workflow, not a private one",
    submitted.body?.approval?.workflow?.name
  );

  const wrongApprover = await clerk.post(`/api/rfqs/${rfqId}/decide`, {
    stepId: submitted.body.approval.steps[0].id,
    decision: "APPROVED",
  });
  check(
    wrongApprover.status === 403,
    "an employee without rfqs.approve cannot approve an RFQ",
    `HTTP ${wrongApprover.status}`
  );

  const approved = await decideAs("RFQ", rfqId, "APPROVED", "Specification and supplier list are sound", `/api/rfqs/${rfqId}/decide`);
  check(
    approved.status === 200 && approved.body?.status === "READY_TO_PUBLISH",
    "approval by the assigned approver leaves a complete RFQ ready to publish",
    `${approved.approver?.name} → ${approved.body?.status}`
  );

  const beforePublish = await db.rFQVendor.count({ where: { rfqId } });
  const published = await admin.post(`/api/rfqs/${rfqId}/publish`, {});
  check(
    published.status === 200 && published.body?.status === "PUBLISHED",
    "§10 — an approved RFQ publishes",
    published.body?.status
  );
  check(
    published.body?.publishedAt && published.body?.publishedBy?.id,
    "publication records who published it and when"
  );

  const invitations = await db.rFQVendor.findMany({ where: { rfqId } });
  check(
    invitations.length === 2 && beforePublish === 2,
    "§9 — the invitation records exist, one per supplier",
    `${invitations.length} invitations`
  );

  const supplierActivity = await db.supplierActivity.count({
    where: { vendorId: { in: [alpha.id, beta.id] }, type: "RFQ_RECEIVED", referenceId: rfqId },
  });
  check(supplierActivity === 2, "§38 — each invited supplier is notified", `${supplierActivity} notifications`);

  const eventAfterPublish = await db.sourcingEvent.findUnique({
    where: { id: rfqRes.body.sourcingEventId },
    select: { status: true, publishedAt: true },
  });
  check(
    eventAfterPublish?.status === "ACTIVE" && Boolean(eventAfterPublish.publishedAt),
    "the sourcing event follows its RFQ into the market",
    eventAfterPublish?.status
  );

  // =========================================================================
  section("5. Supplier portal — Alpha");
  // =========================================================================
  const alphaPortal = await supplier(alphaUser.email);
  ok("a supplier can sign in to the portal");

  const alphaList = await alphaPortal.get("/api/supplier/rfqs");
  check(
    alphaList.status === 200 && alphaList.body?.items?.some((r) => r.rfqId === rfqId),
    "§48 — the supplier sees the RFQ they were invited to",
    `${alphaList.body?.items?.length ?? 0} invitations`
  );

  const alphaView = await alphaPortal.get(`/api/supplier/rfqs/${rfqId}`);
  check(alphaView.status === 200, "the supplier can open the RFQ", `HTTP ${alphaView.status}`);
  check(
    alphaView.body?.lineItems?.length === 2 && alphaView.body?.lineItems.every((l) => l.targetPrice === null),
    "§11 — internal target pricing is withheld from the supplier",
  );
  const leaked = JSON.stringify(alphaView.body);
  check(
    !leaked.includes(beta.companyName) &&
      !leaked.includes("estimatedValue") &&
      !leaked.includes("weightedScore") &&
      !leaked.includes("criteria\":[{"),
    "§11/§42 — the payload carries no competitor, no budget and no evaluation data"
  );

  const viewed = await db.rFQVendor.findFirst({ where: { rfqId, vendorId: alpha.id } });
  check(
    viewed.status === "VIEWED" && Boolean(viewed.viewedAt),
    "§23 — opening the RFQ is what makes the buyer's 'viewed' counter true",
    viewed.status
  );

  const question = await alphaPortal.post(`/api/supplier/rfqs/${rfqId}/clarifications`, {
    question: "Are the docking stations required to support 100W power delivery?",
  });
  check(question.status === 200, "§19 — a supplier can ask a clarification question", `HTTP ${question.status}`);

  const accepted = await alphaPortal.post(`/api/supplier/rfqs/${rfqId}/accept`, {});
  check(accepted.status === 200 && accepted.body?.myInvitation?.status === "ACCEPTED", "the supplier can accept the invitation");

  const rfqLines = alphaView.body.lineItems;
  const alphaDraft = await alphaPortal.put(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 21,
    warranty: "24 months return to base",
    paymentTerms: "NET_30",
    validityDays: 60,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: rfqLines[0].itemName, quantity: 10, unit: "unit", unitPrice: 1750, taxRate: 7.5 },
    ],
  });
  check(alphaDraft.status === 200 && alphaDraft.body?.status === "DRAFT", "§15 — an unfinished quotation saves as a draft", alphaDraft.body?.status);

  const buyerSeesDraft = await admin.get(`/api/rfqs/${rfqId}`);
  check(
    !buyerSeesDraft.body?.quotations?.some((q) => q.vendorId === alpha.id),
    "a draft quotation is invisible to the buyer"
  );

  const resumed = await alphaPortal.get(`/api/supplier/rfqs/${rfqId}/quotation`);
  check(
    resumed.body?.status === "DRAFT" && resumed.body?.lineItems?.length === 1,
    "the supplier can leave and return to the draft without losing it"
  );

  const incomplete = await alphaPortal.post(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 21,
    validityDays: 60,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: rfqLines[0].itemName, quantity: 10, unit: "unit", unitPrice: 1750, taxRate: 7.5 },
    ],
  });
  check(
    incomplete.status === 422,
    "§16 — submitting without answering every line is refused",
    `HTTP ${incomplete.status}`
  );

  const alphaSubmit = await alphaPortal.post(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 21,
    warranty: "24 months return to base",
    paymentTerms: "NET_30",
    validityDays: 60,
    supplierReference: "ALPHA-Q-001",
    shippingAmount: 250,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: rfqLines[0].itemName, quantity: 10, unit: "unit", unitPrice: 1750, taxRate: 7.5 },
      { rfqLineItemId: rfqLines[1].id, itemName: rfqLines[1].itemName, quantity: 10, unit: "unit", unitPrice: 200, taxRate: 7.5 },
    ],
  });
  check(alphaSubmit.status === 200 && alphaSubmit.body?.status === "SUBMITTED", "§16 — a complete quotation submits", alphaSubmit.body?.status);

  // 10×1750 + 10×200 = 19,500 net; +7.5% tax = 1,462.50; +250 shipping = 21,212.50
  check(
    money(alphaSubmit.body?.totalAmount) === 21212.5,
    "§14 — the total is computed from the lines, not taken from the caller",
    `${alphaSubmit.body?.totalAmount}`
  );

  const tamper = await alphaPortal.raw("POST", `/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 21,
    validityDays: 60,
    totalAmount: 1,
    subtotal: 1,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: "x", quantity: 10, unit: "unit", unitPrice: 1750, taxRate: 7.5 },
      { rfqLineItemId: rfqLines[1].id, itemName: "y", quantity: 10, unit: "unit", unitPrice: 200, taxRate: 7.5 },
    ],
  });
  check(
    tamper.status === 409,
    "Rule 4 — a submitted quotation cannot be replaced without an authorised revision",
    `HTTP ${tamper.status}`
  );

  // =========================================================================
  section("6. Supplier portal — Beta, and supplier-to-supplier isolation");
  // =========================================================================
  const betaPortal = await supplier(betaUser.email);

  const betaSubmit = await betaPortal.post(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 30,
    warranty: "12 months",
    paymentTerms: "NET_45",
    validityDays: 90,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: rfqLines[0].itemName, quantity: 10, unit: "unit", unitPrice: 1690, taxRate: 7.5 },
      { rfqLineItemId: rfqLines[1].id, itemName: rfqLines[1].itemName, quantity: 10, unit: "unit", unitPrice: 240, taxRate: 7.5 },
    ],
  });
  check(betaSubmit.status === 200, "the second supplier submits a competing quotation", `HTTP ${betaSubmit.status}`);

  const betaView = await betaPortal.get(`/api/supplier/rfqs/${rfqId}`);
  const betaPayload = JSON.stringify(betaView.body);
  check(
    !betaPayload.includes("ALPHA-Q-001") && !betaPayload.includes(String(alphaSubmit.body.totalAmount)),
    "Rule 3 — a supplier cannot see a competitor's quotation or its reference"
  );

  const betaAtAlphaQuote = await betaPortal.get(`/api/rfqs/${rfqId}/comparison`);
  check(
    betaAtAlphaQuote.status === 401,
    "§49 — a supplier session cannot reach a buyer endpoint",
    `HTTP ${betaAtAlphaQuote.status}`
  );

  const betaClarifications = await betaPortal.get(`/api/supplier/rfqs/${rfqId}/clarifications`);
  check(
    Array.isArray(betaClarifications.body) && betaClarifications.body.length === 0,
    "§19 — one supplier's private question is not visible to another",
    `${betaClarifications.body?.length ?? 0} visible`
  );

  const answered = await admin.post(
    `/api/rfqs/${rfqId}/clarifications/${(await admin.get(`/api/rfqs/${rfqId}/clarifications`)).body[0].id}`,
    { answer: "Yes — 100W USB-C power delivery is mandatory.", visibility: "ALL_SUPPLIERS" }
  );
  check(answered.status === 200, "the buyer can answer a question and publish it to all bidders");

  const betaSeesNotice = await betaPortal.get(`/api/supplier/rfqs/${rfqId}/clarifications`);
  check(
    betaSeesNotice.body?.length === 1 && betaSeesNotice.body[0].isMine === false,
    "§19 — a published answer reaches every invited supplier, without naming who asked"
  );

  // =========================================================================
  section("7. Response monitoring, closing and comparison");
  // =========================================================================
  const monitored = await admin.get(`/api/rfqs/${rfqId}`);
  const invited = monitored.body.invitedVendors;
  check(
    invited.length === 2 && invited.filter((i) => i.status === "QUOTED").length === 2,
    "§23 — the response monitor is computed from real invitation rows",
    invited.map((i) => i.status).join(", ")
  );

  const dash = await admin.get("/api/rfqs/dashboard");
  check(
    dash.status === 200 && dash.body?.rfqs?.total > 0 && dash.body?.quotations?.received > 0,
    "§20 — the dashboard reports database counts, not fabricated ones",
    `${dash.body?.rfqs?.published} published, ${dash.body?.quotations?.received} quotations`
  );

  const closed = await admin.post(`/api/rfqs/${rfqId}/close`, { reason: "Verification run" });
  check(closed.status === 200 && closed.body?.status === "CLOSED", "the response period closes", closed.body?.status);

  const lateBid = await betaPortal.post(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 5,
    validityDays: 30,
    lineItems: [
      { rfqLineItemId: rfqLines[0].id, itemName: "late", quantity: 10, unit: "unit", unitPrice: 1, taxRate: 0 },
      { rfqLineItemId: rfqLines[1].id, itemName: "late", quantity: 10, unit: "unit", unitPrice: 1, taxRate: 0 },
    ],
  });
  check(
    lateBid.status === 409,
    "§17/Rule 2 — the backend refuses a submission after the RFQ closes",
    `HTTP ${lateBid.status}`
  );

  const comparison = await admin.get(`/api/rfqs/${rfqId}/comparison`);
  check(comparison.status === 200 && comparison.body?.rows?.length === 2, "§25 — the comparison matrix is built from both bids");
  check(
    comparison.body.rows.every((r) => r.coverage === 100 && r.linesQuoted === 2),
    "§26 — coverage is reported per bid, so a partial response cannot look cheapest"
  );
  const alphaRow = comparison.body.rows.find((r) => r.vendorId === alpha.id);
  const betaRow = comparison.body.rows.find((r) => r.vendorId === beta.id);
  check(
    betaRow.isLowest && !alphaRow.isLowest,
    "the cheaper bid is identified from the real totals",
    `${betaRow.totalAmount} vs ${alphaRow.totalAmount}`
  );
  check(
    comparison.body.lines.length === 2 &&
      comparison.body.lines.every((l) => l.bids.length === 2 && l.bids.every((b) => b.quoted)),
    "§26 — every RFQ line carries a normalised bid from each supplier"
  );
  check(
    comparison.body.summary.splitAwardTotal <= comparison.body.summary.lowestAmount,
    "the split-award total is computed line by line",
    `split ${comparison.body.summary.splitAwardTotal} vs best single ${comparison.body.summary.lowestAmount}`
  );

  // =========================================================================
  section("8. Evaluation");
  // =========================================================================
  const alphaQuoteId = alphaRow.quotationId;
  const betaQuoteId = betaRow.quotationId;

  const outsider = await clerk.post(`/api/rfqs/${rfqId}/quotations/${alphaQuoteId}/evaluate`, {
    criterionScores: [],
  });
  check(
    outsider.status === 403,
    "§30 — somebody who is not on the panel cannot score",
    `HTTP ${outsider.status}`
  );

  const criteriaRows = await db.rFQEvaluationCriterion.findMany({ where: { rfqId, isAutomatic: false } });
  const technical = criteriaRows.find((c) => c.name === "Technical Compliance");

  const overMax = await buyer.post(`/api/rfqs/${rfqId}/quotations/${alphaQuoteId}/evaluate`, {
    criterionScores: [{ criterionId: technical.id, score: 99 }],
  });
  check(overMax.status === 422, "a score outside the criterion's range is refused", `HTTP ${overMax.status}`);

  const autoScore = await buyer.post(`/api/rfqs/${rfqId}/quotations/${alphaQuoteId}/evaluate`, {
    criterionScores: [{ criterionId: criteriaRows.length ? (await db.rFQEvaluationCriterion.findFirst({ where: { rfqId, isAutomatic: true } })).id : technical.id, score: 5 }],
  });
  check(
    autoScore.status === 422,
    "a criterion the system scores automatically cannot be scored by hand",
    `HTTP ${autoScore.status}`
  );

  const scoreAll = async (who, quotationId, scores) =>
    who.post(`/api/rfqs/${rfqId}/quotations/${quotationId}/evaluate`, {
      criterionScores: criteriaRows.map((c, i) => ({ criterionId: c.id, score: scores[i] })),
      evaluationNotes: "Scored by the verification suite",
    });

  const chairAlpha = await scoreAll(buyer, alphaQuoteId, [9, 8, 8]);
  check(chairAlpha.status === 200, "§28 — a panel member can score a bid", `HTTP ${chairAlpha.status}`);
  await scoreAll(buyer, betaQuoteId, [6, 6, 7]);

  const finance = await employee(financeUser.email);
  await scoreAll(finance, alphaQuoteId, [7, 7, 9]);
  await scoreAll(finance, betaQuoteId, [8, 5, 6]);

  const distinct = await db.quotationScore.findMany({
    where: { quotationId: alphaQuoteId, criterionId: technical.id },
  });
  check(
    distinct.length === 2,
    "Rule 9 — a second evaluator's score is stored alongside the first, not over it",
    `${distinct.length} rows`
  );

  await scoreAll(buyer, alphaQuoteId, [10, 9, 9]);
  const history = await db.quotationScoreHistory.count({
    where: { scoreRef: { quotationId: alphaQuoteId } },
  });
  check(history >= 3, "§28 — re-scoring preserves the previous values", `${history} superseded scores`);

  const chairView = await buyer.get(`/api/rfqs/${rfqId}/evaluation`);
  check(
    chairView.body?.canSeeAll === true && Array.isArray(chairView.body?.panelScores),
    "§30 — the panel chair can see every evaluator's scoring"
  );

  const memberView = await (await employee(deptUser.email)).get(`/api/rfqs/${rfqId}/evaluation`);
  check(
    memberView.body?.canSeeAll === false && memberView.body?.panelScores === null,
    "§30 — an ordinary panel member sees the aggregate and their own scores, not their colleagues'"
  );

  const result = chairView.body.results;
  check(
    result.length === 2 && result.every((r) => typeof r.weightedScore === "number"),
    "§31 — every bid has a weighted result derived from the configured criteria",
    result.map((r) => `${r.vendorName.split(" ")[0]} ${r.weightedScore}`).join(", ")
  );
  check(
    result[0].criteria.reduce((s, c) => s + c.contribution, 0).toFixed(1) === result[0].weightedScore.toFixed(1),
    "§31 — the total is the sum of its per-criterion contributions, and can be re-derived"
  );

  // =========================================================================
  section("9. Award recommendation and approval");
  // =========================================================================
  const winner = result[0];

  const noJustification = await admin.post(`/api/rfqs/${rfqId}/recommendations`, {
    quotationId: winner.quotationId,
    justification: "ok",
  });
  check(noJustification.status === 422, "an award recommendation needs a real justification", `HTTP ${noJustification.status}`);

  const recommended = await admin.post(`/api/rfqs/${rfqId}/recommendations`, {
    quotationId: winner.quotationId,
    type: "FULL",
    justification:
      "Highest weighted score across price, delivery and technical compliance, with the strongest warranty terms.",
  });
  check(recommended.status === 200, "§32 — an award recommendation can be raised", `HTTP ${recommended.status}`);

  const recommendation = recommended.body?.recommendations?.[0];
  check(
    Boolean(recommendation?.evaluationSummary),
    "§32 — the recommendation freezes the evaluation it was based on"
  );

  const notApprover = await clerk.post(
    `/api/rfqs/${rfqId}/recommendations/${recommendation.id}/decide`,
    { stepId: "anything", decision: "APPROVED" }
  );
  check(notApprover.status === 403, "an employee without rfqs.approveAward cannot decide an award", `HTTP ${notApprover.status}`);

  const sentForApproval = await admin.post(`/api/rfqs/${rfqId}/recommendations/${recommendation.id}/submit`, {});
  check(sentForApproval.status === 200, "§33 — the recommendation enters the award approval chain", `HTTP ${sentForApproval.status}`);

  const stages = await db.approvalStep.count({
    where: { instance: { entityType: "AWARD", entityId: recommendation.id } },
  });
  check(
    stages >= 1,
    "the award chain is built from the configured workflow, banded by value",
    `${stages} stages for ${recommendation.currency} ${recommendation.recommendedAmount}`
  );

  let awardDecision = null;
  for (let i = 0; i < 4; i++) {
    const step = await decideAs(
      "AWARD",
      recommendation.id,
      "APPROVED",
      "Approved by the verification suite",
      `/api/rfqs/${rfqId}/recommendations/${recommendation.id}/decide`
    );
    if (!step.approver) break;
    awardDecision = step;
  }
  check(
    awardDecision?.status === 200,
    "§33 — every configured stage can be decided by its assigned approver"
  );

  const awardedRfq = await db.rFQ.findUnique({
    where: { id: rfqId },
    include: { awards: true, selectedQuotation: { include: { vendor: true } } },
  });
  check(
    awardedRfq.status === "AWARDED" && awardedRfq.awards.length === 1,
    "§34 — clearing the award approval moves the RFQ to AWARDED and writes the award record",
    awardedRfq.status
  );
  check(
    awardedRfq.selectedQuotation?.vendorId === winner.vendorId,
    "the winning supplier on the RFQ is the one that was recommended and approved",
    awardedRfq.selectedQuotation?.vendor?.companyName
  );

  // Everything that was not awarded must still exist. Of those, only the bids
  // still in contention become REJECTED — a draft that a later submission replaced
  // is already WITHDRAWN, and a re-quote's predecessor is SUPERSEDED. Overwriting
  // either with REJECTED would say the supplier lost a competition they had
  // already stepped out of.
  const losers = await db.quotation.findMany({ where: { rfqId, id: { not: winner.quotationId } } });
  const contenders = losers.filter((q) => q.status !== "WITHDRAWN" && q.status !== "SUPERSEDED");
  check(
    losers.length > 0 && contenders.length > 0 && contenders.every((q) => q.status === "REJECTED"),
    "§34 — unsuccessful quotations are retained, not deleted",
    `${losers.length} retained · ${contenders.length} rejected, ${losers.length - contenders.length} withdrawn or superseded`
  );

  const eventAfterAward = await db.sourcingEvent.findUnique({
    where: { id: rfqRes.body.sourcingEventId },
    select: { status: true, awardedAt: true },
  });
  check(
    eventAfterAward?.status === "AWARDED" && Boolean(eventAfterAward.awardedAt),
    "the sourcing event closes out with its RFQ",
    eventAfterAward?.status
  );

  const requestAfterAward = await db.purchaseRequest.findUnique({ where: { id: requestId } });
  check(
    requestAfterAward.status === "ORDERED",
    "§36 — the originating request registers that it is being fulfilled",
    requestAfterAward.status
  );

  // =========================================================================
  section("10. Confidentiality after award");
  // =========================================================================
  const loserPortal = betaRow.quotationId === winner.quotationId ? alphaPortal : betaPortal;
  const loserView = await loserPortal.get(`/api/supplier/rfqs/${rfqId}`);
  const loserPayload = JSON.stringify(loserView.body);
  check(
    !loserPayload.includes("weightedScore") &&
      !loserPayload.includes("panelScores") &&
      !loserPayload.includes("justification"),
    "Rule 10 — an unsuccessful supplier cannot see the evaluation, the ranking or the award reasoning"
  );

  const loserQuote = await loserPortal.get(`/api/supplier/rfqs/${rfqId}/quotation`);
  check(
    loserQuote.body && !("evaluationScore" in loserQuote.body) && !("weightedScore" in loserQuote.body),
    "§30 — a supplier's own quotation comes back without the buyer's assessment of it"
  );

  const loserEval = await loserPortal.get(`/api/rfqs/${rfqId}/evaluation`);
  check(loserEval.status === 401, "a supplier cannot reach the evaluation endpoint", `HTTP ${loserEval.status}`);

  // =========================================================================
  section("11. Multi-tenancy");
  // =========================================================================
  const otherOrg = await db.organization.create({
    data: { name: `Isolation Org ${stamp}`, status: "ACTIVE" },
  });
  cleanup.orgIds.push(otherOrg.id);

  const foreignVendor = await makeVendor(`Foreign Supplier ${stamp}`, "ACTIVE", otherOrg.id);
  const foreignContact = await db.supplierUser.create({
    data: {
      organizationId: otherOrg.id,
      vendorId: foreignVendor.id,
      email: `foreign.${stamp}@verify.test`,
      contactName: "Foreign Contact",
      passwordHash: hash,
      accessStatus: "ACTIVE",
    },
  });

  const foreignPortal = await supplier(foreignContact.email);
  const foreignAtRfq = await foreignPortal.get(`/api/supplier/rfqs/${rfqId}`);
  check(
    foreignAtRfq.status === 404,
    "§41 — a supplier in another organization cannot read this tenant's RFQ",
    `HTTP ${foreignAtRfq.status}`
  );

  const foreignList = await foreignPortal.get("/api/supplier/rfqs");
  check(
    foreignList.body?.items?.length === 0,
    "§42 — their invitation list is empty, not another tenant's",
    `${foreignList.body?.items?.length ?? 0} items`
  );

  const uninvitedSubmit = await foreignPortal.post(`/api/supplier/rfqs/${rfqId}/quotation`, {
    deliveryDays: 1,
    validityDays: 30,
    lineItems: [{ rfqLineItemId: rfqLines[0].id, itemName: "x", quantity: 1, unit: "unit", unitPrice: 1 }],
  });
  check(
    uninvitedSubmit.status === 404,
    "Rule 1 — a supplier cannot quote on an RFQ they were not invited to",
    `HTTP ${uninvitedSubmit.status}`
  );

  const foreignAdminUser = await db.user.create({
    data: {
      organizationId: otherOrg.id,
      email: `isolation.${stamp}@verify.test`,
      name: "Isolation Admin",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      initials: "IA",
    },
  });
  const crossRead = await db.rFQ.findFirst({
    where: { id: rfqId, organizationId: otherOrg.id },
  });
  check(
    crossRead === null,
    "§41 — the RFQ does not resolve under another organization's id",
  );
  await db.user.delete({ where: { id: foreignAdminUser.id } });

  // =========================================================================
  section("12. Audit trail");
  // =========================================================================
  const audit = await db.auditLogEntry.findMany({
    where: { organizationId: org.id, resourceId: { in: [rfqId, recommendation.id] } },
    select: { action: true },
  });
  const actions = new Set(audit.map((a) => a.action));
  const expected = [
    "rfq.created",
    "rfq.submitted_for_approval",
    "rfq.approved",
    "rfq.published",
    "rfq.closed",
    "rfq.awarded",
    "award.recommended",
    "award.approved",
  ];
  const missing = expected.filter((a) => !actions.has(a));
  check(
    missing.length === 0,
    "§39 — every material event in the chain is on the audit trail",
    missing.length ? `missing: ${missing.join(", ")}` : `${actions.size} distinct actions`
  );

  const supplierAudit = await db.auditLogEntry.count({
    where: { organizationId: org.id, supplierUserId: { in: [alphaUser.id, betaUser.id] } },
  });
  check(supplierAudit > 0, "§39 — supplier actions are audited against the contact who took them", `${supplierAudit} entries`);

  const traceable = await db.rFQ.findUnique({
    where: { id: rfqId },
    select: {
      requestId: true,
      sourcingEventId: true,
      selectedQuotationId: true,
      awards: { select: { recommendationId: true, quotationId: true, vendorId: true } },
    },
  });
  check(
    Boolean(traceable.requestId) &&
      Boolean(traceable.sourcingEventId) &&
      Boolean(traceable.selectedQuotationId) &&
      Boolean(traceable.awards[0]?.recommendationId),
    "§36 — request → event → RFQ → quotation → recommendation → award is unbroken"
  );

  // =========================================================================
  section("Cleanup");
  // =========================================================================
  const instanceIds = (
    await db.approvalInstance.findMany({
      where: {
        OR: [
          { entityType: "RFQ", entityId: { in: cleanup.rfqIds } },
          { entityType: "AWARD", entityId: recommendation.id },
        ],
      },
      select: { id: true },
    })
  ).map((i) => i.id);

  await db.approvalStep.deleteMany({ where: { instanceId: { in: instanceIds } } });
  await db.approvalInstance.deleteMany({ where: { id: { in: instanceIds } } });
  await db.rFQ.deleteMany({ where: { id: { in: cleanup.rfqIds } } });
  await db.sourcingEvent.deleteMany({ where: { id: { in: cleanup.eventIds } } });

  const orphanQuotes = await db.quotation.count({ where: { rfqId: { in: cleanup.rfqIds } } });
  const orphanLines = await db.rFQLineItem.count({ where: { rfqId: { in: cleanup.rfqIds } } });
  const orphanInvites = await db.rFQVendor.count({ where: { rfqId: { in: cleanup.rfqIds } } });
  check(
    orphanQuotes === 0 && orphanLines === 0 && orphanInvites === 0,
    "§45 — removing an RFQ cascades its lines, invitations and quotations; no orphans",
    `${orphanQuotes} quotations, ${orphanLines} lines, ${orphanInvites} invitations`
  );

  await db.approvalStep.deleteMany({ where: { requestId: { in: cleanup.requestIds } } });
  await db.purchaseRequest.deleteMany({ where: { id: { in: cleanup.requestIds } } });
  await db.supplierUser.deleteMany({ where: { vendorId: { in: cleanup.vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: cleanup.vendorIds } } });
  await db.organization.deleteMany({ where: { id: { in: cleanup.orgIds } } });
  ok("test RFQs, events, requests, suppliers and the isolation organization removed");

  console.log(`\n${"─".repeat(70)}`);
  if (fail > 0) {
    console.log("\x1b[31mFailures:\x1b[0m");
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\x1b[31mHarness error:\x1b[0m", e);
  await db.$disconnect();
  process.exit(1);
});
