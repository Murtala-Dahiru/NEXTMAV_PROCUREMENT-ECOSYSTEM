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
NEXT_PUBLIC_SITE_URL                https://your-deployment.vercel.app
```

`NEXT_PUBLIC_SITE_URL` is the origin Supabase returns users to from verification
and recovery emails. Get it wrong and sign-up appears to work while every
verification link lands on the wrong host — or is refused outright, because
Supabase only redirects to URLs on the project's allow-list. Set it per
environment; a preview deployment needs its own.

### 3a. Configure Supabase Auth

Authentication → URL Configuration, in the Supabase dashboard:

| Setting | Value |
|---|---|
| Site URL | `https://your-deployment.vercel.app` |
| Redirect URLs | `https://your-deployment.vercel.app/auth/callback`<br>`https://your-deployment.vercel.app/auth/finish`<br>`http://localhost:3000/auth/callback`<br>`http://localhost:3000/auth/finish` |

Both callback paths must be listed. `/auth/callback` handles links that carry the
session as a query parameter; `/auth/finish` handles the ones that carry it in the
URL fragment, which a server can never see. Which of the two Supabase uses depends
on how the link was generated, so omitting either breaks verification for a subset
of users — and it fails *after* the address has already been marked confirmed,
which is the hardest kind of failure to diagnose.

Authentication → Providers → Email:

- **Enable email provider** — on.
- **Confirm email** — on. With it off, anyone can sign up as any address without
  proving they control it. `getInternalPrincipal` rejects unverified identities
  regardless, so turning it off does not grant access; it just strands users.

Authentication → Emails: the built-in SMTP is rate-limited to a few messages per
hour and, on a new project, delivers only to members of the Supabase organization.
That is fine for development and **not** fine for production — real sign-ups will
silently fail to receive anything. Configure a custom SMTP provider before
inviting real users.

`.env` is gitignored and is **not** in the repository — these must be set here.
See `.env.example` for the full annotated list.

### 4. Create the schema and load the demo data

Run locally, pointed at Supabase:

```bash
npm run db:migrate          # applies prisma/migrations in order
npm run db:harden           # RLS lockdown — required after any migration that adds tables
npm run db:seed             # demo organization; optional
npm run db:link-auth        # gives each seeded user a Supabase Auth identity
npm run db:sync-roles       # grants newly-released permissions to the system roles
npm run db:vendor-workflow  # installs the default vendor onboarding approval
```

The last two are the ones that are easy to forget on an **upgrade** of a tenant
that already has data, and both fail loudly rather than subtly if skipped.

`db:sync-roles` exists because `ensureSystemRoles` never rewrites an existing
role's permissions — that is what lets an administrator remove a grant and have it
stay removed across deploys. The cost is that a permission added to the catalog in
a release reaches nobody until this is run, and every call gated on it returns 403,
including for the organization administrator. Run it after any release that adds
permissions; `-- --dry-run` prints the diff first. It only ever adds.

`db:vendor-workflow` installs the three-stage supplier onboarding approval as
ordinary workflow rows and grants the `VENDOR_MANAGER` role its first stage routes
to. Both are idempotent: an organization that already has a VENDOR workflow keeps
whatever it has configured. Without it, submitting a supplier for approval refuses
with a configuration error rather than approving nothing silently.

`db:link-auth` is required after any seed. Supabase Auth holds the credentials,
so a `User` row without a linked `authUserId` cannot sign in at all — the seed
alone produces accounts that exist but are unreachable. The script is idempotent
and safe to re-run.

For a tenant whose real passwords nobody knows, run it as
`npm run db:link-auth -- --invite` instead: that creates each identity without a
usable password and sends a recovery link, so users set their own and no operator
ever learns them.

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
BASE_URL=https://your-deployment.vercel.app npm run verify:vendors
BASE_URL=https://your-deployment.vercel.app npm run verify:sourcing
```

The 72 journey checks drive the real API over HTTP and will exercise the deployed
instance. They create real records, so run them against a staging deployment
rather than one holding data you care about.

`verify:sourcing` additionally signs in through the **supplier** realm, so it
proves the second cookie, the second sign-in route and the redaction boundary on
the deployed instance rather than only in development. It creates its own
suppliers, portal accounts and an isolation organization, and removes them at the
end — but a run interrupted part-way leaves them behind.

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
