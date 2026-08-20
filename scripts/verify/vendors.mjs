// NextMav Procure — vendor lifecycle verification.
//
// Drives the whole of Phase 3 over HTTP, as a browser would: create a supplier,
// give it contacts, categories, documents and compliance requirements, submit it
// into the configured approval workflow, decide it as the assigned approvers,
// then suspend, reactivate and archive it. Along the way it checks the things
// that are supposed to be *refused* — because a control nobody has tried to
// break is not a control.
//
// This is deliberately an HTTP test rather than a unit test. Every guarantee this
// phase claims (permission, tenancy, transitions, audit) lives on the path
// between the browser and the database, and only a request exercises all of it.
//
// Run:  npm run verify:vendors          (dev server must be running)
//       BASE_URL=https://… npm run verify:vendors

import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "NextMav#2026";

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

/** A logged-in HTTP client that keeps its own cookie jar. */
async function client(email) {
  const jar = new Map();
  let cookie = "";

  const req = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Supabase chunks its auth cookie when the JWT exceeds 4KB, so every cookie
    // is kept rather than one fixed name.
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

  const r = await req("POST", "/api/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);

  return {
    email,
    get: (p, q) => req("GET", q ? `${p}?${new URLSearchParams(q)}` : p),
    post: (p, b) => req("POST", p, b),
    patch: (p, b) => req("PATCH", p, b),
    put: (p, b) => req("PUT", p, b),
    del: (p) => req("DELETE", p),
  };
}

const iso = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString();
const stamp = Date.now();

/** Approves whatever stage is currently active, as the approvals queue does. */
async function clearStage(who, vendorId, decision = "APPROVED", comment = "") {
  const detail = (await who.get(`/api/vendors/${vendorId}`)).body;
  const live = detail.approvals?.find((a) => a.status === "IN_PROGRESS");
  if (!live) return { status: 0, body: null, step: null };
  const step = live.steps
    .filter((s) => s.decision === "PENDING")
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!step) return { status: 0, body: null, step: null };
  const res = await who.post(`/api/vendors/${vendorId}/decide`, {
    stepId: step.id,
    decision,
    comment,
  });
  return { ...res, step };
}

async function main() {
  console.log(`\x1b[1mVendor lifecycle — ${BASE}\x1b[0m`);

  // -------------------------------------------------------------------------
  section("Setup");
  // -------------------------------------------------------------------------
  const org = await db.organization.findFirst({ select: { id: true, name: true } });
  if (!org) throw new Error("no organization in the database");

  const workflow = await db.approvalWorkflow.findFirst({
    where: { organizationId: org.id, entityType: "VENDOR", isActive: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  check(
    Boolean(workflow) && workflow.stages.length > 0,
    "a vendor approval workflow is configured",
    workflow ? `${workflow.name} · ${workflow.stages.length} stages` : "none found"
  );

  const admin = await client("amina.okafor@apex.com");
  const requester = await client("emeka.eze@apex.com");
  ok("signed in as an administrator and as an ordinary employee");

  // -------------------------------------------------------------------------
  section("1. Create");
  // -------------------------------------------------------------------------
  const companyName = `Verify Supplies ${stamp}`;
  const taxNumber = `TIN-${stamp}`;

  const created = await admin.post("/api/vendors", {
    companyName,
    legalName: `${companyName} Limited`,
    vendorType: "SUPPLIER",
    email: `contact${stamp}@verify-supplies.test`,
    phone: "+234 800 000 0000",
    address: "12 Verification Way",
    city: "Lagos",
    country: "Nigeria",
    taxNumber,
    registrationNumber: `RC-${stamp}`,
    category: "IT Equipment",
    paymentTerms: "NET_30",
    preferredCurrency: "NGN",
  });
  check(created.status === 200, "an authorised user can create a vendor", `HTTP ${created.status}`);
  const vendorId = created.body?.id;
  if (!vendorId) throw new Error(`vendor not created: ${JSON.stringify(created.body)}`);

  check(created.body.status === "PROSPECTIVE", "a new vendor starts as prospective", created.body.status);
  check(
    created.body.complianceState === "NOT_STARTED",
    "compliance starts at not-started, not compliant",
    created.body.complianceState
  );

  const row = await db.vendor.findUnique({ where: { id: vendorId } });
  check(Boolean(row) && row.organizationId === org.id, "the vendor is persisted against the right organization");

  const denied = await requester.post("/api/vendors", { companyName: `Should Not Exist ${stamp}` });
  check(denied.status === 403, "an employee without vendors.create is refused", `HTTP ${denied.status}`);

  // -------------------------------------------------------------------------
  section("2. Duplicate detection");
  // -------------------------------------------------------------------------
  const dupPreview = await admin.post("/api/vendors/duplicates", { taxNumber });
  check(
    Array.isArray(dupPreview.body) && dupPreview.body.some((d) => d.id === vendorId && d.confidence === "HIGH"),
    "a matching tax number is reported as a high-confidence duplicate"
  );

  const dupCreate = await admin.post("/api/vendors", { companyName: `Other Name ${stamp}`, taxNumber });
  check(
    dupCreate.status === 409,
    "creating a second vendor on the same tax number is refused",
    `HTTP ${dupCreate.status}`
  );
  check(
    dupCreate.body?.error?.details?.duplicates?.length > 0,
    "the refusal names the vendors it matched, so the user can look"
  );

  const acknowledged = await admin.post("/api/vendors", {
    companyName: `Genuinely Different ${stamp}`,
    taxNumber,
    acknowledgeDuplicates: true,
  });
  check(
    acknowledged.status === 200,
    "an authorised user who has reviewed the matches can still proceed",
    `HTTP ${acknowledged.status}`
  );
  const ackVendorId = acknowledged.body?.id;

  const nameOnly = await admin.post("/api/vendors/duplicates", { companyName: `${companyName} Ltd` });
  check(
    Array.isArray(nameOnly.body) && nameOnly.body.some((d) => d.id === vendorId),
    "a similar company name is surfaced as a possible match"
  );

  // -------------------------------------------------------------------------
  section("3. Contacts and categories");
  // -------------------------------------------------------------------------
  const contact = await admin.post(`/api/vendors/${vendorId}/contacts`, {
    name: "Adaeze Okonkwo",
    email: `adaeze${stamp}@verify-supplies.test`,
    phone: "+234 801 111 1111",
    jobTitle: "Account Manager",
    type: "ACCOUNT_MANAGER",
    isPrimary: true,
  });
  check(contact.status === 200 && contact.body.contacts.length === 1, "a contact can be added");
  check(contact.body.contacts[0].isPrimary === true, "the first contact is the primary one");

  const second = await admin.post(`/api/vendors/${vendorId}/contacts`, {
    name: "Bola Adeyinka",
    type: "FINANCE",
    isPrimary: true,
  });
  const primaries = second.body.contacts.filter((c) => c.isPrimary);
  check(primaries.length === 1, "promoting a new primary contact demotes the old one", `${primaries.length} primary`);

  const categories = await db.procurementCategory.findMany({
    where: { organizationId: org.id },
    take: 2,
    select: { id: true, name: true },
  });
  const setCats = await admin.put(`/api/vendors/${vendorId}/categories`, {
    categoryIds: categories.map((c) => c.id),
    preferredCategoryIds: [categories[0].id],
  });
  check(
    setCats.status === 200 && setCats.body.categories.length === categories.length,
    "supply categories can be set",
    categories.map((c) => c.name).join(", ")
  );

  const foreignCategory = await admin.put(`/api/vendors/${vendorId}/categories`, {
    categoryIds: ["cat-does-not-exist"],
  });
  check(foreignCategory.status === 422, "an unknown category id is rejected", `HTTP ${foreignCategory.status}`);

  // -------------------------------------------------------------------------
  section("4. Compliance and documents");
  // -------------------------------------------------------------------------
  const req1 = await admin.post(`/api/vendors/${vendorId}/compliance`, {
    type: "TAX_CLEARANCE",
    name: "Tax Clearance Certificate",
    isMandatory: true,
    expiresAt: iso(365),
  });
  check(req1.status === 200, "a compliance requirement can be added");
  check(
    req1.body.complianceState === "IN_PROGRESS" || req1.body.complianceState === "NOT_STARTED",
    "adding a requirement does not make the vendor compliant",
    req1.body.complianceState
  );

  await admin.post(`/api/vendors/${vendorId}/compliance`, {
    type: "BUSINESS_REGISTRATION",
    name: "Certificate of Incorporation",
    isMandatory: true,
  });
  const withTwo = (await admin.get(`/api/vendors/${vendorId}`)).body;
  const taxReq = withTwo.compliance.find((c) => c.type === "TAX_CLEARANCE");
  const regReq = withTwo.compliance.find((c) => c.type === "BUSINESS_REGISTRATION");
  check(withTwo.compliance.length === 2, "both requirements are on the vendor");

  const verifyWithoutEvidence = await admin.post(
    `/api/vendors/${vendorId}/compliance/${taxReq.id}/decide`,
    { decision: "VERIFIED" }
  );
  check(
    verifyWithoutEvidence.status === 409,
    "a requirement cannot be verified with no evidence attached",
    `HTTP ${verifyWithoutEvidence.status}`
  );

  const doc = await admin.post(`/api/vendors/${vendorId}/documents`, {
    type: "TAX",
    name: "Tax Clearance 2026",
    documentNumber: `TCC-${stamp}`,
    expiresAt: iso(365),
    requirementId: taxReq.id,
  });
  check(doc.status === 200, "a document can be recorded against a requirement");
  const attached = doc.body.compliance.find((c) => c.id === taxReq.id);
  check(attached?.status === "SUBMITTED", "attaching evidence moves the requirement to submitted", attached?.status);
  const docRow = doc.body.documents[0];
  check(docRow.status === "PENDING_REVIEW", "an unverified document reads as pending review", docRow.status);

  const verified = await admin.post(
    `/api/vendors/${vendorId}/documents/${docRow.id}/verify`,
    { decision: "VERIFIED" }
  );
  check(verified.status === 200, "a document can be verified");
  const verifiedDoc = verified.body.documents.find((d) => d.id === docRow.id);
  check(verifiedDoc.status === "VALID", "a verified document with a future expiry is valid", verifiedDoc.status);
  check(
    verified.body.compliance.find((c) => c.id === taxReq.id).status === "VERIFIED",
    "verifying the evidence verifies the requirement resting on it"
  );
  check(
    verified.body.complianceState === "PARTIALLY_COMPLIANT",
    "one of two mandatory requirements satisfied reads as partially compliant",
    verified.body.complianceState
  );
  check(verified.body.complianceScore === 50, "the score is the proportion satisfied", `${verified.body.complianceScore}%`);

  const deleteVerified = await admin.del(`/api/vendors/${vendorId}/documents/${docRow.id}`);
  check(
    deleteVerified.status === 409,
    "a verified document cannot be deleted — it is evidence a decision rested on",
    `HTTP ${deleteVerified.status}`
  );

  const waiveNoReason = await admin.post(`/api/vendors/${vendorId}/compliance/${regReq.id}/decide`, {
    decision: "WAIVED",
    notes: "short",
  });
  check(waiveNoReason.status === 422, "a waiver without a real reason is refused", `HTTP ${waiveNoReason.status}`);

  const waived = await admin.post(`/api/vendors/${vendorId}/compliance/${regReq.id}/decide`, {
    decision: "WAIVED",
    notes: "Incorporation confirmed directly with the corporate affairs registry on file.",
  });
  check(waived.status === 200, "a requirement can be waived with an attributed reason");
  check(
    waived.body.complianceState === "COMPLIANT",
    "verified plus waived satisfies every mandatory requirement",
    waived.body.complianceState
  );
  const waivedReq = waived.body.compliance.find((c) => c.id === regReq.id);
  check(Boolean(waivedReq.waivedById && waivedReq.waivedReason), "the waiver records who set it aside and why");

  // Expiry derivation, on a document that has already lapsed.
  const expiredDoc = await admin.post(`/api/vendors/${vendorId}/documents`, {
    type: "INSURANCE",
    name: "Public Liability Insurance (lapsed)",
    expiresAt: iso(-5),
  });
  const lapsed = expiredDoc.body.documents.find((d) => d.name.includes("lapsed"));
  await admin.post(`/api/vendors/${vendorId}/documents/${lapsed.id}/verify`, { decision: "VERIFIED" });
  const afterExpiry = (await admin.get(`/api/vendors/${vendorId}`)).body;
  const lapsedNow = afterExpiry.documents.find((d) => d.id === lapsed.id);
  check(lapsedNow.status === "EXPIRED", "a verified document past its expiry reads as expired", lapsedNow.status);
  check(lapsedNow.daysToExpiry < 0, "days-to-expiry is negative once lapsed", String(lapsedNow.daysToExpiry));

  const soonDoc = await admin.post(`/api/vendors/${vendorId}/documents`, {
    type: "CERTIFICATE",
    name: "ISO 9001 (expiring)",
    expiresAt: iso(10),
  });
  const soon = soonDoc.body.documents.find((d) => d.name.includes("expiring"));
  await admin.post(`/api/vendors/${vendorId}/documents/${soon.id}/verify`, { decision: "VERIFIED" });
  const afterSoon = (await admin.get(`/api/vendors/${vendorId}`)).body;
  check(
    afterSoon.documents.find((d) => d.id === soon.id).status === "EXPIRING",
    "a document inside the warning window reads as expiring"
  );

  const expiring = await admin.get("/api/vendors/expiring", { withinDays: "30" });
  check(
    Array.isArray(expiring.body) && expiring.body.some((v) => v.id === vendorId),
    "the expiring-compliance report finds this vendor"
  );

  // -------------------------------------------------------------------------
  section("5. Submission and approval");
  // -------------------------------------------------------------------------
  const premature = await admin.post(`/api/vendors/${ackVendorId}/submit`);
  check(
    premature.status === 422,
    "a vendor with no contacts or categories cannot be submitted for review",
    `HTTP ${premature.status}`
  );
  check(
    premature.body?.error?.details?.issues?.length > 0,
    "the refusal lists exactly what is missing",
    (premature.body?.error?.details?.issues ?? []).map((i) => i.path).join(", ")
  );

  const badTransition = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "ACTIVATE" });
  check(
    badTransition.status === 409,
    "a prospective vendor cannot be activated without being approved",
    `HTTP ${badTransition.status}`
  );

  const submitted = await admin.post(`/api/vendors/${vendorId}/submit`);
  check(submitted.status === 200, "a complete vendor can be submitted for review", `HTTP ${submitted.status}`);
  check(
    submitted.body.status === "PENDING_APPROVAL",
    "submission moves the vendor to pending approval",
    submitted.body.status
  );

  const instance = await db.approvalInstance.findFirst({
    where: { entityType: "VENDOR", entityId: vendorId, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  check(Boolean(instance), "an approval instance exists in the database");
  check(
    instance.steps.length === workflow.stages.length,
    "the chain has one step per configured stage",
    `${instance?.steps.length} steps for ${workflow.stages.length} stages`
  );
  check(
    instance.workflowId === workflow.id,
    "the instance records which workflow governed it"
  );
  check(
    !instance.steps.some((s) => s.approverId === "usr_amina"),
    "the person who submitted the vendor is not one of its approvers"
  );

  // Every approver acts through their own session.
  const approverEmails = [];
  for (const step of instance.steps) {
    const u = await db.user.findUnique({ where: { id: step.approverId }, select: { email: true } });
    approverEmails.push(u.email);
  }
  console.log(`  \x1b[90mchain: ${approverEmails.join(" → ")}\x1b[0m`);

  const firstStep = instance.steps[0];
  const wrongPerson = await requester.post(`/api/vendors/${vendorId}/decide`, {
    stepId: firstStep.id,
    decision: "APPROVED",
  });
  check(
    wrongPerson.status === 403,
    "a user without vendors.approve cannot decide",
    `HTTP ${wrongPerson.status}`
  );

  // A user who *can* approve, but is not this step's assignee, is still refused.
  const notAssigned = approverEmails.find((e, i) => i > 0);
  if (notAssigned) {
    const other = await client(notAssigned);
    const outOfTurn = await other.post(`/api/vendors/${vendorId}/decide`, {
      stepId: firstStep.id,
      decision: "APPROVED",
    });
    check(
      outOfTurn.status === 409,
      "an approver cannot decide a step assigned to someone else",
      `HTTP ${outOfTurn.status}`
    );

    const skipAhead = await other.post(`/api/vendors/${vendorId}/decide`, {
      stepId: instance.steps[1].id,
      decision: "APPROVED",
    });
    check(
      skipAhead.status === 409,
      "a later stage cannot be decided while an earlier one is outstanding",
      `HTTP ${skipAhead.status}`
    );
  }

  // Walk the chain properly.
  let stageNo = 0;
  for (const email of approverEmails) {
    stageNo++;
    const who = await client(email);
    const queue = await who.get("/api/vendors/approvals/queue");
    const inQueue = Array.isArray(queue.body) && queue.body.some((q) => q.vendor.id === vendorId);
    check(inQueue, `stage ${stageNo}: the vendor is in ${email}'s approval queue`);

    const decided = await clearStage(who, vendorId, "APPROVED", `Stage ${stageNo} cleared by verification`);
    check(decided.status === 200, `stage ${stageNo}: ${email} approves`, `HTTP ${decided.status}`);

    if (stageNo < approverEmails.length) {
      check(
        decided.body.status === "PENDING_APPROVAL",
        `stage ${stageNo}: the vendor stays pending until the last stage`,
        decided.body.status
      );
    } else {
      check(
        decided.body.status === "APPROVED",
        "the final approval moves the vendor to approved",
        decided.body.status
      );
      check(Boolean(decided.body.approvedAt && decided.body.approvedById), "approval is stamped with who and when");
    }
  }

  const approvedRow = await db.vendor.findUnique({ where: { id: vendorId } });
  check(approvedRow.status === "APPROVED", "the database agrees the vendor is approved", approvedRow.status);
  const closedInstance = await db.approvalInstance.findFirst({
    where: { entityType: "VENDOR", entityId: vendorId },
    orderBy: { startedAt: "desc" },
  });
  check(closedInstance.status === "APPROVED", "the approval instance is closed as approved", closedInstance.status);

  // -------------------------------------------------------------------------
  section("6. Activation and status controls");
  // -------------------------------------------------------------------------
  const activated = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "ACTIVATE" });
  check(activated.status === 200 && activated.body.status === "ACTIVE", "an approved vendor can be activated");
  check(Boolean(activated.body.activatedAt), "activation is dated");

  const preferred = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "SET_PREFERRED" });
  check(
    preferred.body.isPreferred === true && preferred.body.status === "ACTIVE",
    "marking preferred is a flag, not a status — the vendor stays active",
    preferred.body.status
  );

  const suspendNoReason = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "SUSPEND" });
  check(suspendNoReason.status === 422, "suspension requires a reason", `HTTP ${suspendNoReason.status}`);

  const suspended = await admin.post(`/api/vendors/${vendorId}/actions`, {
    action: "SUSPEND",
    reason: "Repeated late deliveries pending review",
  });
  check(suspended.status === 200 && suspended.body.status === "SUSPENDED", "a vendor can be suspended with a reason");
  check(
    suspended.body.suspendedReason === "Repeated late deliveries pending review",
    "the suspension reason is kept on the record"
  );

  const reactivated = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "REACTIVATE" });
  check(
    reactivated.status === 200 && reactivated.body.status === "ACTIVE",
    "a suspended vendor can be reactivated"
  );
  check(!reactivated.body.suspendedReason, "reactivation clears the suspension reason");

  const requesterSuspend = await requester.post(`/api/vendors/${vendorId}/actions`, {
    action: "SUSPEND",
    reason: "should not be permitted",
  });
  check(
    requesterSuspend.status === 403,
    "an ordinary employee cannot suspend a strategic supplier",
    `HTTP ${requesterSuspend.status}`
  );

  // -------------------------------------------------------------------------
  section("7. Rejection and resubmission");
  // -------------------------------------------------------------------------
  const rejectName = `Reject Path ${stamp}`;
  const rejectee = (
    await admin.post("/api/vendors", {
      companyName: rejectName,
      taxNumber: `TIN-R-${stamp}`,
      category: "IT Equipment",
    })
  ).body;
  await admin.post(`/api/vendors/${rejectee.id}/contacts`, { name: "Contact Person", isPrimary: true });
  await admin.put(`/api/vendors/${rejectee.id}/categories`, { categoryIds: [categories[0].id] });
  const rSubmit = await admin.post(`/api/vendors/${rejectee.id}/submit`);
  check(rSubmit.status === 200, "the second vendor enters approval", `HTTP ${rSubmit.status}`);

  const rInstance = await db.approvalInstance.findFirst({
    where: { entityType: "VENDOR", entityId: rejectee.id, status: "IN_PROGRESS" },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  const firstApprover = await db.user.findUnique({
    where: { id: rInstance.steps[0].approverId },
    select: { email: true },
  });
  const reviewer = await client(firstApprover.email);

  const noReason = await reviewer.post(`/api/vendors/${rejectee.id}/decide`, {
    stepId: rInstance.steps[0].id,
    decision: "REJECTED",
  });
  check(noReason.status === 422, "rejecting a vendor requires a reason", `HTTP ${noReason.status}`);

  const rejected = await reviewer.post(`/api/vendors/${rejectee.id}/decide`, {
    stepId: rInstance.steps[0].id,
    decision: "REJECTED",
    comment: "Bank details could not be confirmed with the issuing bank.",
  });
  check(rejected.status === 200 && rejected.body.status === "REJECTED", "a reviewer can reject at the first stage");
  check(
    rejected.body.rejectedReason === "Bank details could not be confirmed with the issuing bank.",
    "the rejection reason is visible on the vendor"
  );

  const remainingSteps = await db.approvalStep.count({
    where: { instanceId: rInstance.id, decision: "PENDING" },
  });
  check(remainingSteps === 0, "a rejection ends the chain rather than leaving stages owed", `${remainingSteps} pending`);

  const historyKept = await db.approvalStep.findFirst({
    where: { instanceId: rInstance.id, decision: "REJECTED" },
  });
  check(Boolean(historyKept), "the rejecting decision is kept as history");

  // Revise and resubmit.
  //
  // The partial edit below is also a regression guard. `updateVendorSchema` is
  // built with zod's `.partial()`, which makes a field optional but leaves its
  // `.default()` in place — so a PATCH that mentions only the bank details still
  // parsed to `categoryIds: []` and `tags: []`. Because `[]` is truthy, the
  // service treated that as "set the categories to nothing" and deleted every
  // link, which then made the vendor unsubmittable for a reason nowhere near the
  // edit that caused it.
  const beforeEdit = (await admin.get(`/api/vendors/${rejectee.id}`)).body;
  const patched = await admin.patch(`/api/vendors/${rejectee.id}`, {
    bankName: "First Bank",
    bankAccount: "0123456789",
  });
  check(patched.status === 200, "the rejected vendor can be revised", `HTTP ${patched.status}`);
  check(
    patched.body.categories.length === beforeEdit.categories.length,
    "a partial edit leaves untouched fields alone — categories survive",
    `${beforeEdit.categories.length} before, ${patched.body.categories.length} after`
  );
  check(
    patched.body.contacts.length === beforeEdit.contacts.length &&
      patched.body.vendorType === beforeEdit.vendorType &&
      patched.body.paymentTerms === beforeEdit.paymentTerms,
    "a partial edit does not reset contacts, vendor type or payment terms"
  );
  check(patched.body.bankName === "First Bank", "the field that was edited did change");
  const restart = await admin.post(`/api/vendors/${rejectee.id}/actions`, { action: "START_ONBOARDING" });
  check(
    restart.status === 200 && restart.body.status === "ONBOARDING",
    "a rejected vendor can be taken back into onboarding",
    restart.body.status
  );

  const resubmitted = await admin.post(`/api/vendors/${rejectee.id}/submit`);
  check(
    resubmitted.status === 200 && resubmitted.body.status === "PENDING_APPROVAL",
    "the revised vendor can be resubmitted",
    resubmitted.body.status
  );
  check(!resubmitted.body.rejectedReason, "resubmission clears the live rejection banner");

  const instances = await db.approvalInstance.count({
    where: { entityType: "VENDOR", entityId: rejectee.id },
  });
  check(instances === 2, "the earlier rejected approval survives as a separate instance", `${instances} instances`);
  const superseded = await db.approvalInstance.findFirst({
    where: { entityType: "VENDOR", entityId: rejectee.id, status: "REJECTED" },
  });
  check(Boolean(superseded), "the original rejection is still recorded as rejected");

  // -------------------------------------------------------------------------
  section("8. Risk and internal notes");
  // -------------------------------------------------------------------------
  const risk = await admin.post(`/api/vendors/${vendorId}/risk`, {
    level: "MEDIUM",
    score: 45,
    summary: "Single-source for two categories; delivery record otherwise clean.",
    nextReviewAt: iso(180),
  });
  check(risk.status === 200 && risk.body.riskLevel === "MEDIUM", "a risk assessment can be recorded");
  check(risk.body.riskAssessments.length >= 1, "the assessment is kept as history");
  check(risk.body.riskStatus === "ASSESSED", "the vendor's risk status follows the assessment", risk.body.riskStatus);

  const risk2 = await admin.post(`/api/vendors/${vendorId}/risk`, { level: "LOW", score: 20 });
  check(
    risk2.body.riskAssessments.length >= 2 && risk2.body.riskLevel === "LOW",
    "a later assessment supersedes the level without erasing the earlier one"
  );

  const note = await admin.post(`/api/vendors/${vendorId}/notes`, {
    body: "Negotiated 5% volume discount verbally — confirm before the next PO.",
    visibility: "INTERNAL",
  });
  check(note.status === 200 && note.body.internalNotes.length === 1, "an internal note can be added");

  const restricted = await admin.post(`/api/vendors/${vendorId}/notes`, {
    body: "Under review following a compliance query from finance.",
    visibility: "RESTRICTED",
  });
  check(restricted.status === 200, "a restricted note can be added by a vendor approver");

  const asRequester = await requester.get(`/api/vendors/${vendorId}`);
  check(asRequester.status === 200, "an ordinary employee can still view the vendor");
  const visibleNotes = asRequester.body.internalNotes ?? [];
  check(
    !visibleNotes.some((n) => n.visibility === "RESTRICTED"),
    "a restricted note is not projected to someone who cannot approve vendors",
    `${visibleNotes.length} notes visible`
  );
  check(
    asRequester.body.bankAccount === "",
    "bank details are withheld from a role that does not manage vendors"
  );

  // -------------------------------------------------------------------------
  section("9. Directory, search and metrics");
  // -------------------------------------------------------------------------
  const search = await admin.get("/api/vendors", { search: companyName, pageSize: "10" });
  check(
    search.body?.items?.some((v) => v.id === vendorId),
    "search finds the vendor by name"
  );
  const byTax = await admin.get("/api/vendors", { search: taxNumber });
  check(byTax.body?.items?.some((v) => v.id === vendorId), "search finds the vendor by tax number");
  const byContact = await admin.get("/api/vendors", { search: "Adaeze" });
  check(byContact.body?.items?.some((v) => v.id === vendorId), "search finds the vendor by contact name");

  const filtered = await admin.get("/api/vendors", { status: "ACTIVE", pageSize: "100" });
  check(
    filtered.body.items.every((v) => v.status === "ACTIVE"),
    "the status filter is applied by the database"
  );

  const paged = await admin.get("/api/vendors", { page: "1", pageSize: "2" });
  check(
    paged.body.items.length <= 2 && paged.body.total >= paged.body.items.length,
    "paging returns a page, not the whole table",
    `${paged.body.items.length} of ${paged.body.total}`
  );

  const dash = await admin.get("/api/vendors/dashboard");
  const activeInDb = await db.vendor.count({ where: { organizationId: org.id, status: "ACTIVE" } });
  check(
    dash.body.active === activeInDb,
    "the dashboard's active count matches the database",
    `${dash.body.active} vs ${activeInDb}`
  );
  const pendingInDb = await db.vendor.count({
    where: { organizationId: org.id, status: "PENDING_APPROVAL" },
  });
  check(dash.body.pendingApproval === pendingInDb, "the pending-approval count matches the database");

  // -------------------------------------------------------------------------
  section("10. Audit, activity and notifications");
  // -------------------------------------------------------------------------
  const audits = await db.auditLogEntry.findMany({
    where: { organizationId: org.id, resource: "Vendor", resourceId: vendorId },
    select: { action: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  for (const expected of [
    "vendor.created",
    "vendor.submitted_for_review",
    "vendor.approved",
    "vendor.activate",
    "vendor.suspend",
    "vendor.reactivate",
    "vendor.document_uploaded",
    "vendor.document_verified",
    "vendor.risk_assessed",
  ]) {
    check(actions.has(expected), `audit records ${expected}`);
  }

  const activity = await db.activityLog.count({ where: { vendorId } });
  check(activity > 0, "the vendor has an activity timeline", `${activity} entries`);

  const detail = (await admin.get(`/api/vendors/${vendorId}`)).body;
  check(detail.activity.length > 0, "the timeline is returned on the profile", `${detail.activity.length} events`);
  check(detail.approvals.length > 0, "the approval history is returned on the profile");

  const notifications = await db.notification.count({
    where: { organizationId: org.id, entityType: "VENDOR", entityId: vendorId },
  });
  check(notifications > 0, "real notifications were generated by the workflow", `${notifications} notifications`);

  const outbox = await db.eventOutbox.count({
    where: { organizationId: org.id, entityType: "VENDOR", entityId: vendorId },
  });
  check(outbox > 0, "the approval-required event went through the transactional outbox", `${outbox} events`);

  // -------------------------------------------------------------------------
  section("11. Organization isolation");
  // -------------------------------------------------------------------------
  const otherOrg = await db.organization.create({
    data: { name: `Isolation Test ${stamp}`, currency: "NGN" },
  });
  const foreignVendor = await db.vendor.create({
    data: { organizationId: otherOrg.id, companyName: `Foreign Supplier ${stamp}`, status: "ACTIVE" },
  });

  const crossRead = await admin.get(`/api/vendors/${foreignVendor.id}`);
  check(
    crossRead.status === 404,
    "another organization's vendor is not readable",
    `HTTP ${crossRead.status}`
  );

  const crossWrite = await admin.patch(`/api/vendors/${foreignVendor.id}`, { companyName: "Hijacked" });
  check(crossWrite.status === 404, "another organization's vendor is not editable", `HTTP ${crossWrite.status}`);

  const crossAction = await admin.post(`/api/vendors/${foreignVendor.id}/actions`, {
    action: "BLACKLIST",
    reason: "should not be possible",
  });
  check(
    crossAction.status === 404,
    "another organization's vendor cannot be blacklisted",
    `HTTP ${crossAction.status}`
  );

  const listing = await admin.get("/api/vendors", { pageSize: "200" });
  check(
    !listing.body.items.some((v) => v.id === foreignVendor.id),
    "the directory never returns another organization's vendors"
  );

  const stillNamed = await db.vendor.findUnique({ where: { id: foreignVendor.id } });
  check(
    stillNamed.companyName === `Foreign Supplier ${stamp}` && stillNamed.status === "ACTIVE",
    "the foreign vendor is untouched"
  );

  // -------------------------------------------------------------------------
  section("12. Archive and blacklist");
  // -------------------------------------------------------------------------
  const blacklisted = await admin.post(`/api/vendors/${vendorId}/actions`, {
    action: "BLACKLIST",
    reason: "Verification run — barring this test supplier",
  });
  check(
    blacklisted.status === 200 && blacklisted.body.status === "BLACKLISTED",
    "an authorised user can blacklist a vendor"
  );
  check(blacklisted.body.isPreferred === false, "blacklisting clears the preferred flag");

  const editBarred = await admin.patch(`/api/vendors/${vendorId}`, { phone: "+234 000" });
  check(editBarred.status === 409, "a blacklisted vendor cannot be edited", `HTTP ${editBarred.status}`);

  const straightToActive = await admin.post(`/api/vendors/${vendorId}/actions`, { action: "REACTIVATE" });
  check(
    straightToActive.status === 409,
    "a blacklisted vendor cannot be returned straight to active",
    `HTTP ${straightToActive.status}`
  );

  const lifted = await admin.post(`/api/vendors/${vendorId}/actions`, {
    action: "LIFT_BLACKLIST",
    reason: "Verification run — restoring",
  });
  check(
    lifted.status === 200 && lifted.body.status === "INACTIVE",
    "lifting a blacklist lands in inactive, a second deliberate step from trading",
    lifted.body.status
  );

  // -------------------------------------------------------------------------
  section("Cleanup");
  // -------------------------------------------------------------------------
  // The product never deletes a supplier — the lifecycle ends at ARCHIVED, which
  // is why spend history, contracts and approval records stay readable. There is
  // deliberately no DELETE route to call here, so the test data is removed
  // directly. The approval instances go with it: they reference their subject
  // through a polymorphic `entityId` rather than a foreign key, so nothing
  // cascades them away, which is exactly why archiving rather than deleting is
  // the supported path.
  const testVendorIds = [vendorId, ackVendorId, rejectee.id].filter(Boolean);

  const noDeleteRoute = await admin.del(`/api/vendors/${vendorId}`);
  check(
    noDeleteRoute.status === 404 || noDeleteRoute.status === 405,
    "there is no route that deletes a vendor — archiving is the only way out",
    `HTTP ${noDeleteRoute.status}`
  );

  const instanceIds = (
    await db.approvalInstance.findMany({
      where: { entityType: "VENDOR", entityId: { in: testVendorIds } },
      select: { id: true },
    })
  ).map((i) => i.id);

  await db.vendor.deleteMany({ where: { organizationId: org.id, id: { in: testVendorIds } } });

  const [cascaded, cascadedDocs, cascadedReqs, cascadedNotes] = await Promise.all([
    db.vendorContact.count({ where: { vendorId: { in: testVendorIds } } }),
    db.vendorDocument.count({ where: { vendorId: { in: testVendorIds } } }),
    db.vendorComplianceRequirement.count({ where: { vendorId: { in: testVendorIds } } }),
    db.vendorNote.count({ where: { vendorId: { in: testVendorIds } } }),
  ]);
  check(
    cascaded === 0 && cascadedDocs === 0 && cascadedReqs === 0 && cascadedNotes === 0,
    "removing a vendor cascades its contacts, documents, requirements and notes — no orphans",
    `${cascaded} contacts, ${cascadedDocs} documents, ${cascadedReqs} requirements, ${cascadedNotes} notes`
  );

  await db.approvalStep.deleteMany({ where: { instanceId: { in: instanceIds } } });
  await db.approvalInstance.deleteMany({ where: { id: { in: instanceIds } } });
  await db.organization.delete({ where: { id: otherOrg.id } });
  ok("test vendors and the isolation organization removed");

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
