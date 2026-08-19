-- NextMav Procure — Supabase exposure lockdown.
--
-- Supabase publishes every table in the `public` schema through PostgREST. The
-- publishable key that ships to the browser authenticates as the `anon` role, so
-- without this migration anyone holding that key could read the whole tenant
-- database over HTTPS, entirely bypassing the application's tenancy guard.
--
-- Enabling row-level security with **no policies** denies `anon` and
-- `authenticated` everything. It does not affect this application: Prisma
-- connects as the table owner, and an owner bypasses RLS unless FORCE is set,
-- which it deliberately is not. Tenant isolation for application traffic remains
-- the job of src/server/tenancy.ts.
--
-- Re-runnable: `npm run db:harden` applies it to any tables added later.

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

-- Nothing in the browser talks to PostgREST for application data, so the schema
-- itself does not need to be exposed at all.
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
