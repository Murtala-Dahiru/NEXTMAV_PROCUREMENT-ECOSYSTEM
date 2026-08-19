// Creates a migration from the difference between the database and the schema.
//
//   npm run db:migrate:new -- add_supplier_scorecards
//
// Why not `prisma migrate dev`: that command needs a shadow database it can
// create and drop, and a hosted Supabase project does not hand out permission to
// create databases. Diffing the live schema against prisma/schema.prisma
// produces the same SQL without one.
//
// The generated file is written, never applied. Read it, edit it if the diff
// guessed wrong about a rename, then apply it with `npm run db:migrate`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: npm run db:migrate:new -- <snake_case_name>");
  process.exit(1);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 14);
const dir = path.join("prisma", "migrations", `${stamp}_${name}`);
fs.mkdirSync(dir, { recursive: true });

const sql = execFileSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-schema-datasource",
    "prisma/schema.prisma",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { encoding: "utf8", shell: process.platform === "win32" }
);

if (!sql.trim() || /^-- This is an empty migration/.test(sql.trim())) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("No schema changes to migrate.");
  process.exit(0);
}

const file = path.join(dir, "migration.sql");
fs.writeFileSync(file, sql);

console.log(`Wrote ${file}`);
console.log(sql.split("\n").slice(0, 20).join("\n"));
console.log("\nReview it, then apply with: npm run db:migrate");

// New tables are created without row-level security, which on Supabase means
// they are exposed through the public REST API until it is enabled.
if (/CREATE TABLE/.test(sql)) {
  console.log(
    "\nThis migration creates tables. Run `npm run db:harden` afterwards so they are not\nreadable through the project's public API key."
  );
}
