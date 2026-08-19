# Deploying NextMav Procure

## Vercel + Neon Postgres

### 1. Create the database

Create a project at [neon.tech](https://neon.tech). From the dashboard, copy **both**
connection strings — they are different and both are required:

| Variable | Which string | Used by |
|---|---|---|
| `DATABASE_URL` | **Pooled** — host contains `-pooler` | The app at runtime |
| `DIRECT_DATABASE_URL` | **Direct** — no `-pooler` | `prisma migrate` / `db push` only |

The distinction matters. A Vercel serverless function may run in a fresh container
on every request, so runtime connections must come from a pooler or the database
exhausts its connection limit under any real load. Migrations are the opposite
case: they need a genuine session, which a transaction-mode pooler cannot provide.

### 2. Generate the secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice — once for `AUTH_SECRET`, once for `INTEGRATION_ENCRYPTION_KEY`.
Use different values, and different values again per environment.

`AUTH_SECRET` signs sessions. Rotating it invalidates every session immediately,
which is the intended emergency lever.

### 3. Set the environment variables in Vercel

Project → Settings → Environment Variables:

```
DATABASE_URL              postgresql://…-pooler…?sslmode=require
DIRECT_DATABASE_URL       postgresql://…?sslmode=require
AUTH_SECRET               <32-byte hex>
INTEGRATION_ENCRYPTION_KEY <32-byte hex>
NEXTAUTH_URL              https://your-deployment.vercel.app
```

`.env` is gitignored and is **not** in the repository — these must be set here.
See `.env.example` for the full annotated list.

### 4. Create the schema and load the demo data

Run locally, pointed at Neon:

```bash
npm run db:push
npm run db:seed
```

The seed refuses to run when `NODE_ENV=production`, so set it deliberately if you
intend to load demo data into a production database — and prefer not to.

### 5. Deploy

Push to `main`. Vercel runs `npm run build`, which is a plain `next build`.
`postinstall` runs `prisma generate` so the client matches the schema even when
Vercel restores a cached `node_modules`.

---

## Verifying a deployment

```bash
BASE_URL=https://your-deployment.vercel.app npm run verify:journeys
```

The 72 journey checks drive the real API over HTTP and will exercise the deployed
instance. They create real records, so run them against a staging deployment
rather than one holding data you care about.

---

## Running locally without installing Postgres

The schema targets PostgreSQL, so SQLite is no longer an option locally. If you do
not want to install a database server, the repository ships a self-contained one —
PGlite, which is real PostgreSQL compiled to WebAssembly:

```bash
npm run db:local     # Postgres on 127.0.0.1:55432 — leave this running
npm run db:push
npm run db:seed
npm run dev
```

Point both `DATABASE_URL` and `DIRECT_DATABASE_URL` at:

```
postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=1
```

**One caveat.** PGlite serves a single connection at a time, and the dev server
takes it. `verify:ui` runs against it happily because it is pure HTTP, but
`verify:tenancy` and `verify:journeys` open their own database connections to
assert side effects — those need a multi-connection server, so point them at Neon:

```bash
BASE_URL=http://localhost:3000 npm run verify:journeys
```

---

## Self-hosting (the `.zscripts` path)

The repository also contains a self-hosted path that packages
`.next/standalone` behind Caddy, with the Socket.IO notification mini-service.

```bash
npm run build:standalone
```

`next.config.ts` enables standalone output automatically when `VERCEL` is not set,
so this keeps working. Vercel gets a normal build because standalone relocates the
file-trace manifests that Vercel's post-build step reads.

**`.zscripts/build.sh` needs updating for Postgres.** It currently copies
`./db/custom.db` into the build artifact and runs `db:push` against it — behaviour
that only made sense with SQLite. With a Postgres datasource it will fail. Point
that script at the same `DATABASE_URL` instead of packaging a database file.

---

## Known issues to address before real financial use

### Money is stored as `Float`

Every monetary column (`totalAmount`, `unitPrice`, `paidAmount`, budget figures)
is a double-precision float, inherited from the original schema. Floats cannot
represent decimal fractions exactly, so long chains of arithmetic — a budget
accumulating hundreds of ledger entries, or an invoice split across many partial
payments — accumulate rounding error.

Postgres supports `Decimal`, and Prisma maps it to a `Decimal` value type. The
change is mechanical in the schema but touches every arithmetic expression in the
service layer, because `Decimal` does not support `+` and `*`. It is deliberately
**not** done as part of the deployment change, to keep that change reviewable.

Nothing is wrong today at the scale the platform holds, and the reconciliation
test (`verify:journeys`, "budget rollups reconcile against the ledger") would
catch drift. But it should be fixed before the system holds real money.

### A stale `db/custom.db` is still committed

It is a SQLite file from before the Postgres switch and no longer matches the
schema. Harmless, but misleading — worth removing once the self-hosted path has
been migrated.
