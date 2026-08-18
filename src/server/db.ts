// NextMav Procure — Prisma client singleton.
//
// This is the ONLY place a PrismaClient is constructed. Route handlers must not
// import this directly for tenant-scoped models — go through `tenancy.ts` so the
// organization filter cannot be forgotten.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging is a development affordance only. In production it leaks
    // record contents into stdout, which is both noisy and a data-handling risk.
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = typeof db;

/** A Prisma transaction client, for services that compose several writes atomically. */
export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
