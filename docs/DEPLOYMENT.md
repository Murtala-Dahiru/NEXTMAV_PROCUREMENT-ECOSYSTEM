# Deploying NextMav Procure

## Vercel + Supabase Postgres

### 1. Create the database

Create a project at [supabase.com](https://supabase.com). From
Project Settings → Database → Connection string, take the **Supavisor pooler**
strings in both modes:

| Variable | Which string | Port | Used by |
|---|---|---|---|
| `DATABASE_URL` | pooler, transaction mode | 6543 | the app at runtime |
| `DIRECT_DATABASE_URL` | pooler, session mode | 5432 | `prisma migrate` only |

The distinction matters. A Vercel serverless function may run in a fresh container
on every request, so runtime connections must come from a pooler or the database
exhausts its connection limit under any real load. Migrations are the opposite
case: they need a genuine session, which a transaction-mode pooler cannot provide.

Do not use the direct host (`db.<ref>.supabase.co`). New Supabase projects publish
it over IPv6 only, which many workstations and CI runners cannot route; the pooler
answers on IPv4.

A password containing reserved characters must be percent-encoded in the URL —
`+` becomes `%2B`. An unencoded one surfaces as "can't reach database server"
rather than as an authentication failure, which costs an hour to diagnose.

Also copy the API keys: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (browser-safe) and `SUPABASE_SECRET_KEY`
(server-only; it bypasses row-level security).

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
DATABASE_URL                        postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1   # 1 on Vercel; 10+ on a long-running server
DIRECT_DATABASE_URL                 postgresql://postgres.<ref>:<pw>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=require
NEXT_PUBLIC_SUPABASE_URL            https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sb_publishable_…
SUPABASE_SECRET_KEY                 sb_secret_…
AUTH_SECRET                         <32-byte hex>
INTEGRATION_ENCRYPTION_KEY          <32-byte hex>
NEXTAUTH_URL                        https://your-deployment.vercel.app
```

`.env` is gitignored and is **not** in the repository — these must be set here.
See `.env.example` for the full annotated list.

### 4. Create the schema and load the demo data

Run locally, pointed at Supabase:

```bash
npm run db:migrate    # applies prisma/migrations in order
npm run db:harden     # RLS lockdown — required after any migration that adds tables
npm run db:seed       # demo organization; optional
```

`db:harden` is not optional housekeeping. Supabase publishes every table in the
`public` schema through PostgREST, so a table created without row-level security
is readable by anyone holding the publishable key that ships to the browser. The
lockdown migration enables RLS with no policies and revokes `anon` access; running
it again covers whatever the latest migration added.

Verify it took effect:

```bash
curl -s "https://<ref>.supabase.co/rest/v1/Vendor?select=*" -H "apikey: <publishable key>"
# {"code":"42501", … "permission denied for table Vendor"}
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
npm run db:migrate
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
assert side effects — those need a multi-connection server, so point them at
Supabase:

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

### ~~Money is stored as `Float`~~ — fixed

Every money and quantity column is now `numeric(18,4)` (rates `numeric(9,4)`), so
Postgres aggregates them exactly and a budget ledger of hundreds of entries cannot
drift. Prisma returns `numeric` as `Decimal`; a generated client extension
(`src/server/decimal-fields.ts`) converts those back to `number` on read, so the
service layer and the views work with plain numbers and the types match the
runtime values. Aggregates (`_sum`) are deliberately left as `Decimal` — the
compiler then points at every place a total is computed, which is exactly where
silent coercion would do damage.

### A stale `db/custom.db` is still committed

It is a SQLite file from before the Postgres switch and no longer matches the
schema. Harmless, but misleading — worth removing once the self-hosted path has
been migrated.
