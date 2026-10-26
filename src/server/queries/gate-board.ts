import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, tables } from "@/server/db";
import { planChanges, type PlanChange, type Reel } from "@/server/services/plan-versions";

type VersionRow = typeof tables.planVersions.$inferSelect;

export interface GateVersion {
  id: string;
  version: number;
  agent: string;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  reels: Reel[];
}

export interface GateBoard {
  /** The newest proposal ahead of its period's live version, with what it changes. */
  proposal: { period: VersionRow["period"]; periodKey: string; next: GateVersion; live: GateVersion | null; changes: PlanChange[] } | null;
  /** The newest approval, which Undo reverts when an earlier version was live before it. */
  lastApproval: { period: VersionRow["period"]; periodKey: string; live: GateVersion; canUndo: boolean } | null;
}

const V = tables.planVersions;

const gateVersion = (r: VersionRow): GateVersion => ({
  id: r.id,
  version: r.version,
  agent: r.agent,
  createdAt: r.createdAt,
  approvedAt: r.approvedAt,
  approvedBy: r.approvedBy,
  reels: r.reels as Reel[],
});

const liveOf = (r: Pick<VersionRow, "period" | "periodKey">) =>
  db.select().from(V).where(and(eq(V.period, r.period), eq(V.periodKey, r.periodKey), eq(V.status, "live"))).get();

export function getGateBoard(): GateBoard {
  const next = db
    .select()
    .from(V)
    .where(
      and(
        eq(V.status, "proposed"),
        sql`${V.version} > coalesce((select max(l.version) from plan_versions l where l.period = ${V.period} and l.period_key = ${V.periodKey} and l.status = 'live'), 0)`,
      ),
    )
    .orderBy(desc(V.createdAt), desc(V.version))
    .get();
  const approved = db.select().from(V).where(and(eq(V.status, "live"), isNotNull(V.approvedAt))).orderBy(desc(V.approvedAt)).get();
  const live = next ? liveOf(next) : undefined;
  const earlier = approved
    ? db
        .select({ id: V.id })
        .from(V)
        .where(and(eq(V.period, approved.period), eq(V.periodKey, approved.periodKey), eq(V.status, "superseded"), isNotNull(V.approvedAt)))
        .get()
    : undefined;
  return {
    proposal: next
      ? {
          period: next.period,
          periodKey: next.periodKey,
          next: gateVersion(next),
          live: live ? gateVersion(live) : null,
          changes: planChanges((live?.reels as Reel[] | undefined) ?? [], next.reels as Reel[]),
        }
      : null,
    lastApproval: approved ? { period: approved.period, periodKey: approved.periodKey, live: gateVersion(approved), canUndo: earlier !== undefined } : null,
  };
}
