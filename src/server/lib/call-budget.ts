import { and, count, eq, gt, lte } from "drizzle-orm";
import { db, tables } from "@/server/db";

const HOUR_MS = 3_600_000;
const { sourceCalls } = tables;

export function callsInLastHour(source: string, at: Date): number {
  const t = at.getTime();
  const row = db.select({ n: count() }).from(sourceCalls).where(and(eq(sourceCalls.source, source), gt(sourceCalls.calledAt, t - HOUR_MS), lte(sourceCalls.calledAt, t))).get();
  return row?.n ?? 0;
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
