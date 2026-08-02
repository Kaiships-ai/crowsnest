import { desc, eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { queryLogEvents, type LogEventRow } from "@/server/logs/store";

/**
 * The Runs query layer (Runs and observability, spec 2026-08-02). A "Run" is not its
 * own table — it is a unified read over `sync_jobs` and `remix_runs`, the two tables
 * that already record one row per attempt. Unifying them here, once, is what lets the
 * Runs list and detail screens (and the SSE stream) render both kinds without knowing
 * two different shapes.
 *
 * Read only: nothing in this file writes. Sync and remix rows are written by
 * `services/sync-engine.ts` and `services/remix.ts` respectively.
 */

export type RunType = "sync" | "remix" | "download";
export type RunStatus = "running" | "success" | "partial" | "failed";

export interface RunSummary {
  runId: string;
  type: RunType;
  title: string;
  sub: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  heartbeatAt: string | null;
  durationMs: number;
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  channelsDone: number | null;
  channelsTotal: number | null;
}

export interface RunDetail extends RunSummary {
  events: LogEventRow[];
}

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_EVENT_LIMIT = 500;

/** Whole-library sync jobs are keyed on this literal lock, not a real channel id — see
 *  `channels.lockKey` on `sync_jobs` in schema.ts. */
const LIBRARY_LOCK_KEY = "__library__";

type SyncJobSelect = typeof tables.syncJobs.$inferSelect;
type RemixRunSelect = typeof tables.remixRuns.$inferSelect;

function syncSub(row: SyncJobSelect): string {
  if (row.status === "failed") return row.errorMessage ?? row.errorCode ?? "Sync failed";
  if (row.channelsTotal != null) {
    return `${row.channelsDone} of ${row.channelsTotal} channels, ${row.itemsCreated} new, ${row.itemsUpdated} updated`;
  }
  return `${row.itemsCreated} new, ${row.itemsUpdated} updated`;
}

function durationOf(startedAt: string, finishedAt: string | null, now: number): number {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  return Math.max(0, end - start);
}

function fromSyncJob(row: SyncJobSelect, now: number): RunSummary {
  return {
    runId: row.id,
    type: "sync",
    title: row.lockKey === LIBRARY_LOCK_KEY ? "Library sync" : row.currentChannelHandle ?? "Channel sync",
    sub: syncSub(row),
    status: row.status as RunStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    heartbeatAt: row.heartbeatAt,
    durationMs: durationOf(row.startedAt, row.finishedAt, now),
    itemsSeen: row.itemsSeen,
    itemsCreated: row.itemsCreated,
    itemsUpdated: row.itemsUpdated,
    itemsFailed: row.itemsFailed,
    channelsDone: row.channelsDone,
    channelsTotal: row.channelsTotal,
  };
}

/** A remix run row is always terminal — `remix_runs.finished_at` is written together
 *  with the row at insert time, so there is no "running" remix Run to represent. */
function fromRemixRun(row: RemixRunSelect): RunSummary {
  return {
    runId: row.id,
    type: "remix",
    title: `Remix: ${row.stage} stage`,
    sub: row.detail,
    status: row.outcome === "success" ? "success" : "failed",
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    heartbeatAt: null,
    durationMs: row.elapsedMs,
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsFailed: 0,
    channelsDone: null,
    channelsTotal: null,
  };
}

/** Every Run, newest first, sync and remix unified. Default limit 50 matches the
 *  Runs list screen's first page. */
export function listRuns(limit = DEFAULT_LIST_LIMIT): RunSummary[] {
  const now = Date.now();
  const syncRows = db.select().from(tables.syncJobs).orderBy(desc(tables.syncJobs.startedAt)).all();
  const remixRows = db.select().from(tables.remixRuns).orderBy(desc(tables.remixRuns.startedAt)).all();

  const runs = [...syncRows.map((r) => fromSyncJob(r, now)), ...remixRows.map(fromRemixRun)];
  runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return runs.slice(0, limit);
}

/** One Run plus its trace: the log lines attached via `log_events.run_id` (bridged
 *  from `fields.jobId` for sync emitters, see `logs/store.ts`). Null when `runId`
 *  matches neither table — a bad link or a Run older than the retention window. */
export function getRun(runId: string): RunDetail | null {
  const now = Date.now();

  const syncRow = db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, runId)).get();
  const summary = syncRow
    ? fromSyncJob(syncRow, now)
    : (() => {
        const remixRow = db.select().from(tables.remixRuns).where(eq(tables.remixRuns.id, runId)).get();
        return remixRow ? fromRemixRun(remixRow) : null;
      })();

  if (!summary) return null;

  const events = queryLogEvents({ runId, levels: ["info", "warn", "error"], limit: DEFAULT_EVENT_LIMIT });
  return { ...summary, events };
}
