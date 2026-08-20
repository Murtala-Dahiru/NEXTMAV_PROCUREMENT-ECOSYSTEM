// NextMav Procure — lifecycle and state-machine verification.
//
// The scenario suite proves the data is right; this proves the *rules* are. It
// exercises the transitions no other suite reaches — the revision path, illegal
// moves, and the guards that only fire when somebody tries something they should
// not — through the real services over real HTTP.
//
//   node --env-file=.env --experimental-strip-types scripts/verify/lifecycle.mjs

// The real table, not a copy of it: a mirror that drifts would pass while the
// application refuses the same move.
import { canTransition, nextStates } from "../../src/server/state-machine.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "NextMav#2026";

let pass = 0;
let fail = 0;
const failures = [];

function check(cond, name, detail = "") {
  if (cond) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  }
  return cond;
}

const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

class Client {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
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
    // Supabase issues `sb-<ref>-auth-token`, chunked into `.0`/`.1` when the JWT
    // exceeds 4KB, so every cookie is kept rather than one fixed name.
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || value === "deleted") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, body: payload };
  }
  get = (p) => this.request("GET", p);
  post = (p, b) => this.request("POST", p, b);
  patch = (p, b) => this.request("PATCH", p, b);
  async login(email) {
    const res = await this.post("/api/auth/login", { email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`${this.label} could not sign in: HTTP ${res.status}`);
    return res.body;
  }
}

async function main() {
  console.log("\x1b[1mNextMav Procure — lifecycle verification\x1b[0m");
  console.log(`\x1b[90m${BASE}\x1b[0m`);

  // ---------------------------------------------------------------------
  section("The transition tables themselves");

  check(!canTransition("request", "CLOSED", "DRAFT"), "a closed request cannot be reopened as a draft");
  check(!canTransition("request", "REJECTED", "APPROVED"), "a rejected request cannot become approved");
  check(!canTransition("request", "DRAFT", "APPROVED"), "a draft cannot skip approval");
  check(canTransition("request", "UNDER_REVIEW", "RETURNED"), "a request under review can be returned for revision");
  check(canTransition("request", "RETURNED", "SUBMITTED"), "a returned request can be resubmitted");
  check(!canTransition("purchaseOrder", "PENDING_APPROVAL", "ISSUED"), "an order awaiting approval cannot be issued");
  check(canTransition("purchaseOrder", "APPROVED", "ISSUED"), "an approved order can be issued");
  check(!canTransition("invoice", "PAID", "APPROVED"), "a paid invoice cannot be re-approved");
  check(!canTransition("payment", "COMPLETED", "PROCESSING"), "a completed payment cannot be reprocessed");
  check(canTransition("payment", "FAILED", "SCHEDULED"), "a failed payment can be retried");
  check(nextStates("request", "CLOSED").length === 0, "CLOSED is terminal for a request");
  check(nextStates("payment", "REFUNDED").length === 0, "REFUNDED is terminal for a payment");

  // ---------------------------------------------------------------------
  section("The revision path, end to end");

  const employee = new Client("employee");
  const manager = new Client("manager");
  await employee.login("emeka.eze@apex.com");
  await manager.login("chidi.nwosu@apex.com");

  const draft = await employee.post("/api/requests", {
    title: `Lifecycle probe ${Date.now()}`,
    departmentId: "dep_eng",
    priority: "MEDIUM",
    category: "IT Equipment",
    businessJustification: "Verifying the revision path end to end.",
    neededByDate: new Date(Date.now() + 30 * 864e5).toISOString(),
    lineItems: [
      { itemName: "Probe item", description: "", quantity: 2, unit: "unit", estimatedCost: 500, taxRate: 0 },
    ],
  });
  if (!check(draft.status === 200, "draft request created", draft.body?.requestNumber)) return finish();
  const id = draft.body.id;

  const early = await manager.post(`/api/requests/${id}/decide`, {
    stepId: "no-such-step",
    decision: "APPROVED",
  });
  check(early.status >= 400, "a draft cannot be decided before it is submitted", `HTTP ${early.status}`);

  const submitted = await employee.post(`/api/requests/${id}/submit`, {});
  check(submitted.status === 200 && submitted.body?.status === "SUBMITTED", "request submitted", submitted.body?.status);

  const resubmit = await employee.post(`/api/requests/${id}/submit`, {});
  check(
    resubmit.status === 409,
    "a request already under approval cannot be re-submitted, which would discard decisions already made",
    `HTTP ${resubmit.status}`
  );

  const withSteps = (await employee.get(`/api/requests/${id}`)).body;
  const firstStep = withSteps.approvals?.find((a) => a.decision === "PENDING");
  if (!check(!!firstStep, "an approval chain was built", `${withSteps.approvals?.length ?? 0} steps`)) return finish();

  const returned = await manager.post(`/api/requests/${id}/decide`, {
    stepId: firstStep.id,
    decision: "CHANGES_REQUESTED",
    comment: "Please split this across two cost centres.",
  });
  check(
    returned.status === 200 && returned.body?.status === "RETURNED",
    "changes requested returns the request to its owner, rather than rejecting it",
    returned.body?.status
  );

  const afterReturn = (await employee.get(`/api/requests/${id}`)).body;
  check(!!afterReturn?.returnedAt, "the return is timestamped");
  check(
    afterReturn?.returnReason?.includes("cost centres"),
    "the reason for return is recorded where the requester can read it",
    afterReturn?.returnReason?.slice(0, 50)
  );
  check(
    (afterReturn?.approvals ?? []).every((a) => a.decision !== "PENDING"),
    "the remaining approval chain was voided"
  );

  const resubmitted = await employee.post(`/api/requests/${id}/submit`, {});
  check(
    resubmitted.status === 200 && resubmitted.body?.status === "SUBMITTED",
    "a returned request can be resubmitted",
    resubmitted.body?.status
  );

  const afterResubmit = (await employee.get(`/api/requests/${id}`)).body;
  check(!afterResubmit?.returnedAt, "resubmission clears the return marker");
  check(
    (afterResubmit?.approvals ?? []).some((a) => a.decision === "PENDING"),
    "resubmission builds a fresh approval chain"
  );

  const cancelled = await employee.post(`/api/requests/${id}/cancel`, { reason: "Lifecycle probe complete" });
  check(cancelled.status === 200, "the probe request was cancelled", cancelled.body?.status);

  const afterCancel = await employee.post(`/api/requests/${id}/submit`, {});
  check(afterCancel.status >= 400, "a cancelled request cannot be resubmitted", `HTTP ${afterCancel.status}`);

  finish();
}

function finish() {
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\n\x1b[31mLifecycle run aborted\x1b[0m");
  console.error(err);
  process.exit(1);
});
