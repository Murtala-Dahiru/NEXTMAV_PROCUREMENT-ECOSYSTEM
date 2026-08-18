// NextMav Procure — end-to-end journey verification.
//
// Drives the real HTTP API exactly as the browser does: real sessions, real
// permission checks, real database writes. Nothing is stubbed.
//
// Covers the journeys the mandate requires (§31):
//   A  Request → Approval → RFQ → Quotation → Compare → Award → PO
//   B  PO → Receiving → Inventory + Assets
//   C  PO → Receiving → Invoice → 3-way match → Approval → Payment
//   D  Budget → Reserved → Committed → Spent → Paid
//   E  Controls: wrong approver, separation of duties, overpayment, over-receipt
//
// Run:  npm run verify:journeys      (dev server must be running)

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = "NextMav#2026";

let pass = 0, fail = 0;
const failures = [];

function ok(name, detail = "") {
  pass++;
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}
function bad(name, detail = "") {
  fail++;
  failures.push(`${name} — ${detail}`);
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}
function check(cond, name, detail = "") {
  cond ? ok(name, detail) : bad(name, detail);
  return cond;
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** A logged-in API client holding its own cookie jar, one per persona. */
class Client {
  constructor(label) {
    this.label = label;
    this.cookie = "";
  }

  async request(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(";");
      if (pair.startsWith("nextmav.sid=")) this.cookie = pair;
    }

    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    return { status: res.status, body: payload };
  }

  get(p) { return this.request("GET", p); }
  post(p, b) { return this.request("POST", p, b); }
  patch(p, b) { return this.request("PATCH", p, b); }

  async login(email) {
    const r = await this.post("/api/auth/login", { email, password: PASSWORD });
    if (r.status !== 200) throw new Error(`${this.label} login failed: ${JSON.stringify(r.body)}`);
    this.user = r.body.user;
    return this;
  }
}

const iso = (daysFromNow = 0) => new Date(Date.now() + daysFromNow * 86400_000).toISOString();
const money = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function budgetSnapshot(departmentId) {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  const b = await db.budget.findFirst({
    where: { departmentId, fiscalYear: new Date().getFullYear() },
  });
  await db.$disconnect();
  return b;
}

async function main() {
  console.log(`\x1b[1mNextMav Procure — end-to-end journey verification\x1b[0m`);
  console.log(`\x1b[90m${BASE}\x1b[0m`);

  // -------------------------------------------------------------------------
  section("Sign in as each persona");
  // -------------------------------------------------------------------------
  const emeka = await new Client("emeka").login("emeka.eze@apex.com");        // EMPLOYEE, Engineering
  const chidi = await new Client("chidi").login("chidi.nwosu@apex.com");      // DEPT MANAGER, Engineering
  const fatima = await new Client("fatima").login("fatima.sani@apex.com");    // FINANCE OFFICER
  const tunde = await new Client("tunde").login("tunde.bello@apex.com");      // PROCUREMENT MANAGER
  const amina = await new Client("amina").login("amina.okafor@apex.com");     // SUPER ADMIN
  const grace = await new Client("grace").login("grace.adeyemi@apex.com");    // DEPT MANAGER, IT
  ok("six personas authenticated", "employee, dept mgr ×2, finance, procurement, admin");

  const budget0 = await budgetSnapshot("dep_eng");

  // =========================================================================
  section("JOURNEY A — Request → Approval → RFQ → Quotation → Award → PO");
  // =========================================================================

  const created = await emeka.post("/api/requests", {
    title: "Site survey drones for Q4 inspections",
    departmentId: "dep_eng",
    priority: "HIGH",
    category: "IT Equipment",
    tags: ["engineering", "survey"],
    businessJustification:
      "Manual tower inspections take three days each and require scaffolding. Drone survey reduces this to four hours with better data capture and removes the working-at-height risk.",
    neededByDate: iso(30),
    lineItems: [
      { itemName: "Survey drone with thermal payload", description: "RTK GPS, 45min flight time", quantity: 2, unit: "units", estimatedCost: 4200, taxRate: 0 },
      { itemName: "Spare battery pack", description: "", quantity: 6, unit: "units", estimatedCost: 180, taxRate: 0 },
    ],
    submit: false,
  });
  const request = created.body;
  check(created.status === 200 && request?.requestNumber, "employee creates a draft request", request?.requestNumber);
  check(request?.totalEstimated === 2 * 4200 + 6 * 180, "server computes the total, not the client", `${money(request?.totalEstimated)} expected ${money(9480)}`);
  check(request?.status === "DRAFT", "new request starts as DRAFT");

  const submitted = await emeka.post(`/api/requests/${request.id}/submit`);
  check(submitted.status === 200, "request submits into the workflow");
  const chain = submitted.body?.approvals ?? [];
  check(chain.length === 3, "workflow engine built a 3-stage chain", chain.map((a) => a.approverRole).join(" → "));
  check(
    chain[0]?.approverId === "usr_chidi",
    "stage 1 routed to the requesting department's own manager",
    `got ${chain[0]?.approverId}`
  );

  // --- control: the wrong person cannot approve
  const wrongApprover = await grace.post(`/api/requests/${request.id}/decide`, {
    stepId: chain[0].id, decision: "APPROVED", comment: "trying to approve someone else's stage",
  });
  check(wrongApprover.status === 409, "a different department manager cannot approve this step", `HTTP ${wrongApprover.status}: ${wrongApprover.body?.error?.message ?? ""}`);

  // --- control: cannot skip ahead to a later stage
  const skipAhead = await fatima.post(`/api/requests/${request.id}/decide`, {
    stepId: chain[1].id, decision: "APPROVED", comment: "jumping the queue",
  });
  check(skipAhead.status === 409, "finance cannot approve stage 2 while stage 1 is outstanding", `HTTP ${skipAhead.status}`);

  // --- the real chain
  const d1 = await chidi.post(`/api/requests/${request.id}/decide`, { stepId: chain[0].id, decision: "APPROVED", comment: "Justified — approved for sourcing." });
  check(d1.status === 200 && d1.body?.status === "UNDER_REVIEW", "stage 1 approval moves the request to UNDER_REVIEW", d1.body?.status);

  const d2 = await fatima.post(`/api/requests/${request.id}/decide`, { stepId: chain[1].id, decision: "APPROVED", comment: "Within budget." });
  check(d2.status === 200 && d2.body?.status === "UNDER_REVIEW", "stage 2 approval keeps it in review", d2.body?.status);

  const d3 = await tunde.post(`/api/requests/${request.id}/decide`, { stepId: chain[2].id, decision: "APPROVED", comment: "Sourcing to begin." });
  check(d3.status === 200 && d3.body?.status === "APPROVED", "final stage approval marks the request APPROVED", d3.body?.status);

  const budgetAfterApproval = await budgetSnapshot("dep_eng");
  check(
    budgetAfterApproval.reservedAmount > budget0.reservedAmount,
    "approval RESERVED budget against the department",
    `reserved ${money(budget0.reservedAmount)} → ${money(budgetAfterApproval.reservedAmount)}`
  );

  // --- sourcing
  const rfqRes = await tunde.post("/api/rfqs", {
    title: "Survey drones and spare batteries",
    description: "Quote required per attached specification. Delivery to Port Harcourt Plant.",
    deadline: iso(14),
    requestId: request.id,
    invitedVendorIds: ["vnd_techcore", "vnd_globalequip", "vnd_officedirect"],
    lineItems: [
      { itemName: "Survey drone with thermal payload", description: "RTK GPS", quantity: 2, unit: "units" },
      { itemName: "Spare battery pack", description: "", quantity: 6, unit: "units" },
    ],
  });
  const rfq = rfqRes.body;
  check(rfqRes.status === 200 && rfq?.rfqNumber, "procurement issues an RFQ to three suppliers", rfq?.rfqNumber);
  check(rfq?.invitedVendors?.length === 3, "three supplier invitations recorded");

  const bids = [
    { vendorId: "vnd_techcore", deliveryDays: 10, drone: 4100, battery: 175 },
    { vendorId: "vnd_globalequip", deliveryDays: 21, drone: 3950, battery: 190 },
    { vendorId: "vnd_officedirect", deliveryDays: 7, drone: 4450, battery: 170 },
  ];
  for (const bid of bids) {
    const r = await tunde.post(`/api/rfqs/${rfq.id}/quotations`, {
      vendorId: bid.vendorId,
      deliveryDays: bid.deliveryDays,
      warranty: "12 months",
      paymentTerms: "Net 30",
      validUntil: iso(45),
      notes: "",
      lineItems: [
        { itemName: "Survey drone with thermal payload", quantity: 2, unit: "units", unitPrice: bid.drone, taxRate: 0 },
        { itemName: "Spare battery pack", quantity: 6, unit: "units", unitPrice: bid.battery, taxRate: 0 },
      ],
    });
    if (r.status !== 200) bad(`quotation from ${bid.vendorId}`, JSON.stringify(r.body));
  }
  ok("three quotations captured against the RFQ");

  const rfqDetail = (await tunde.get(`/api/rfqs/${rfq.id}`)).body;
  const cmp = rfqDetail?.comparison;
  check(cmp?.rows?.length === 3, "comparison matrix built for all three bids");
  check(
    typeof cmp?.potentialSaving === "number" && cmp.potentialSaving > 0,
    "comparison surfaces the spread between highest and lowest",
    `lowest ${money(cmp?.lowestAmount)}, highest ${money(cmp?.highestAmount)}, spread ${money(cmp?.potentialSaving)}`
  );
  const lowestRow = cmp.rows.find((r) => r.isLowest);
  check(lowestRow?.vendorId === "vnd_globalequip", "lowest bid identified correctly", `${lowestRow?.vendorName} at ${money(lowestRow?.totalAmount)}`);
  check(
    cmp.rows.every((r) => typeof r.compositeScore === "number"),
    "each bid scored on price, delivery and supplier performance",
    cmp.rows.map((r) => `${r.vendorName.split(" ")[0]}=${r.compositeScore}`).join(" ")
  );
  check(cmp.lineComparison?.length === 2, "per-line best-price analysis produced");

  const award = await tunde.post(`/api/rfqs/${rfq.id}/award`, {
    quotationId: lowestRow.quotationId,
    justification: "Lowest total cost; delivery acceptable against the needed-by date.",
  });
  check(award.status === 200 && award.body?.status === "CLOSED", "RFQ awarded and closed", award.body?.status);
  check(
    award.body?.quotations?.filter((q) => q.status === "REJECTED").length === 2,
    "losing bids marked rejected"
  );

  const poRes = await tunde.post(`/api/rfqs/${rfq.id}/create-po`, { issue: true });
  const poA = poRes.body;
  check(poRes.status === 200 && poA?.poNumber, "purchase order raised from the awarded quotation", poA?.poNumber);
  check(poA?.status === "ISSUED", "PO issued", poA?.status);
  check(poA?.requestId === request.id, "PO linked back to the originating request");
  check(poA?.rfqId === rfq.id, "PO linked back to the RFQ");

  const requestAfterPo = (await tunde.get(`/api/requests/${request.id}`)).body;
  check(
    requestAfterPo?.status === "APPROVED",
    "request is NOT closed merely because a PO was issued",
    `status ${requestAfterPo?.status} (the old build marked this COMPLETED)`
  );

  const budgetAfterPo = await budgetSnapshot("dep_eng");
  check(
    budgetAfterPo.committedAmount > budgetAfterApproval.committedAmount,
    "PO issue COMMITTED budget",
    `committed ${money(budgetAfterApproval.committedAmount)} → ${money(budgetAfterPo.committedAmount)}`
  );
  check(
    budgetAfterPo.reservedAmount < budgetAfterApproval.reservedAmount,
    "the request's reservation was released so money is not double-counted",
    `reserved ${money(budgetAfterApproval.reservedAmount)} → ${money(budgetAfterPo.reservedAmount)}`
  );

  // =========================================================================
  section("JOURNEY B — PO → Receiving → Inventory + Assets");
  // =========================================================================

  const poB = (await tunde.post("/api/purchase-orders", {
    vendorId: "vnd_safetync",
    expectedDelivery: iso(7),
    taxRate: 7.5,
    discountAmount: 0,
    notes: "Restock plus two tracked laptops.",
    lineItems: [
      { itemName: "Safety Helmet", quantity: 20, unit: "units", unitPrice: 35, taxRate: 0, createsAsset: false, inventoryItemId: "inv_item_001" },
      { itemName: "Field Laptop", quantity: 2, unit: "units", unitPrice: 1800, taxRate: 0, createsAsset: true, assetCategory: "IT_EQUIPMENT" },
    ],
    issue: true,
  })).body;
  check(poB?.poNumber && poB.status === "ISSUED", "direct PO issued with inventory and asset lines", poB?.poNumber);

  const helmetLine = poB.lineItems.find((l) => l.itemName === "Safety Helmet");
  const laptopLine = poB.lineItems.find((l) => l.itemName === "Field Laptop");

  // --- control: cannot receive more than ordered
  const overReceive = await tunde.post("/api/goods-receipts", {
    purchaseOrderId: poB.id,
    items: [{ poLineItemId: helmetLine.id, receivedQty: 25, rejectedQty: 0, condition: "GOOD" }],
    post: true,
  });
  check(overReceive.status === 422, "receiving more than ordered is rejected", `HTTP ${overReceive.status}: ${overReceive.body?.error?.message?.slice(0, 80) ?? ""}`);

  const invBefore = (await budgetSnapshotInventory("inv_item_001")).quantity;

  // --- partial receipt
  const partial = await tunde.post("/api/goods-receipts", {
    purchaseOrderId: poB.id,
    location: "Port Harcourt Plant — Store A",
    deliveryNoteRef: "DN-88213",
    items: [
      { poLineItemId: helmetLine.id, receivedQty: 12, rejectedQty: 0, condition: "GOOD" },
      { poLineItemId: laptopLine.id, receivedQty: 0, rejectedQty: 0, condition: "GOOD" },
    ],
    post: true,
  });
  check(partial.status === 200, "partial receipt posted", partial.body?.receiptNumber);

  let poBState = (await tunde.get(`/api/purchase-orders/${poB.id}`)).body;
  check(poBState?.status === "PARTIALLY_RECEIVED", "PO status derived as PARTIALLY_RECEIVED", poBState?.status);

  const invAfterPartial = (await budgetSnapshotInventory("inv_item_001")).quantity;
  check(
    invAfterPartial === invBefore + 12,
    "receipt posted a stock movement into inventory",
    `qty ${invBefore} → ${invAfterPartial}`
  );

  const helmetState = poBState.lineItems.find((l) => l.itemName === "Safety Helmet");
  check(helmetState.orderedQty === 20 && helmetState.receivedQty === 12, "ordered ≠ received is true of the data", `ordered ${helmetState.orderedQty}, received ${helmetState.receivedQty}`);

  const outstanding = (await tunde.get(`/api/purchase-orders/${poB.id}/outstanding`)).body;
  const helmetOutstanding = outstanding.lines.find((l) => l.itemName === "Safety Helmet");
  check(helmetOutstanding.outstandingQty === 8, "receiving worksheet shows the true outstanding balance", `${helmetOutstanding.outstandingQty} remaining`);

  // --- second receipt completing the order, with a rejection
  const second = await tunde.post("/api/goods-receipts", {
    purchaseOrderId: poB.id,
    location: "Port Harcourt Plant — Store A",
    items: [
      { poLineItemId: helmetLine.id, receivedQty: 6, rejectedQty: 2, condition: "DAMAGED", notes: "Two helmets cracked in transit." },
      { poLineItemId: laptopLine.id, receivedQty: 2, rejectedQty: 0, condition: "GOOD" },
    ],
    post: true,
  });
  check(second.status === 200, "second receipt posted with a rejection recorded", second.body?.receiptNumber);

  poBState = (await tunde.get(`/api/purchase-orders/${poB.id}`)).body;
  check(poBState?.status === "RECEIVED", "PO status derived as RECEIVED once every line settles", poBState?.status);

  const assets = await assetsForPo(poB.id);
  check(assets.length === 2, "goods receipt created one tracked asset per physical unit", assets.map((a) => a.assetTag).join(", "));
  check(
    assets.every((a) => a.purchaseOrderId === poB.id && a.goodsReceiptId && a.vendorId === "vnd_safetync"),
    "each asset traces back to its PO, receipt and vendor"
  );
  check(assets.every((a) => a.purchaseValue === 1800), "asset carries the purchase value from the PO line");

  const invFinal = (await budgetSnapshotInventory("inv_item_001")).quantity;
  check(
    invFinal === invBefore + 18,
    "damaged units did NOT enter stock",
    `qty ${invBefore} → ${invFinal} (18 good of 20 ordered; 2 rejected)`
  );

  // =========================================================================
  section("JOURNEY C — Receiving → Invoice → 3-way match → Approval → Payment");
  // =========================================================================

  const poBFull = (await tunde.get(`/api/purchase-orders/${poB.id}`)).body;
  const hLine = poBFull.lineItems.find((l) => l.itemName === "Safety Helmet");
  const lLine = poBFull.lineItems.find((l) => l.itemName === "Field Laptop");

  // --- an invoice that overbills should be caught by the match
  const badInvoice = (await fatima.post("/api/invoices", {
    vendorId: "vnd_safetync",
    vendorInvoiceRef: "SNC-OVER-1",
    purchaseOrderId: poB.id,
    issueDate: iso(0),
    dueDate: iso(30),
    lineItems: [
      { poLineItemId: hLine.id, itemName: "Safety Helmet", quantity: 20, unit: "units", unitPrice: 35, taxRate: 0 },
    ],
    submit: true,
  })).body;
  check(
    badInvoice?.match?.status === "QUANTITY_VARIANCE",
    "3-way match flags an invoice billing more than was received",
    `invoiced 20, received 18 → ${badInvoice?.match?.status}`
  );
  check(badInvoice?.match?.type === "THREE_WAY", "match ran as 3-way because receipts exist", badInvoice?.match?.type);

  // --- a price variance
  const priceVar = (await fatima.post("/api/invoices", {
    vendorId: "vnd_safetync",
    vendorInvoiceRef: "SNC-PRICE-1",
    purchaseOrderId: poB.id,
    issueDate: iso(0),
    dueDate: iso(30),
    lineItems: [
      { poLineItemId: lLine.id, itemName: "Field Laptop", quantity: 2, unit: "units", unitPrice: 2100, taxRate: 0 },
    ],
    submit: true,
  })).body;
  check(
    priceVar?.match?.status === "PRICE_VARIANCE",
    "match flags a unit price above the ordered price",
    `ordered 1800, invoiced 2100 → variance ${money(priceVar?.match?.variance)}`
  );

  // --- duplicate detection
  const dup = await fatima.post("/api/invoices", {
    vendorId: "vnd_safetync",
    vendorInvoiceRef: "SNC-PRICE-1",
    purchaseOrderId: poB.id,
    issueDate: iso(0),
    dueDate: iso(30),
    lineItems: [{ itemName: "Field Laptop", quantity: 2, unit: "units", unitPrice: 2100, taxRate: 0 }],
    submit: true,
  });
  check(dup.status === 409, "duplicate vendor invoice reference is blocked", dup.body?.error?.message?.slice(0, 90));

  // --- the clean invoice against Journey A's PO
  const poAFull = (await tunde.get(`/api/purchase-orders/${poA.id}`)).body;
  const droneLine = poAFull.lineItems.find((l) => l.itemName.startsWith("Survey drone"));
  const battLine = poAFull.lineItems.find((l) => l.itemName.startsWith("Spare battery"));

  await tunde.post("/api/goods-receipts", {
    purchaseOrderId: poA.id,
    items: [
      { poLineItemId: droneLine.id, receivedQty: droneLine.orderedQty, rejectedQty: 0, condition: "GOOD" },
      { poLineItemId: battLine.id, receivedQty: battLine.orderedQty, rejectedQty: 0, condition: "GOOD" },
    ],
    post: true,
  });

  const cleanInvoice = (await fatima.post("/api/invoices", {
    vendorId: poAFull.vendorId,
    vendorInvoiceRef: "GEQ-2026-5512",
    purchaseOrderId: poA.id,
    issueDate: iso(0),
    dueDate: iso(30),
    lineItems: [
      { poLineItemId: droneLine.id, itemName: droneLine.itemName, quantity: droneLine.orderedQty, unit: droneLine.unit, unitPrice: droneLine.unitPrice, taxRate: 0 },
      { poLineItemId: battLine.id, itemName: battLine.itemName, quantity: battLine.orderedQty, unit: battLine.unit, unitPrice: battLine.unitPrice, taxRate: 0 },
    ],
    submit: true,
  })).body;
  check(cleanInvoice?.match?.status === "MATCHED", "clean 3-way match on a correct invoice", `${cleanInvoice?.invoiceNumber} ${cleanInvoice?.match?.status}`);

  // --- control: cannot pay an unapproved invoice
  const earlyPay = await fatima.post("/api/payments", { invoiceId: cleanInvoice.id, amount: 100, method: "BANK_TRANSFER" });
  check(earlyPay.status === 409, "payment against an unapproved invoice is blocked", earlyPay.body?.error?.message?.slice(0, 80));

  // --- control: an employee cannot approve an invoice
  const employeeApprove = await emeka.post(`/api/invoices/${cleanInvoice.id}/approve`, {});
  check(employeeApprove.status === 403, "an employee cannot approve an invoice", `HTTP ${employeeApprove.status}`);

  const approvedInvoice = (await fatima.post(`/api/invoices/${cleanInvoice.id}/approve`, {})).body;
  check(approvedInvoice?.status === "APPROVED", "finance approves the invoice", approvedInvoice?.status);

  const poAAfterInvoice = (await tunde.get(`/api/purchase-orders/${poA.id}`)).body;
  const droneAfter = poAAfterInvoice.lineItems.find((l) => l.itemName.startsWith("Survey drone"));
  check(
    droneAfter.invoicedQty === droneAfter.orderedQty,
    "invoice approval advanced invoicedQty — the fourth quantity is real",
    `ordered ${droneAfter.orderedQty} / received ${droneAfter.receivedQty} / invoiced ${droneAfter.invoicedQty}`
  );

  const budgetAfterInvoice = await budgetSnapshot("dep_eng");
  check(
    budgetAfterInvoice.spentAmount > budgetAfterPo.spentAmount,
    "invoice approval turned commitment into ACTUAL SPEND",
    `spent ${money(budgetAfterPo.spentAmount)} → ${money(budgetAfterInvoice.spentAmount)}`
  );

  // --- control: overpayment
  const overpay = await fatima.post("/api/payments", {
    invoiceId: cleanInvoice.id,
    amount: cleanInvoice.totalAmount + 5000,
    method: "BANK_TRANSFER",
  });
  check(overpay.status === 422, "overpaying an invoice is blocked", overpay.body?.error?.message?.slice(0, 90));

  // --- partial payment
  const half = Math.round(cleanInvoice.totalAmount / 2);
  const pay1 = (await fatima.post("/api/payments", { invoiceId: cleanInvoice.id, amount: half, method: "BANK_TRANSFER", reference: "TRF-A-001" })).body;
  check(pay1?.status === "PENDING_APPROVAL", "a new payment enters the finance approval gate", pay1?.status);

  // --- control: separation of duties
  const selfApprove = await fatima.post(`/api/payments/${pay1.id}/approve`);
  check(
    selfApprove.status === 403,
    "the person who raised a payment cannot approve it (separation of duties)",
    selfApprove.body?.error?.message?.slice(0, 90)
  );

  const approved1 = (await amina.post(`/api/payments/${pay1.id}/approve`)).body;
  check(approved1?.status === "SCHEDULED", "a second officer approves the payment", approved1?.status);

  const processing1 = (await amina.post(`/api/payments/${pay1.id}/process`)).body;
  check(processing1?.status === "PROCESSING", "payment moves into processing", processing1?.status);

  const settled1 = (await amina.post(`/api/payments/${pay1.id}/settle`, { outcome: "COMPLETED", reference: "TRF-A-001", paymentDate: iso(0) })).body;
  check(settled1?.status === "COMPLETED", "payment settled as completed", settled1?.status);

  let invState = (await fatima.get(`/api/invoices/${cleanInvoice.id}`)).body;
  check(invState?.status === "PARTIALLY_PAID", "invoice reflects a partial payment", `${money(invState?.paidAmount)} of ${money(invState?.totalAmount)}, balance ${money(invState?.balance)}`);

  // --- second payment, including a failure and retry
  const rest = invState.balance;
  const pay2 = (await fatima.post("/api/payments", { invoiceId: cleanInvoice.id, amount: rest, method: "BANK_TRANSFER", reference: "TRF-A-002" })).body;
  await amina.post(`/api/payments/${pay2.id}/approve`);
  await amina.post(`/api/payments/${pay2.id}/process`);
  const failed = (await amina.post(`/api/payments/${pay2.id}/settle`, { outcome: "FAILED", failureReason: "Beneficiary account details rejected by the bank." })).body;
  check(failed?.status === "FAILED", "a failed payment is recorded as failed", failed?.status);

  invState = (await fatima.get(`/api/invoices/${cleanInvoice.id}`)).body;
  check(
    invState?.balance === rest,
    "a failed payment does NOT reduce the outstanding balance",
    `balance still ${money(invState?.balance)}`
  );

  const pay3 = (await fatima.post("/api/payments", { invoiceId: cleanInvoice.id, amount: rest, method: "BANK_TRANSFER", reference: "TRF-A-003" })).body;
  await amina.post(`/api/payments/${pay3.id}/approve`);
  await amina.post(`/api/payments/${pay3.id}/process`);
  await amina.post(`/api/payments/${pay3.id}/settle`, { outcome: "COMPLETED", reference: "TRF-A-003", paymentDate: iso(0) });

  invState = (await fatima.get(`/api/invoices/${cleanInvoice.id}`)).body;
  check(invState?.status === "PAID" && invState?.balance === 0, "retry settles the invoice in full", `${invState?.status}, balance ${money(invState?.balance)}`);

  const finalRequest = (await tunde.get(`/api/requests/${request.id}`)).body;
  check(
    finalRequest?.status === "COMPLETED",
    "request completes only once goods are received AND the invoice is paid",
    finalRequest?.status
  );

  // =========================================================================
  section("JOURNEY D — Budget chain: allocated → reserved → committed → spent");
  // =========================================================================

  const budgetFinal = await budgetSnapshot("dep_eng");
  const ledger = await budgetLedger(budgetFinal.id);
  check(ledger.length > 0, "every budget movement wrote an append-only ledger entry", `${ledger.length} entries`);
  const kinds = [...new Set(ledger.map((e) => e.type))];
  check(
    kinds.includes("RESERVED") && kinds.includes("RELEASED") && kinds.includes("COMMITTED") && kinds.includes("SPENT"),
    "the full chain is represented in the ledger",
    kinds.join(", ")
  );
  const recomputed = ledger.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + e.amount;
    return acc;
  }, {});
  check(
    Math.abs((recomputed.SPENT ?? 0) - budgetFinal.spentAmount) < 0.01,
    "budget rollups reconcile against the ledger",
    `ledger SPENT ${money(recomputed.SPENT ?? 0)} vs budget.spentAmount ${money(budgetFinal.spentAmount)}`
  );
  console.log(
    `        \x1b[90mallocated ${money(budgetFinal.totalAmount)} · reserved ${money(budgetFinal.reservedAmount)} · committed ${money(budgetFinal.committedAmount)} · spent ${money(budgetFinal.spentAmount)} · remaining ${money(budgetFinal.remainingAmount)}\x1b[0m`
  );

  // =========================================================================
  section("JOURNEY E — Vendor performance derived from real delivery history");
  // =========================================================================

  const vendor = await vendorById("vnd_safetync");
  check(
    vendor.performanceUpdatedAt !== null,
    "supplier performance recomputed after receipts",
    `on-time ${vendor.onTimeDeliveryRate.toFixed(1)}%, quality ${vendor.qualityRating}/5`
  );
  check(
    vendor.qualityRating < 5,
    "the two rejected helmets pulled the quality rating below perfect",
    `quality ${vendor.qualityRating}/5 from real rejection data, not Math.random()`
  );

  // =========================================================================
  section("Audit trail");
  // =========================================================================

  const audits = await auditsFor(request.id);
  check(audits.length >= 3, "request lifecycle is fully audited", `${audits.length} entries: ${audits.map((a) => a.action).join(", ")}`);
  check(
    audits.every((a) => a.userId && a.ipAddress),
    "every audit entry records who and from where"
  );
  const approvalAudit = audits.find((a) => a.action === "request.approved");
  check(!!approvalAudit?.before && !!approvalAudit?.after, "state transitions capture before and after");

  // -------------------------------------------------------------------------
  console.log(`\n${"─".repeat(72)}`);
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

// --- direct database readers used only to assert side effects -------------
async function withDb(fn) {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: ["error"] });
  try { return await fn(db); } finally { await db.$disconnect(); }
}
const budgetSnapshotInventory = (id) => withDb((db) => db.inventoryItem.findUnique({ where: { id } }));
const assetsForPo = (poId) => withDb((db) => db.asset.findMany({ where: { purchaseOrderId: poId } }));
const budgetLedger = (budgetId) => withDb((db) => db.budgetEntry.findMany({ where: { budgetId } }));
const vendorById = (id) => withDb((db) => db.vendor.findUnique({ where: { id } }));
const auditsFor = (resourceId) =>
  withDb((db) => db.auditLogEntry.findMany({ where: { resourceId }, orderBy: { createdAt: "asc" } }));

main().catch((e) => {
  console.error("\n\x1b[31mHarness error:\x1b[0m", e);
  process.exit(1);
});
