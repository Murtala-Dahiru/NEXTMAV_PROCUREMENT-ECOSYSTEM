// Runs PGlite — real PostgreSQL compiled to WebAssembly — behind a TCP socket so
// Prisma can connect to it as if it were an ordinary Postgres server.
//
// This exists so the Postgres migration can be verified on a machine with no
// Postgres installed and no Docker. It is a genuine Postgres engine, so it
// exercises what actually differs from SQLite: native enum types, case-sensitive
// LIKE (and therefore the `mode: "insensitive"` fix), and interactive
// transactions.
//
// PGlite serves one connection at a time, so Prisma must be pointed at it with
// `connection_limit=1`.
//
//   node scripts/verify/pg-server.mjs        # runs until killed

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.PG_PORT ?? 55432);

const db = await PGlite.create({ dataDir: process.env.PG_DATA ?? "./.tmp-pg/pglite" });
const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });

await server.start();
console.log(`postgres (pglite) listening on 127.0.0.1:${PORT}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
