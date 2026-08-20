// Links existing NextMav users to Supabase Auth identities.
//
//   node --env-file=.env scripts/db/link-supabase-auth.mjs [--password <pw>] [--dry-run]
//
// Credentials moved from this application's `User.passwordHash` (scrypt) to
// Supabase Auth. Scrypt hashes cannot be handed to Supabase — it stores bcrypt,
// and a hash cannot be converted without the plaintext — so every pre-existing
// account needs a Supabase identity created for it and linked by `authUserId`.
//
// For the seeded demo tenant that is straightforward: the seed set a known shared
// password, so the same one is set in Supabase and the demo accounts keep working
// exactly as before.
//
// For a tenant with real users whose passwords nobody knows, do NOT use this
// script's password option. Run it with --invite instead, which creates the
// identity without a usable password and emails each user a recovery link, so
// they set their own. Nobody's password is ever known to the operator.
//
// Idempotent: an account that already has an `authUserId`, or whose address
// already exists in Supabase, is linked rather than duplicated.

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const invite = args.includes("--invite");
const passwordIndex = args.indexOf("--password");
const password =
  passwordIndex !== -1 ? args[passwordIndex + 1] : invite ? null : "NextMav#2026";

if (!invite && !password) {
  console.error("Provide --password <pw> or use --invite.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  process.exit(1);
}

const db = new PrismaClient();
const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Supabase has no "get user by email", so the directory is paged and indexed. */
async function existingAuthUsersByEmail() {
  const byEmail = new Map();
  let page = 1;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u);
    }
    if (data.users.length < 1000) break;
    page += 1;
  }

  return byEmail;
}

async function main() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      authUserId: true,
      organization: { select: { name: true } },
    },
  });

  console.log(`${users.length} NextMav user(s) found.`);
  if (dryRun) console.log("--dry-run: no changes will be written.\n");

  const authUsers = await existingAuthUsersByEmail();
  console.log(`${authUsers.size} existing Supabase auth user(s).\n`);

  const summary = { linked: 0, created: 0, alreadyLinked: 0, invited: 0, failed: 0 };

  for (const user of users) {
    const email = user.email.toLowerCase();
    const label = `${user.name} <${email}>`;

    if (user.authUserId) {
      console.log(`  = ${label} — already linked`);
      summary.alreadyLinked += 1;
      continue;
    }

    const existing = authUsers.get(email);

    if (existing) {
      if (dryRun) {
        console.log(`  ~ ${label} — would link to existing auth user ${existing.id}`);
      } else {
        await db.user.update({ where: { id: user.id }, data: { authUserId: existing.id } });
        console.log(`  + ${label} — linked to existing auth user`);
      }
      summary.linked += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  ~ ${label} — would create auth user`);
      summary.created += 1;
      continue;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      // Confirmed on creation: these accounts already existed and were in use, so
      // making them re-verify an address they have been signing in with for
      // months would be a regression, not a security improvement.
      email_confirm: true,
      ...(password ? { password } : {}),
      user_metadata: { full_name: user.name, organization_name: user.organization.name },
    });

    if (error || !data.user) {
      console.error(`  ! ${label} — ${error?.message ?? "unknown error"}`);
      summary.failed += 1;
      continue;
    }

    await db.user.update({ where: { id: user.id }, data: { authUserId: data.user.id } });
    console.log(`  + ${label} — auth user created and linked`);
    summary.created += 1;

    if (invite) {
      const { error: linkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${siteUrl}/auth/callback?next=%2Freset-password` },
      });
      if (linkError) {
        console.error(`  ! ${label} — could not send recovery link: ${linkError.message}`);
      } else {
        summary.invited += 1;
      }
    }
  }

  console.log(
    `\nDone. created=${summary.created} linked=${summary.linked} ` +
      `already=${summary.alreadyLinked} invited=${summary.invited} failed=${summary.failed}`
  );

  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
