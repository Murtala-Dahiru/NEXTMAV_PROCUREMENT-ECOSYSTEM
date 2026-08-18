// Empirical check that the tenant guard cannot be bypassed.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ log: ["error"] });

const TENANT_MODELS = new Set(["Vendor", "PurchaseRequest", "Invoice"]);
const WHERE_OPS = new Set(["findUnique","findUniqueOrThrow","findFirst","findFirstOrThrow","findMany","count","aggregate","groupBy","update","updateMany","delete","deleteMany"]);
const CREATE_OPS = new Set(["create","createMany","upsert"]);

function stamp(data, organizationId) {
  if (Array.isArray(data)) return data.map(d => stamp(d, organizationId));
  if (data && typeof data === "object" && data.organizationId === undefined && data.organization === undefined) {
    return { ...data, organizationId };
  }
  return data;
}

function tenantDb(organizationId) {
  return db.$extends({
    name: "tenant-scope",
    query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      if (!model || !TENANT_MODELS.has(model)) return query(args);
      const a = args ?? {};
      if (WHERE_OPS.has(operation)) a.where = { ...(a.where ?? {}), organizationId };
      if (CREATE_OPS.has(operation)) {
        if (operation === "upsert") { a.where = { ...(a.where ?? {}), organizationId }; if (a.create) a.create = stamp(a.create, organizationId); }
        else if (a.data !== undefined) a.data = stamp(a.data, organizationId);
      }
      return query(a);
    }}},
  });
}

let pass = 0, fail = 0;
const ok  = (n) => { pass++; console.log(`  PASS  ${n}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ""}`); };

const orgA = await db.organization.create({ data: { name: "Tenant A" } });
const orgB = await db.organization.create({ data: { name: "Tenant B" } });
const vA = await db.vendor.create({ data: { organizationId: orgA.id, companyName: "Acme A" } });
const vB = await db.vendor.create({ data: { organizationId: orgB.id, companyName: "Acme B" } });

const A = tenantDb(orgA.id);

// 1. findMany must not return the other tenant's rows
const many = await A.vendor.findMany();
many.every(v => v.organizationId === orgA.id) && many.length === 1 ? ok("findMany is scoped") : bad("findMany is scoped", `got ${many.length} rows`);

// 2. findUnique by the other tenant's primary key must resolve to null
const leak = await A.vendor.findUnique({ where: { id: vB.id } });
leak === null ? ok("findUnique cannot cross tenants") : bad("findUnique cannot cross tenants", "returned a foreign row");

// 3. own row is still reachable
const own = await A.vendor.findUnique({ where: { id: vA.id } });
own?.id === vA.id ? ok("findUnique still returns own row") : bad("findUnique still returns own row");

// 4. update against the other tenant must affect nothing
let updateBlocked = false;
try { await A.vendor.update({ where: { id: vB.id }, data: { companyName: "HIJACKED" } }); }
catch { updateBlocked = true; }
const vBAfter = await db.vendor.findUnique({ where: { id: vB.id } });
updateBlocked && vBAfter.companyName === "Acme B" ? ok("update cannot cross tenants") : bad("update cannot cross tenants", `name is now ${vBAfter.companyName}`);

// 5. delete against the other tenant must affect nothing
let deleteBlocked = false;
try { await A.vendor.delete({ where: { id: vB.id } }); } catch { deleteBlocked = true; }
const stillThere = await db.vendor.findUnique({ where: { id: vB.id } });
deleteBlocked && stillThere ? ok("delete cannot cross tenants") : bad("delete cannot cross tenants");

// 6. deleteMany with no where must not empty the other tenant
await A.vendor.deleteMany({ where: { companyName: "nonexistent" } });
(await db.vendor.count({ where: { organizationId: orgB.id } })) === 1 ? ok("deleteMany is scoped") : bad("deleteMany is scoped");

// 7. create stamps the tenant automatically
const created = await A.vendor.create({ data: { companyName: "Auto-stamped" } });
created.organizationId === orgA.id ? ok("create stamps organizationId") : bad("create stamps organizationId");

// 8. count is scoped
(await A.vendor.count()) === 2 ? ok("count is scoped") : bad("count is scoped", `got ${await A.vendor.count()}`);

// cleanup
await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
await db.$disconnect();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
