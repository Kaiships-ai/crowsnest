import { desc, eq, ne } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { enrichedFromEvents } from "@/lib/run-enrichment";
import { queryLogEvents, type LogEventRow } from "@/server/logs/store";
import {
  BACKFILL_LOCK_KEY,
  isSyncStalled,
  type SyncGap,
  type SyncJobStatus,
} from "@/server/services/sync-types";

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
export type RunStatus = "running" | "waiting" | "success" | "partial" | "failed" | "canceled";

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
  /** How many view counts this run recovered from Instagram's single-media endpoint,
   *  summed across its channels. Null means the pass never ran (the knob is 0, or the run
   *  was cancelled or failed before reaching it) — deliberately not 0, because "did not
   *  measure" and "measured nothing" are different facts and this app does not print a
   *  fabricated zero for the first. */
  itemsEnriched: number | null;
}

const DEFAULT_LIST_LIMIT = 100;
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

/** Every Run, newest first, sync and remix unified. Default limit 100 matches the
 *  Runs list screen's first page — and, since the Runs SSE route re-runs this every
 *  2s (REFRESH_MS in api/runs/stream/route.ts), bounds what each tick reads.
 *
 *  The `limit` is pushed into each table's own SQL query, not applied by slicing a
 *  full table scan in JS: without a SQL-level LIMIT this pulled the entire sync_jobs
 *  and remix_runs history on every poll, growing without bound as history
 *  accumulates. Taking the top `limit` rows (by startedAt) from each table before
 *  merging is still correct for "the newest `limit` overall" — a row ranked past
 *  `limit` within its own table can never place inside the global top `limit`, since
 *  `limit` other rows in that same table already outrank it. */
export function listRuns(limit = DEFAULT_LIST_LIMIT): RunSummary[] {
  const now = Date.now();
  const syncRows = db.select().from(tables.syncJobs).orderBy(desc(tables.syncJobs.startedAt)).limit(limit).all();
  const remixRows = db.select().from(tables.remixRuns).orderBy(desc(tables.remixRuns.startedAt)).limit(limit).all();

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

  // Derived from the trace, not from a column on sync_jobs: the pass has always logged
  // these counts, and since the run_id threading the events are reachable by run, so this
  // needs no schema change. It does inherit the log level — `sync.enrich.finished` is
  // info, so a deployment running at LOG_LEVEL=warn or above stores no such row and every
  // run reports null. That is the honest outcome for a derived figure.
  const events = queryLogEvents({ runId, levels: ["info", "warn", "error"], limit: DEFAULT_EVENT_LIMIT });
  return { ...summary, events, itemsEnriched: enrichedFromEvents(events) };
}

/**
 * The health of the most recent sync run, for the dashboard and the future MCP
 * `crowsnest_metrics` tool. Sync only — remix and create runs are not "the last sync".
 *
 * Honest surfaces (PRODUCT.md): a database that has never synced returns `lastStatus`
 * null and null timings, not a fabricated zero-duration success. "Never measured" and
 * "measured zero" are different facts and this app keeps them apart.
 */
export interface LastRunHealth {
  lastStatus: SyncJobStatus | null; // null = never synced
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  channelsDone: number | null;
  channelsTotal: number | null;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  retries: number;
  gaps: SyncGap[];
  stalled: boolean;
}

const NEVER_SYNCED: LastRunHealth = {
  lastStatus: null,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  channelsDone: null,
  channelsTotal: null,
  itemsCreated: 0,
  itemsUpdated: 0,
  itemsFailed: 0,
  retries: 0,
  gaps: [],
  stalled: false,
};

/** Newest sync_jobs row, excluding view-count backfill rows (BACKFILL_LOCK_KEY) which
 *  live in sync_jobs but are not syncs. Returns NEVER_SYNCED when there is no such row. */
export function getLastRunHealth(): LastRunHealth {
  const now = Date.now();
  const row = db
    .select()
    .from(tables.syncJobs)
    .where(ne(tables.syncJobs.lockKey, BACKFILL_LOCK_KEY))
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1)
    .get();

  if (!row) return NEVER_SYNCED;

  return {
    lastStatus: row.status as SyncJobStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: durationOf(row.startedAt, row.finishedAt, now),
    channelsDone: row.channelsDone,
    channelsTotal: row.channelsTotal,
    itemsCreated: row.itemsCreated,
    itemsUpdated: row.itemsUpdated,
    itemsFailed: row.itemsFailed,
    retries: row.retries,
    gaps: row.gaps ?? [],
    stalled: isSyncStalled({ status: row.status as SyncJobStatus, heartbeatAt: row.heartbeatAt }, now),
  };
}
