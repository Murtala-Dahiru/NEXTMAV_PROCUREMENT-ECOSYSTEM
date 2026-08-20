// NextMav Procure — UI mutation path verification.
//
// The store actions the buttons invoke are thin translators: they take the shape
// a view already produces and turn it into an API call. This drives those exact
// translated payloads over HTTP, so any mismatch between what a view sends and
// what the server accepts fails here rather than in front of a user.
//
// Run:  npm run verify:ui   (dev server must be running)

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const PASSWORD = "NextMav#2026";

let pass = 0, fail = 0;
const ok = (n, d = "") => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${n}${d ? `  \x1b[90m${d}\x1b[0m` : ""}`); };
const bad = (n, d = "") => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${n}${d ? `  \x1b[90m${d}\x1b[0m` : ""}`); };
const check = (c, n, d = "") => (c ? ok(n, d) : bad(n, d));

async function client(email) {
  const jar = new Map();
  let cookie = "";
  const req = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Supabase issues `sb-<ref>-auth-token`, chunked into `.0`/`.1` when the JWT
    // exceeds 4KB, so every cookie is kept rather than one fixed name.
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
    if (t) { try { b = JSON.parse(t); } catch { b = t; } }
    return { status: res.status, body: b };
  };
  const r = await req("POST", "/api/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(r.body)}`);
  return { get: (p) => req("GET", p), post: (p, b) => req("POST", p, b) };
}

const iso = (d = 0) => new Date(Date.now() + d * 86400_000).toISOString();

/** Approves whatever step is currently active, as the approvals view does. */
async function approveActive(who, requestId) {
  const detail = (await who.get(`/api/requests/${requestId}`)).body;
  const active = detail.approvals
    .filter((a) => a.decision === "PENDING")
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))[0];
  if (!active) return null;
  return who.post(`/api/requests/${requestId}/decide`, {
    stepId: active.id,
    decision: "APPROVED",
    comment: "",
  });
}

async function main() {
  console.log("\x1b[1mUI mutation paths — payloads exactly as the store sends them\x1b[0m\n");

  const emeka = await client("emeka.eze@apex.com");
  const chidi = await client("chidi.nwosu@apex.com");
  const fatima = await client("fatima.sani@apex.com");
  const tunde = await client("tunde.bello@apex.com");

  // request-form-view → createRequest
  const created = await emeka.post("/api/requests", {
    title: "Replacement bench vices for the fabrication shop",
    departmentId: "dep_eng",
    priority: "MEDIUM",
    category: "General",
    tags: [],
    businessJustification:
      "Two of the four bench vices have stripped threads and cannot hold stock securely, which is a hand-injury risk during grinding.",
    neededByDate: iso(21),
    lineItems: [
      { itemName: "Record No.5 bench vice", description: "", quantity: 2, unit: "units", estimatedCost: 340, taxRate: 0 },
    ],
    submit: false,
  });
  check(created.status === 200, "New Request form payload accepted", created.body?.requestNumber);
  const reqId = created.body?.id;

  // request-detail-view → submitRequest
  const submitted = await emeka.post(`/api/requests/${reqId}/submit`);
  check(submitted.status === 200 && submitted.body.status === "SUBMITTED", "Submit button drives the workflow", submitted.body?.status);

  // request-detail-view → addComment
  const commented = await emeka.post(`/api/requests/${reqId}/comments`, {
    content: "Quotes attached from two suppliers.",
    mentions: [],
  });
  check(commented.status === 200 && commented.body.comments.length === 1, "Comment box persists a comment");

  // approvals-view → approveRequest
  const decided = await approveActive(chidi, reqId);
  check(decided?.status === 200, "Approve button records a real decision", decided?.body?.status);

  // request-detail-view → cancelRequest
  const toCancel = (await emeka.post("/api/requests", {
    title: "Spare toner for the plant office printer",
    departmentId: "dep_eng", priority: "LOW", category: "General", tags: [],
    businessJustification: "Routine consumable restock for the site office printer.",
    neededByDate: iso(14),
    lineItems: [{ itemName: "HP 414A toner", description: "", quantity: 4, unit: "units", estimatedCost: 95, taxRate: 0 }],
    submit: false,
  })).body;
  const cancelled = await emeka.post(`/api/requests/${toCancel.id}/cancel`, { reason: "Cancelled by requester" });
  check(cancelled.status === 200 && cancelled.body.status === "CANCELLED", "Cancel button cancels with a reason", cancelled.body?.status);

  // finish the approval chain so sourcing can start
  await approveActive(fatima, reqId);
  await approveActive(tunde, reqId);

  // rfq-form-view → createRFQ (no line items in the view payload)
  const rfq = await tunde.post("/api/rfqs", {
    title: "Bench vices",
    description: "Quote required.",
    deadline: iso(10),
    invitedVendorIds: ["vnd_powergen", "vnd_techcore"],
    requestId: reqId,
  });
  check(rfq.status === 200, "New RFQ form payload accepted without re-keying line items", rfq.body?.rfqNumber);
  check(
    rfq.body?.lineItems?.length === 1 && /bench vice/i.test(rfq.body.lineItems[0].itemName),
    "RFQ inherited its lines from the approved request",
    rfq.body?.lineItems?.[0]?.itemName
  );

  // rfq-detail-view → selectQuotation
  await tunde.post(`/api/rfqs/${rfq.body.id}/quotations`, {
    vendorId: "vnd_powergen",
    deliveryDays: 5, warranty: "12 months", paymentTerms: "Net 30", validUntil: iso(30), notes: "",
    lineItems: [{ itemName: "Record No.5 bench vice", quantity: 2, unit: "units", unitPrice: 330, taxRate: 0 }],
  });
  const rfqFull = (await tunde.get(`/api/rfqs/${rfq.body.id}`)).body;
  const awarded = await tunde.post(`/api/rfqs/${rfq.body.id}/award`, {
    quotationId: rfqFull.quotations[0].id,
    justification: "",
  });
  check(awarded.status === 200 && awarded.body.status === "CLOSED", "Select-quotation button awards the RFQ", awarded.body?.status);

  // rfq-detail-view → generatePO
  const po = await tunde.post("/api/purchase-orders", {
    vendorId: "vnd_powergen",
    requestId: reqId,
    rfqId: rfq.body.id,
    quotationId: rfqFull.quotations[0].id,
    expectedDelivery: iso(5),
    taxRate: 0, discountAmount: 0,
    notes: "Auto-generated from RFQ.",
    lineItems: [
      { itemName: "Record No.5 bench vice", description: "", quantity: 2, unit: "units", unitPrice: 330, taxRate: 0, createsAsset: false },
    ],
    issue: true,
  });
  check(po.status === 200 && po.body.status === "ISSUED", "Generate PO button issues a real order", po.body?.poNumber);

  // goods-receipts-view → createGoodsReceipt
  const poFull = (await tunde.get(`/api/purchase-orders/${po.body.id}`)).body;
  const receipt = await tunde.post("/api/goods-receipts", {
    purchaseOrderId: po.body.id,
    items: [{ poLineItemId: poFull.lineItems[0].id, receivedQty: 2, rejectedQty: 0, condition: "GOOD" }],
    post: true,
  });
  check(receipt.status === 200, "Receive-goods form posts a receipt", receipt.body?.receiptNumber);

  // invoices-view → createInvoice (no line items in the view payload)
  const invoice = await fatima.post("/api/invoices", {
    vendorId: "vnd_powergen",
    purchaseOrderId: po.body.id,
    issueDate: iso(0),
    dueDate: iso(30),
    notes: "",
    submit: true,
  });
  check(invoice.status === 200, "New Invoice form accepted without re-keying line items", invoice.body?.invoiceNumber);
  check(
    invoice.body?.lineItems?.length === 1 && Math.abs(invoice.body.totalAmount - 660) < 0.01,
    "invoice lines defaulted to the received-but-uninvoiced quantity",
    `${invoice.body?.lineItems?.length} line, total ${invoice.body?.totalAmount}`
  );
  check(invoice.body?.match?.status === "MATCHED", "defaulted invoice matches cleanly 3-way", invoice.body?.match?.status);

  // invoices-view → approveInvoice
  const approvedInv = await fatima.post(`/api/invoices/${invoice.body.id}/approve`, {});
  check(approvedInv.status === 200 && approvedInv.body.status === "APPROVED", "Approve invoice button approves", approvedInv.body?.status);

  // invoices-view → createPayment
  const payment = await fatima.post("/api/payments", {
    invoiceId: invoice.body.id,
    amount: invoice.body.totalAmount,
    method: "BANK_TRANSFER",
    scheduledFor: iso(1),
    reference: "TRF-UI-001",
  });
  check(payment.status === 200 && payment.body.status === "PENDING_APPROVAL", "Record payment button raises a payment for approval", payment.body?.status);

  // persistence — a brand-new session must see all of it
  const fresh = await client("amina.okafor@apex.com");
  const boot = (await fresh.get("/api/bootstrap")).body;
  check(
    boot.requests.some((r) => r.id === reqId),
    "the request created above is present in a brand-new session",
    `${boot.requests.length} requests loaded from the database`
  );
  check(
    boot.purchaseOrders.some((p) => p.id === po.body.id) &&
      boot.invoices.some((i) => i.id === invoice.body.id) &&
      boot.payments.some((p) => p.id === payment.body.id),
    "PO, invoice and payment all persisted and reload"
  );
  check(boot.requests.find((r) => r.id === reqId)?.comments?.length === 1, "the comment persisted too");

  console.log(`\n${"─".repeat(64)}\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("\x1b[31mHarness error:\x1b[0m", e);
  process.exit(1);
});
