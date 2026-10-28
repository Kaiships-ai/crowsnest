import { and, count, eq, gt, lte, min } from "drizzle-orm";
import { db, tables } from "@/server/db";

const HOUR_MS = 3_600_000;
const { sourceCalls } = tables;

export function callsInLastHour(source: string, at: Date): number {
  const t = at.getTime();
  const row = db.select({ n: count() }).from(sourceCalls).where(and(eq(sourceCalls.source, source), gt(sourceCalls.calledAt, t - HOUR_MS), lte(sourceCalls.calledAt, t))).get();
  return row?.n ?? 0;
}

/** When the hour's window frees its first call again: the oldest call in the last hour, plus an hour. Null when the hour holds none. */
export function hourFreesAt(source: string, at: Date): Date | null {
  const t = at.getTime();
  const row = db.select({ oldest: min(sourceCalls.calledAt) }).from(sourceCalls).where(and(eq(sourceCalls.source, source), gt(sourceCalls.calledAt, t - HOUR_MS), lte(sourceCalls.calledAt, t))).get();
  return row?.oldest == null ? null : new Date(row.oldest + HOUR_MS);
}

export function trySpendCall(source: string, limit: number, at: Date): boolean {
  const t = at.getTime();
  return db.transaction(
    (tx) => {
      tx.delete(sourceCalls).where(and(eq(sourceCalls.source, source), lte(sourceCalls.calledAt, t - HOUR_MS))).run();
      if (callsInLastHour(source, at) >= limit) return false;
      tx.insert(sourceCalls).values({ source, calledAt: t }).run();
      return true;
    },
    { behavior: "immediate" },
  );
}
