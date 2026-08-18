// Kept as a compatibility re-export. The Prisma client singleton now lives in
// `src/server/db.ts` alongside the tenancy guard, so that server-only code is not
// reachable from `src/lib`, which the client bundle imports.
export { db } from "@/server/db";
