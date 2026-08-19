// NextMav Procure — Prisma client singleton.
//
// This is the ONLY place a PrismaClient is constructed. Route handlers must not
// import this directly for tenant-scoped models — go through `tenancy.ts` so the
// organization filter cannot be forgotten.
//
// The client carries one extension by default: money and quantity columns are
// Postgres `numeric` (so ledger sums are exact) and are converted back to
// `number` on read. See `decimal-fields.ts`.

import { PrismaClient, type Prisma } from "@prisma/client";
import { decimalAsNumber } from "./decimal-fields";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

function createClient() {
  return new PrismaClient({
    // Query logging is a development affordance only. In production it leaks
    // record contents into stdout, which is both noisy and a data-handling risk.
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],

    // Prisma's default interactive-transaction budget is 5 seconds, which is
    // generous against a local database and far too tight against a pooled one
    // in another region: posting a receipt of a dozen lines writes stock
    // movements, balances and asset rows, and each statement pays the round
    // trip. When the budget runs out mid-transaction the work is rolled back
    // and the caller sees "Transaction not found" rather than anything useful.
    transactionOptions: {
      maxWait: 15_000,
      timeout: 30_000,
    },
  }).$extends(decimalAsNumber);
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = typeof db;

/** A Prisma transaction client, for services that compose several writes atomically. */
export type Tx = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Rounds a money value to the minor unit before it is written.
 *
 * The database column is numeric(18,4) and would round anyway; doing it here
 * means the value the service compares against is the value that was stored, so
 * a balance check cannot pass on a figure the database then changes.
 */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Same, at the four decimal places the quantity columns carry. */
export function qty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * Rewrites a Prisma payload type so its Decimal columns read as numbers.
 *
 * `Prisma.XGetPayload<...>` describes the *unextended* client, so it still says
 * Decimal where the extension in `decimal-fields.ts` actually hands back a
 * number. Wrapping the payload type in `Numeric` keeps the convenience of
 * GetPayload while describing what the code really receives.
 */
export type Numeric<T> = T extends Prisma.Decimal
  ? number
  : T extends Date
    ? Date
    : T extends (infer U)[]
      ? Numeric<U>[]
      : T extends object
        ? { [K in keyof T]: Numeric<T[K]> }
        : T;
