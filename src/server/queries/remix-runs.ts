import { desc, eq } from "drizzle-orm";
import { db, tables } from "../db";
import type { RemixStage } from "../services/remix";

/**
 * The remix studio's run log (v1-scope.md, Remix studio P0). One row per generation
 * attempt — see `withRunLog` in `services/remix.ts`, which is the only writer. Read
 * only: the write side is the generation calls' own bookkeeping, not a user action.
 */
export interface RemixRunRow {
  id: string;
  stage: RemixStage;
  outcome: "success" | "error";
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  detail: string;
  errorMessage: string | null;
}

/** Newest first, matching every other run-log/history list in this app (channel runs,
 *  sync jobs). Rows survive a restart of the session (restart clears `stage` back to
 *  "prompt", not this table) and survive a page reload, per the acceptance criteria. */
export async function getRemixRunLog(sessionId: string): Promise<RemixRunRow[]> {
  const rows = await db
    .select()
    .from(tables.remixRuns)
    .where(eq(tables.remixRuns.sessionId, sessionId))
    .orderBy(desc(tables.remixRuns.startedAt));

  return rows.map((row) => ({
    id: row.id,
    stage: row.stage as RemixStage,
    outcome: row.outcome as "success" | "error",
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    elapsedMs: row.elapsedMs,
    detail: row.detail,
    errorMessage: row.errorMessage,
  }));
}
