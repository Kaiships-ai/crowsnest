import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import PQueue from "p-queue";
import { db, newId, nowIso, tables } from "../db";
import { config } from "../config";
import { log } from "../lib/logger";
import { errorMessage } from "../lib/action-result";
import { igClient, type IgClient, type IgMedia, type IgMediaStats, type IgProfile } from "../ig/client";
import type { CompletePull, PullResult } from "../lib/pull-result";
import { IgError, SyncAlreadyRunningError, type IgErrorCode } from "../ig/errors";
import { tryEnsureAsset, type EnsureAssetDeps } from "../ig/assets";
import { computeChannelBaseline, scoreVideosAgainstBaseline, type VideoForCalc } from "./outlier-calc";
import { getScoringOptions, getSetting, type ScoringOptions } from "../settings";
import { insertNotification } from "../notifications/store";
import { BACKFILL_LOCK_KEY, SYNC_STALL_SECONDS, type StopReason, type SyncGap, type SyncJobStatus, type SyncPhase } from "./sync-types";
import { insertVideoSnapshots, type VideoSnapshotInsert } from "./sync-batch";
import { normalizeHandle } from "../../lib/handle";

/**
 * Channel sync against the instagrapi sidecar.
 *
 * Shape of a run (design brief §6):
 *   acquire DB lock -> fetch profile -> page media newest-first until the lookback
 *   boundary -> upsert each post (+ carousel children) -> download thumbnails ->
 *   soft-mark posts that vanished -> recompute outlier scores -> finalize the job row.
 *
 * Three properties worth stating because they were absent before:
 *  - The stop condition is a DATE, not a count. `LOOKBACK_DAYS` decides how far back a
 *    run reaches; `MAX_ITEMS_PER_SYNC` is only a safety cap.
 *  - Concurrency is settled by the database (partial unique index on
 *    sync_jobs(channel_id) WHERE status='running'), not by an in-process flag.
 *  - Failure is isolated per level and COUNTED. A dead thumbnail costs one asset, not
 *    the post; a dead post costs one item, not the channel.
 */

/**
 * The wire shape lives in `sync-types.ts` (see the note at the top of that file: the
 * Server Action module that returns it cannot export a type). Re-exported here so
 * existing callers of the engine keep one import.
 */
export type { StopReason, SyncGap, SyncPhase } from "./sync-types";

export interface SyncCounters {
  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  itemsDeleted: number;
  assetsDownloaded: number;
  assetsFailed: number;
}

export interface SyncResult extends SyncCounters {
  jobId: string;
  /** Read by `scripts/live-sync.ts` to decide whether a run achieved anything. */
  channelsSynced: number;
  gaps: SyncGap[];
  stopReason: StopReason | null;
  /** Every channel the run meant to walk, in walk order. */
  handles: string[];
  /** How many of `handles` were started; the rest were never pulled. */
  dispatched: number;
}
// `videosUpserted` and `reaped` were removed from this shape. The first had no reader
// anywhere and was just `itemsCreated + itemsUpdated` restated; the second was read only
// by the test that proves a reaped run cannot resurrect its own row, which asserts the
// row itself — the stronger claim. The reap is still recorded, at error level, by
// `sync.finalize.reaped`.

export interface RunSyncOpts {
  channelIds?: string[];
  client?: IgClient;
  lookbackDays?: number;
  maxItems?: number;
  /** How many of each channel's newest reels the view-count pass may ask Instagram about.
   *  Defaults to the `viewCountEnrichPerChannel` setting. 0 turns the pass off. */
  enrichPerChannel?: number;
  /** Hours since a channel's last full walk within which an incremental sync may stop early
   *  at already-known posts. Defaults to the `syncMetricsFreshnessHours` setting. */
  metricsFreshnessHours?: number;
  /** Test seam — overrides the inter-page jitter sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam for `ensureAsset`'s downloader. */
  assetDeps?: EnsureAssetDeps;
  /** Overrides "now" so lookback maths is testable without freezing the clock. */
  now?: () => Date;
  /** Test seam — overrides the `syncConcurrency` setting for a single run. Clamped to
   *  >= 1 the same way the resolved setting is. */
  concurrency?: number;
  /**
   * Only meaningful for a library sweep (no `channelIds`): a channel whose
   * `lastSuccessfulSyncAt` is at or after this ISO time is left out of the run. Pull the rest
   * passes the start of the card's pull chain, so rivals that chain already synced are not
   * walked again. A run scoped to explicit `channelIds` ignores this; naming a channel is
   * an explicit "sync it now".
   */
  skipSyncedSince?: string;
  /**
   * Fired once, synchronously, the moment the lock is genuinely won and before any
   * network call. Exists so a caller can start a run WITHOUT awaiting it and still hold
   * a real job id: the alternative was snapshotting job ids, kicking `runSync()` off
   * un-awaited and polling `sync_jobs` for a new row while racing an early rejection to
   * spot `SyncAlreadyRunningError` — a race reconstructing something the engine already
   * knows. A losing run never fires it, so a fired callback always means an owned row.
   */
  onJobStarted?: (jobId: string) => void;
  /** Fired after every progress write, so a caller can mirror it (and its heartbeat). */
  onProgress?: (progress: { done: number; total?: number; label?: string | null }) => void;
  /**
   * The Settings > Sources pull. Stop finishes the rival in hand before ending, and the
   * first Instagram limit, expired session or dead sidecar ends the whole pull at once, with
   * no retry: waiting out a limit inside the pull holds the card in Pulling for up to 30 minutes.
   */
  cardPull?: boolean;
}

/** Codes that end a card pull: every later rival would hit the same wall. */
const HALT_CODES: ReadonlySet<string> = new Set(["IG_RATE_LIMITED", "IG_SERVICE_DOWN", "IG_AUTH_REQUIRED"]);

type ChannelRow = typeof tables.channels.$inferSelect;

const PAGE_JITTER_MIN_MS = 300;
const PAGE_JITTER_SPAN_MS = 500;

/**
 * Two thresholds hang off `SYNC_STALL_SECONDS`, and they are derived from it rather than
 * chosen independently because they used to disagree by 20x: the UI called a run stalled
 * after 90 s of silence while the reaper waited a flat 30 minutes to act.
 *
 *  - `HEARTBEAT_MAX_SILENCE_MS` — the engine promises never to go quiet for longer than
 *    this. A third of the stall window, so the UI needs to miss three consecutive
 *    flushes before it calls a healthy run dead.
 *  - `LOCK_STALE_MS` — how long a 'running' row must be silent before another run may
 *    STEAL its lock. Deliberately many stall windows: "the UI shows a warning" and "we
 *    declare the process dead and let a second sync loose on the same channel" are very
 *    different acts, and only the second one can corrupt a live run.
 */
const HEARTBEAT_MAX_SILENCE_MS = (SYNC_STALL_SECONDS * 1000) / 3;
export const LOCK_STALE_MS = SYNC_STALL_SECONDS * 1000 * 10;
/** Ceiling on a single backoff, including one Instagram asked for. A five-minute wait is
 *  already at the edge of what a user will sit through; beyond that, failing the channel
 *  and letting them retry is the honest outcome. */
const MAX_BACKOFF_MS = 300_000;

/**
 * Thumbnail downloads are CDN fetches through the sidecar's `/download`, which does not
 * take the Instagram session lock, so they may overlap. One queue for the whole process,
 * shared by every channel worker, so a library run never has more than this many in flight.
 */
// ponytail: fixed global width of 4 CDN fetches; make it a setting if a slow link needs tuning.
const thumbQueue = new PQueue({ concurrency: 4 });

function jitterMs(): number {
  return PAGE_JITTER_MIN_MS + Math.random() * PAGE_JITTER_SPAN_MS;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function zeroCounters(): SyncCounters {
  return {
    itemsSeen: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsFailed: 0,
    itemsDeleted: 0,
    assetsDownloaded: 0,
    assetsFailed: 0,
  };
}

function addCounters(a: SyncCounters, b?: SyncCounters): SyncCounters {
  if (!b) return { ...a };
  const sum = zeroCounters();
  for (const k of Object.keys(sum) as (keyof SyncCounters)[]) sum[k] = a[k] + b[k];
  return sum;
}

function errorCode(err: unknown): string {
  if (err instanceof IgError) return err.code;
  if (err instanceof SyncAlreadyRunningError) return err.code;
  return "IG_UNKNOWN";
}

function toCalc(row: { id: string; viewCount: number | null; postedAt: string }): VideoForCalc {
  return { id: row.id, viewCount: row.viewCount, postedAt: row.postedAt };
}

/** Re-exported so existing server-side callers keep one import; the implementation is
 *  a pure, dependency-free function shared with the client-side first-run sources step
 *  (see `src/lib/handle.ts`'s own doc comment for why it lives outside this file). */
export { normalizeHandle };

// ---------------------------------------------------------------- locking

/** Lock identity for a run. A whole-library run needs a concrete key, not NULL — see
 *  the note on `syncJobs.lockKey`. */
export const LIBRARY_LOCK_KEY = "__library__";

/**
 * Whether a failed write is the unique index refusing a duplicate.
 *
 * The driver's message text is the FALLBACK, not the test: matching only on
 * "UNIQUE constraint failed" made "a sync is already running" depend on a string that
 * drizzle wrapping, a driver swap, or (as here) renaming the index behind the constraint
 * can change — and when it changes, a perfectly ordinary second click stops being a
 * friendly message and becomes an unhandled 500. Same shape as `media/store.ts`.
 *
 * Exported for tests: the whole point of the finding is that the message path must not be
 * the only path, and that is only provable by handing it an error with no usable message.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) return true;
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * THE CONCURRENCY INVARIANT
 *
 * Every run covers a set of channels: a run with `channel_id` set covers exactly that
 * channel, and a run with `channel_id` NULL is treated as covering the WHOLE library.
 * Two runs may hold locks at the same time only when their covered sets are disjoint —
 * i.e. only when both are single-channel runs on different channels.
 *
 * The partial unique index alone cannot express that. It keys on `lock_key`, so a library
 * run ('__library__') and a per-channel run ('chan1') are simply different keys and BOTH
 * inserts succeed — while the library run walks chan1 too. Two runs on one channel is not
 * a pacing problem, it is a corruption problem: `softDeleteMissing` compares the window
 * against the `seenExternalIds` of ITS run, so posts the other run has not reached yet get
 * marked "deleted from Instagram" and vanish from the feed. This codebase has already lost
 * 8 live @kallaway posts to a soft-delete triggered by a different false premise.
 *
 * Arbitration stays in the database — an IMMEDIATE transaction takes SQLite's write lock
 * at BEGIN, so the "is anything overlapping running?" check and the INSERT are atomic
 * against every other writer, including a second Node process or a `tsx` script. The
 * unique index stays as the backstop for the same-key case.
 */
function conflictingRun(
  rows: { id: string; channelId: string | null }[],
  channelId: string | null
): { id: string; channelId: string | null } | undefined {
  // A library run covers everything, so ANY running job overlaps it. A single-channel run
  // overlaps a library run, or another run on the same channel.
  if (channelId === null) return rows[0];
  return rows.find((r) => r.channelId === null || r.channelId === channelId);
}

async function acquireLock(channelId: string | null, lookbackDays: number): Promise<string> {
  await reapStaleLocks();
  const jobId = newId();
  try {
    db.transaction(
      (tx) => {
        // A running BACKFILL is deliberately not in this set. It holds its own lock key
        // and never enumerates a window, so it cannot cause the soft-delete damage this
        // arbitration exists to prevent, and letting it refuse a sync would mean a
        // catch-up job blocking the fetch a user is waiting on. The backfill yields to
        // the sync instead, in its own start check.
        const running = tx
          .select({ id: tables.syncJobs.id, channelId: tables.syncJobs.channelId })
          .from(tables.syncJobs)
          .where(and(eq(tables.syncJobs.status, "running"), ne(tables.syncJobs.lockKey, BACKFILL_LOCK_KEY)))
          .all();

        const clash = conflictingRun(running, channelId);
        if (clash) throw new SyncAlreadyRunningError(channelId);

        tx.insert(tables.syncJobs)
          .values({
            id: jobId,
            channelId,
            lockKey: channelId ?? LIBRARY_LOCK_KEY,
            startedAt: nowIso(),
            heartbeatAt: nowIso(),
            status: "running",
            lookbackDays,
          })
          .run();
      },
      { behavior: "immediate" }
    );
  } catch (err) {
    if (err instanceof SyncAlreadyRunningError) throw err;
    if (isUniqueViolation(err)) throw new SyncAlreadyRunningError(channelId);
    throw err;
  }
  return jobId;
}

async function reapStaleLocks(): Promise<void> {
  const cutoff = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const stale = await db
    .select({ id: tables.syncJobs.id, channelId: tables.syncJobs.channelId })
    .from(tables.syncJobs)
    .where(and(eq(tables.syncJobs.status, "running"), lt(tables.syncJobs.heartbeatAt, cutoff)));
  for (const row of stale) {
    log.warn("sync.lock.reaped", { jobId: row.id, channelId: row.channelId, staleAfterSeconds: LOCK_STALE_MS / 1000 });
    await db
      .update(tables.syncJobs)
      .set({ status: "failed", finishedAt: nowIso(), errorCode: "SYNC_ABANDONED", errorMessage: "Job had no heartbeat; assumed crashed" })
      .where(eq(tables.syncJobs.id, row.id));
    // A reaped run is stuck by definition (no heartbeat past the reaper threshold), which
    // is one of the two SLA breach signals. Wrapped so a notification write never breaks
    // the reaper, which must keep clearing locks whatever else fails.
    try {
      insertNotification({ kind: "sla_breach", runId: row.id, title: "Sync stuck", body: "No heartbeat past the stall threshold, assumed crashed and reaped." });
    } catch {
      // notifications are best effort
    }
  }
}

/**
 * Raises the run-level notifications for a finished sync (Runs and observability spec
 * 2026-08-02). Failures and partial runs always notify; a success notifies only when the
 * notifyOnSuccess setting is on. A run whose wall clock time crossed the sync SLA budget
 * raises a separate sla_breach. Never auto cancels. Callers wrap this in a try/catch: a
 * notification write must never break a sync.
 */
async function notifyRunFinished(
  jobId: string,
  status: SyncJobStatus,
  totals: { itemsCreated: number; itemsUpdated: number; itemsFailed: number },
  failBody: string | null,
): Promise<void> {
  if (status === "failed") {
    insertNotification({ kind: "run_failed", runId: jobId, title: "Sync failed", body: failBody ?? "The sync did not finish." });
  } else if (status === "partial") {
    insertNotification({ kind: "run_failed", runId: jobId, title: "Partial sync", body: `${totals.itemsFailed} item${totals.itemsFailed === 1 ? "" : "s"} failed to sync.` });
  } else if (await getSetting("notifyOnSuccess")) {
    insertNotification({ kind: "run_finished", runId: jobId, title: "Sync finished", body: `${totals.itemsCreated} new, ${totals.itemsUpdated} updated.` });
  }

  // Over budget: a completed run that took longer than its wall clock budget. evaluateSla
  // only flags a still-running run, so the finished case is computed here from the row's
  // own start and finish.
  const [row] = await db
    .select({ startedAt: tables.syncJobs.startedAt, finishedAt: tables.syncJobs.finishedAt })
    .from(tables.syncJobs)
    .where(eq(tables.syncJobs.id, jobId));
  if (row?.startedAt && row.finishedAt) {
    const budgetMinutes = await getSetting("syncSlaMinutes");
    const elapsedMs = new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime();
    if (Number.isFinite(elapsedMs) && elapsedMs > budgetMinutes * 60_000) {
      insertNotification({
        kind: "sla_breach",
        runId: jobId,
        title: "Sync over budget",
        body: `Ran ${Math.round(elapsedMs / 60_000)} min, over the ${budgetMinutes} min budget.`,
      });
    }
  }
}

// ---------------------------------------------------------------- live progress

type ProgressPatch = Partial<SyncCounters> & {
  phase?: SyncPhase;
  currentChannelHandle?: string | null;
  channelsTotal?: number;
  channelsDone?: number;
  retries?: number;
};

/**
 * The single writer of live progress. This replaced a `heartbeat()` that wrote only
 * `heartbeat_at`: the counters reached `sync_jobs` exactly once, in the terminal update,
 * so anything polling a run in flight read zeros and "Sync now" could only ever be an
 * indeterminate spinner.
 *
 * Cost is one small UPDATE per page/channel boundary. Flushing per item would put a write
 * between every post and is never worth it — the page boundary is already fine-grained
 * enough for a 1 s poll. The one exception is `flushIfDue`, which adds a write inside the
 * item loop only when the wall clock says the row has gone quiet for too long.
 */
async function progress(jobId: string, patch: ProgressPatch = {}): Promise<void> {
  await db
    .update(tables.syncJobs)
    .set({ heartbeatAt: nowIso(), ...patch })
    .where(eq(tables.syncJobs.id, jobId));
}

interface FlushPatch {
  phase?: SyncPhase;
  currentChannelHandle?: string | null;
  channelsTotal?: number;
  /** Counters of the channel currently in flight; added to the finished-channel totals. */
  counters?: SyncCounters;
}

/** Run-scoped progress state. `totals` holds finished channels only, so a flush from
 *  inside a channel adds that channel's running counters rather than double-counting. */
interface RunTracker {
  /** The run this tracker belongs to. Carried here because the tracker is already the one
   *  thing every part of a run is handed, so the per-channel and enrichment log calls can
   *  stamp their events with a run id without a second parameter threaded beside it. */
  jobId: string;
  totals: SyncCounters;
  channelsDone: number;
  retries: number;
  flush(patch?: FlushPatch): Promise<void>;
  /** Flush only if the row has been quiet for `HEARTBEAT_MAX_SILENCE_MS`. Cheap to call
   *  from inside the item loop: almost every call is a clock comparison and nothing else. */
  flushIfDue(patch?: FlushPatch): Promise<void>;
  noteRetry(): void;
  isCancelRequested(): Promise<boolean>;
}

function createTracker(jobId: string, now: () => Date, onProgress?: RunSyncOpts["onProgress"]): RunTracker {
  let lastFlushMs = now().getTime();

  const tracker: RunTracker = {
    jobId,
    totals: zeroCounters(),
    channelsDone: 0,
    retries: 0,
    async flush(patch: FlushPatch = {}) {
      const { counters, ...rest } = patch;
      lastFlushMs = now().getTime();
      await progress(jobId, {
        ...addCounters(tracker.totals, counters),
        channelsDone: tracker.channelsDone,
        retries: tracker.retries,
        ...rest,
      });
      try {
        onProgress?.({ done: tracker.channelsDone, total: rest.channelsTotal, label: rest.currentChannelHandle });
      } catch (err) {
        log.error("sync.on_progress.failed", { jobId, message: errorMessage(err) });
      }
    },
    async flushIfDue(patch: FlushPatch = {}) {
      // A page is not a unit of time. One item can burn IG_DOWNLOAD_TIMEOUT_MS on the
      // video and again on the thumbnail, so a single page of a few dozen items can be
      // silent for tens of minutes — long enough for the reaper to declare this live run
      // dead, release its lock and let a second sync loose on the same channel.
      if (now().getTime() - lastFlushMs < HEARTBEAT_MAX_SILENCE_MS) return;
      await tracker.flush(patch);
    },
    noteRetry() {
      tracker.retries += 1;
    },
    async isCancelRequested() {
      const rows = await db
        .select({ cancelRequested: tables.syncJobs.cancelRequested })
        .from(tables.syncJobs)
        .where(eq(tables.syncJobs.id, jobId))
        .limit(1);
      return rows[0]?.cancelRequested === true;
    },
  };
  return tracker;
}

/** What happened — ours to report whether or not we still own the row. */
type JobFacts = ProgressPatch & {
  finishedAt: string;
  stopReason?: StopReason | null;
  stats?: Record<string, number>;
  gaps?: SyncGap[];
};

/** What it MEANS — only the owner of a 'running' row gets to write this. */
interface JobVerdict {
  status: SyncJobStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Writes the terminal job row, but ONLY if this run still owns it.
 *
 * The unconditional version could resurrect a job the reaper had already declared dead:
 * the reap flipped the row to failed/SYNC_ABANDONED (releasing the partial unique index,
 * so a second sync could take the lock and run alongside this one), and then this run
 * finished and overwrote the row back to `success` — erasing the evidence and leaving no
 * trace that two syncs had been racing on the same channel.
 *
 * On a lost row the counters are still recorded, because the work really did happen and
 * throwing that away helps nobody — but `status`, `error_code` and `error_message` are
 * left exactly as the reaper set them. Returns false so the caller knows it was reaped.
 */
async function finalizeJob(jobId: string, facts: JobFacts, verdict: JobVerdict): Promise<boolean> {
  const result = await db
    .update(tables.syncJobs)
    .set({ ...facts, ...verdict })
    .where(and(eq(tables.syncJobs.id, jobId), eq(tables.syncJobs.status, "running")));

  if ((result as { changes?: number }).changes !== 0) return true;

  await db.update(tables.syncJobs).set(facts).where(eq(tables.syncJobs.id, jobId));
  log.error("sync.finalize.reaped", {
    jobId,
    reason: "job row was no longer 'running' when the run finished; a reaper or another writer took it",
    withheldVerdict: verdict.status,
  });
  return false;
}

// ---------------------------------------------------------------- retry

/**
 * How many retries a given failure actually deserves.
 *
 * `IG_SERVICE_DOWN` means our own localhost sidecar refused the connection. That is a
 * process that is either coming up right now or is not running at all — not a transient
 * upstream condition, and the error's own user message is an instruction to go start it.
 * One quick retry covers the "sidecar is mid-restart" case; an ever-doubling ladder just
 * makes every channel in the run wait several seconds to deliver the same instruction.
 */
function retriesFor(code: IgErrorCode, maxRetries: number, cardPull = false): number {
  if (cardPull && code === "IG_RATE_LIMITED") return 0;
  return code === "IG_SERVICE_DOWN" ? Math.min(1, maxRetries) : maxRetries;
}

function backoffMs(attempt: number, baseMs: number, err: IgError): { ms: number; hinted: boolean } {
  // When Instagram rate-limits us the sidecar returns the wait it computed
  // (detail.retry_after_sec). Guessing a shorter one just spends the quota again.
  const hint = err.detail.retry_after_sec;
  if (typeof hint === "number" && Number.isFinite(hint) && hint > 0) {
    return { ms: Math.min(Math.round(hint * 1000), MAX_BACKOFF_MS), hinted: true };
  }
  const exponential = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  // Jittered so a blip that hits several channels doesn't make them all retry in lockstep.
  return { ms: Math.round(exponential / 2 + Math.random() * (exponential / 2)), hinted: false };
}

/**
 * How often a run looks up from what it is doing — to notice a cancel, and to prove it is
 * still alive. Both signals cross a process boundary through the database (the UI sets
 * `cancel_requested`; the UI reads `heartbeat_at`), so there is nothing in-process to
 * signal on and polling is the mechanism. Two small statements per tick, and only while a
 * call is actually outstanding.
 */
const CANCEL_POLL_SLICE_MS = 500;

/**
 * A run stopped by the user rather than by a failure. Deliberately NOT an `IgError`: it
 * must never be retried, and the channel it interrupted is not a "gap" — nothing about
 * that channel is broken, we just stopped asking.
 */
class SyncCancelledError extends Error {
  constructor() {
    super("Sync cancelled by the user");
    this.name = "SyncCancelledError";
  }
}

/**
 * A `setTimeout` whose wait can be ended early. `clear()` both cancels the timer and
 * releases whoever is awaiting it, so a watcher never outlives the call it watches — an
 * armed timer per upstream call would keep the event loop alive after the work is done.
 */
function cancellableDelay(ms: number): { promise: Promise<void>; clear: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
    handle = setTimeout(resolve, ms);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(handle);
      release();
    },
  };
}

/**
 * Runs one upstream call while keeping the job row alive and watchable.
 *
 * The live run that motivated this: attempts were ~65 seconds apart, and almost all of
 * that was ONE in-flight request to Instagram — not the ~1 s backoff between them. So the
 * two things that must not be blocked by a slow call are:
 *
 *  - Cancel. The user clicked stop 13 seconds into a 65-second request; waiting for that
 *    request to fail before noticing is a Cancel button that visibly does nothing.
 *  - The heartbeat. A healthy run mid-request was measured at `heartbeat_age_s = 55`,
 *    which at 90 s would have the UI declare a working sync dead and offer recovery for a
 *    problem that does not exist.
 *
 * `tick` does both (flush-if-due, then report whether a cancel is pending) on a real
 * timer — deliberately not the injectable `sleep` seam, which means pacing and backoff,
 * not liveness.
 *
 * On cancel the in-flight promise is ABANDONED, not aborted: nothing downstream of the
 * await runs, so no partial write can happen, and the request dies on its own existing
 * `AbortSignal.timeout`. A true abort would mean threading a signal through `IgClient`
 * (`ig/client.ts`, another pane's file, and an interface every test stub implements) for
 * no additional safety on this path.
 */
async function withLiveness<T>(fn: () => Promise<T>, tick: () => Promise<boolean>): Promise<T> {
  let done = false;
  let napping: { clear: () => void } | null = null;
  const call = fn().finally(() => {
    done = true;
    // Wake the watcher immediately rather than leaving its timer armed for another tick.
    napping?.clear();
  });

  const watcher = (async () => {
    for (;;) {
      const nap = cancellableDelay(CANCEL_POLL_SLICE_MS);
      napping = nap;
      await nap.promise;
      napping = null;
      if (done) return false;
      if (await tick()) return true;
    }
  })();

  const cancelled = await Promise.race([call.then(() => false), watcher]);
  if (!cancelled) return call;

  // The orphan must not surface as an unhandled rejection when it eventually gives up.
  call.catch(() => {});
  throw new SyncCancelledError();
}

/** Returns true if the backoff wait was cut short by a cancel. */
async function sleepUnlessCancelled(
  totalMs: number,
  sleep: (ms: number) => Promise<void>,
  cancelled: () => Promise<boolean>
): Promise<boolean> {
  let remaining = totalMs;
  while (remaining > 0) {
    const slice = Math.min(remaining, CANCEL_POLL_SLICE_MS);
    await sleep(slice);
    remaining -= slice;
    if (await cancelled()) return true;
  }
  return false;
}

/**
 * Retries a single upstream call while `IgError.retryable` says it's worth it.
 *
 * That flag has existed since the sidecar was written and nothing ever acted on it, so
 * one network blip cost a whole channel — and the user still had to wait out the rest of
 * the run to be told. Everything else (IG_PRIVATE, IG_NOT_FOUND, a rejected token) fails
 * fast on the first attempt: waiting cannot change the answer.
 *
 * Total time spent GUESSING at a backoff is capped at `baseMs * maxRetries`, so a dead
 * upstream costs a bounded few seconds per call instead of an ever-doubling wait — the
 * complaint being fixed here is "I don't want to wait hours just to receive a network
 * error", and a retry loop is perfectly capable of recreating it. A wait Instagram
 * actually asked for (retry_after_sec) is exempt: that number is not a guess.
 *
 * A cancel ends the ladder immediately, both between attempts and during a backoff. Two
 * reasons, and the second is the stronger one: a Cancel button that visibly does nothing
 * for a minute is the same broken promise as the old spinner, AND retrying after the user
 * said stop means issuing more authenticated requests at Instagram — real ban risk spent
 * on work nobody wants the result of. The original failure is rethrown, so the channel
 * still reports why it was failing rather than a synthetic "cancelled" error.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  o: {
    maxRetries: number;
    baseMs: number;
    sleep: (ms: number) => Promise<void>;
    cancelled: () => Promise<boolean>;
    cardPull?: boolean;
    onRetry: (info: { attempt: number; delayMs: number; error: IgError }) => Promise<void>;
    onAbandon: (info: { error: IgError; during: "wait" | "decision" }) => void;
  }
): Promise<T> {
  const guessBudgetMs = o.baseMs * o.maxRetries;
  let guessedSoFar = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof IgError) || !err.retryable || attempt >= retriesFor(err.code, o.maxRetries, o.cardPull)) throw err;

      // Checked BEFORE the retry is even scheduled: the remaining budget belongs to a run
      // the user has not stopped.
      if (await o.cancelled()) {
        o.onAbandon({ error: err, during: "decision" });
        throw err;
      }

      const backoff = backoffMs(attempt, o.baseMs, err);
      let delayMs = backoff.ms;
      if (!backoff.hinted) {
        delayMs = Math.max(0, Math.min(delayMs, guessBudgetMs - guessedSoFar));
        guessedSoFar += delayMs;
      }
      await o.onRetry({ attempt: attempt + 1, delayMs, error: err });

      if (await sleepUnlessCancelled(delayMs, o.sleep, o.cancelled)) {
        o.onAbandon({ error: err, during: "wait" });
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------- upsert

function mediaUrl(m: IgMedia): string {
  if (m.url) return m.url;
  return m.shortcode ? `https://www.instagram.com/p/${m.shortcode}/` : "";
}

/** The reels an enrichment pass should ask about, newest first.
 *
 *  Scoped to `clips`. That is the only `product_type` the spike confirmed carries a real
 *  play count on the single-media endpoint, and asking about anything else spends a live
 *  request to learn nothing.
 *
 *  Rows with `deletedAt` set are excluded because a prior sync already saw them removed
 *  from Instagram, so the endpoint answers `MediaNotFound`, correctly.
 *
 *  Deliberately NOT filtered to rows where `viewCount` is null. A play count grows after
 *  a post lands, so the newest reels are worth re-reading even when they already carry a
 *  number. Freshness on the reels the user actually looks at is the point of the cap. */
async function enrichmentCandidates(channelId: string, limit: number): Promise<{ id: string; externalId: string }[]> {
  if (limit <= 0) return [];
  return db
    .select({ id: tables.videos.id, externalId: tables.videos.externalId })
    .from(tables.videos)
    .where(
      and(
        eq(tables.videos.channelId, channelId),
        eq(tables.videos.productType, "clips"),
        isNull(tables.videos.deletedAt)
      )
    )
    .orderBy(desc(tables.videos.postedAt))
    .limit(limit);
}

/**
 * How many CONSECUTIVE `IG_NOT_FOUND` answers end the pass.
 *
 * One missing media is ordinary — a prior sync may not have noticed a deletion yet, and
 * exactly that case is why a single skip does not stop anything. Three IN A ROW is a
 * different claim: a channel does not lose the three newest reels of its scoring window
 * back to back between two syncs, so the likelier reading is that the burner is
 * action-blocked and every media answers MediaNotFound. Confirming that over a 200-reel
 * budget costs 200 authenticated requests from an account already in trouble, and learns
 * nothing the third answer had not already said.
 */
export const ENRICH_MAX_CONSECUTIVE_SKIPS = 3;

/** What one enrichment pass did. `withheld` is separate from `skipped` on purpose: a reel
 *  Instagram answered for but gave no play count is not the same event as one that is
 *  gone, and folding them together made a channel where EVERY count came back withheld log
 *  byte-identically to a channel with nothing to do. This whole feature exists because a
 *  measurement was ambiguous. */
interface EnrichResult {
  /** How many reels the pass set out to ask about. Separates "asked and got nothing" from
   *  "there was nothing to ask about". */
  candidates: number;
  enriched: number;
  /** Answered `IG_NOT_FOUND`: that post is gone from Instagram. */
  skipped: number;
  /** Answered, but with no play count. Instagram withheld it. */
  withheld: number;
  stopped: boolean;
}

/** Asks Instagram about each of a channel's newest reels individually, to get the play
 *  count the listing endpoint withholds.
 *
 *  Runs before `recomputeChannelScores` so the scores this sync computes already see the
 *  numbers this pass wrote. That ordering is also why the pass lives in this file at all:
 *  `score-recompute-guard.test.ts` allows only this file and `media-actions.ts` to write
 *  `tables.videos`, and `view_count` is the column scores derive from.
 *
 *  Never throws. Not on an upstream failure, not on a read or write of `videos`, and not
 *  on the run's own heartbeat or cancel check either — all four can fail, and every one of
 *  them is caught here and turned into a `stopped` flag. The page walk has already done the
 *  sync's real work by the time this runs, and failing a whole channel over a view count
 *  would trade a gap in the feed for a vanity metric. That is also why the cancel check is
 *  a plain predicate and NOT `upstream()` / `withLiveness`: those raise
 *  `SyncCancelledError`, and a throw out of here is the one thing this function promises
 *  never to do. */
async function enrichViewCounts(
  channelId: string,
  deps: {
    client: Pick<IgClient, "fetchMediaStats">;
    sleep: (ms: number) => Promise<void>;
    limit: number;
    /** True once the user has asked the run to stop. Consulted per reel, because the pass
     *  is the longest stretch of authenticated requests left in a run by the time it
     *  starts, and continuing it is exactly the "ban risk spent on work nobody wants"
     *  that `withRetry` refuses. */
    shouldStop: () => Promise<boolean>;
    /** Heartbeat, one per reel. The pass sits between two flushes with nothing in
     *  between, and at a second or more per reel it can outlast `SYNC_STALL_SECONDS`
     *  (the UI calls a live run dead) and then `LOCK_STALE_MS` (another run steals the
     *  lock and its `softDeleteMissing` buries posts it never reached). */
    tick: () => Promise<void>;
    /** The run whose trace these events belong to. Optional so a test can call the pass on
     *  its own; every production call site is inside a run and passes it. */
    runId?: string;
  }
): Promise<EnrichResult> {
  let enriched = 0;
  let skipped = 0;
  let withheld = 0;
  let consecutiveSkips = 0;

  let candidates: { id: string; externalId: string }[];
  try {
    candidates = await enrichmentCandidates(channelId, deps.limit);
  } catch (err) {
    log.error("sync.enrich.stopped", {
      channelId,
      code: errorCode(err),
      message: errorMessage(err),
      reason: "could not read the candidate reels; skipping the pass",
    }, deps.runId);
    return { candidates: 0, enriched, skipped, withheld, stopped: true };
  }

  const result = (stopped: boolean): EnrichResult => ({
    candidates: candidates.length,
    enriched,
    skipped,
    withheld,
    stopped,
  });

  for (const [index, row] of candidates.entries()) {
    // Both of these touch the database in production — `tick` is `tracker.flushIfDue`,
    // which writes the job row through `progress()`, and `shouldStop` is
    // `tracker.isCancelRequested`, which reads it — so both can throw, and letting either
    // escape would be this function's own promise breaking in the most ironic way
    // available: `syncOneChannel`'s catch would turn a page walk that fully succeeded into
    // stopReason "error", a SyncGap and a `sync_error` on the channel row, over a view
    // count. A run whose heartbeat is failing is in trouble anyway; ending the pass is
    // both the honest and the cheap response, and the flush right after this block will
    // surface the real problem.
    let stop: boolean;
    try {
      await deps.tick();
      stop = await deps.shouldStop();
    } catch (err) {
      log.error("sync.enrich.tracker_failed", {
        channelId,
        code: errorCode(err),
        message: errorMessage(err),
        enriched,
        skipped,
        withheld,
        reason: "the run's own heartbeat or cancel check failed; ending the pass",
      }, deps.runId);
      return result(true);
    }

    if (stop) {
      log.info("sync.enrich.cancelled", {
        channelId,
        enriched,
        skipped,
        withheld,
        remaining: candidates.length - index,
        reason: "the user stopped the run; not spending more live requests on it",
      }, deps.runId);
      return result(true);
    }

    // Paced apart, and never before the first request.
    //
    // `jitterMs` is REUSED here, not sized for here: its constants were chosen for one
    // request per page of ~33 items, and this loop fires one request per reel — a much
    // higher-frequency call at roughly 1.5 requests/second sustained. The sidecar's own
    // docstring says "the caller paces", and this is the caller. Deliberately not a new
    // knob: `VIEW_COUNT_ENRICH_PER_CHANNEL` already bounds how long that rate can last.
    if (index > 0) await deps.sleep(jitterMs());

    let stats: IgMediaStats;
    try {
      stats = await deps.client.fetchMediaStats(row.externalId);
    } catch (err) {
      if (errorCode(err) === "IG_NOT_FOUND") {
        // That one post is gone from Instagram. A prior sync may not have noticed yet.
        skipped += 1;
        consecutiveSkips += 1;
        if (consecutiveSkips >= ENRICH_MAX_CONSECUTIVE_SKIPS) {
          // Logged under its own event name, not the upstream one below, because a run of
          // missing media and an explicit back-off signal want different reactions.
          //
          // This deliberately does NOT name a cause. It used to say "that reads as a
          // blocked account", which was a guess presented as a finding, and the first time
          // it fired in anger the real cause was something else entirely: a sidecar older
          // than the endpoint being called, whose routing 404 looked exactly like a
          // deleted post. That specific confusion is now impossible, since a routing miss
          // arrives as IG_ROUTE_NOT_FOUND and takes the stop path below. The lesson the
          // wording keeps is narrower: report what was observed, let a human diagnose.
          log.warn("sync.enrich.stopped_missing", {
            channelId,
            externalId: row.externalId,
            consecutiveSkips,
            enriched,
            skipped,
            withheld,
            reason: `${ENRICH_MAX_CONSECUTIVE_SKIPS} consecutive medias came back missing, which is too many to be ordinary deletions; stopping rather than guessing why`,
          }, deps.runId);
          return result(true);
        }
        continue;
      }
      log.warn("sync.enrich.stopped", {
        channelId,
        externalId: row.externalId,
        code: errorCode(err),
        enriched,
        skipped,
        withheld,
        reason: "upstream said stop; leaving the rest for the next sync",
      }, deps.runId);
      return result(true);
    }
    // Instagram answered about this media, so whatever run of misses preceded it was
    // ordinary deletions rather than a wall.
    consecutiveSkips = 0;

    // `fetchMediaStats` already maps a zero to null. Writing that null would repeat the
    // bug that turned a genuine 2.27M-view reel into 0 on the first live run.
    if (stats.viewCount == null) {
      withheld += 1;
      continue;
    }

    try {
      await db
        .update(tables.videos)
        .set({ viewCount: stats.viewCount, lastRefreshedAt: nowIso() })
        .where(eq(tables.videos.id, row.id));
    } catch (err) {
      // A failing write is not something the next reel will fix, and carrying on would
      // spend the rest of the budget on requests whose answers cannot be stored.
      log.error("sync.enrich.write_failed", {
        channelId,
        externalId: row.externalId,
        code: errorCode(err),
        message: errorMessage(err),
        reason: "could not store the play count; ending the pass",
      }, deps.runId);
      return result(true);
    }
    enriched += 1;
  }

  return result(false);
}

/**
 * Inserts or updates one post keyed on (platform, external_id) — Instagram's media pk.
 * Returns whether the row was newly created, so the caller can prove idempotence:
 * a second consecutive sync must report itemsCreated = 0.
 */
async function upsertVideo(
  channelId: string,
  m: IgMedia,
  assets: { thumbnailAssetId: string | null; videoAssetId: string | null }
): Promise<{ id: string; created: boolean; viewCount: number | null; likeCount: number | null; commentCount: number | null }> {
  const existing = await db
    .select({
      id: tables.videos.id,
      thumbnailAssetId: tables.videos.thumbnailAssetId,
      videoAssetId: tables.videos.videoAssetId,
      viewCount: tables.videos.viewCount,
      likeCount: tables.videos.likeCount,
      commentCount: tables.videos.commentCount,
    })
    .from(tables.videos)
    .where(and(eq(tables.videos.platform, "instagram"), eq(tables.videos.externalId, m.externalId)))
    .limit(1);

  const common = {
    channelId,
    shortcode: m.shortcode,
    mediaType: m.mediaType,
    productType: m.productType,
    url: mediaUrl(m),
    caption: m.caption,
    postedAt: m.takenAt,
    durationSec: m.durationSec == null ? null : Math.round(m.durationSec),
    viewCount: m.viewCount,
    likeCount: m.likeCount,
    commentCount: m.commentCount,
    rawPayload: m.raw,
    rawFetchedAt: nowIso(),
    // A post reappearing after being soft-deleted is undeleted rather than duplicated.
    deletedAt: null,
    lastRefreshedAt: nowIso(),
  };

  if (existing[0]) {
    const row = existing[0];
    // A metric Instagram withheld this time (null) must not erase one we already
    // have. This is not hypothetical: Instagram returns 0 for other creators' play
    // counts in many contexts, which wiped a genuine 2.27M-view figure on the first
    // live run and would have zeroed every outlier score.
    const viewCount = m.viewCount ?? row.viewCount;
    const likeCount = m.likeCount ?? row.likeCount;
    const commentCount = m.commentCount ?? row.commentCount;
    await db
      .update(tables.videos)
      .set({
        ...common,
        viewCount,
        likeCount,
        commentCount,
        // Keep the asset we already have when this pass didn't fetch a new one, so a
        // transient download failure can't wipe a good thumbnail.
        thumbnailAssetId: assets.thumbnailAssetId ?? row.thumbnailAssetId,
        videoAssetId: assets.videoAssetId ?? row.videoAssetId,
      })
      .where(eq(tables.videos.id, row.id));
    return { id: row.id, created: false, viewCount, likeCount, commentCount };
  }

  const id = newId();
  await db.insert(tables.videos).values({
    id,
    platform: "instagram",
    externalId: m.externalId,
    ...common,
    thumbnailAssetId: assets.thumbnailAssetId,
    videoAssetId: assets.videoAssetId,
    firstSeenAt: nowIso(),
  });
  return { id, created: true, viewCount: m.viewCount, likeCount: m.likeCount, commentCount: m.commentCount };
}

/**
 * Which thumbnails on a page we already hold: a post's `externalId`, or
 * `${postExternalId}/${childExternalId}` for a carousel slide. A re-sync used to fetch
 * every one of them again only for the sidecar to hash the bytes and report a dedupe;
 * on the live 358-post library run that was 523 of 646 downloads and about half the
 * wall clock. Posts whose thumbnail never landed are left out, so a failed download
 * is retried on the next sync.
 */
async function storedThumbs(externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const inPage = and(eq(tables.videos.platform, "instagram"), inArray(tables.videos.externalId, externalIds));
  const posts = await db
    .select({ externalId: tables.videos.externalId })
    .from(tables.videos)
    .where(and(inPage, isNotNull(tables.videos.thumbnailAssetId)));
  const slides = await db
    .select({ post: tables.videos.externalId, externalId: tables.videoChildren.externalId })
    .from(tables.videoChildren)
    .innerJoin(tables.videos, eq(tables.videoChildren.videoId, tables.videos.id))
    .where(and(inPage, isNotNull(tables.videoChildren.thumbnailAssetId)));
  return new Set([...posts.map((p) => p.externalId), ...slides.map((s) => `${s.post}/${s.externalId}`)]);
}

/** Carousel children: one row per slide, keyed on (video_id, position). */
async function upsertChildren(
  videoId: string,
  m: IgMedia,
  downloadThumb: (url: string | null) => Promise<{ assetId: string | null; failed: boolean }>
): Promise<{ assetsDownloaded: number; assetsFailed: number }> {
  let assetsDownloaded = 0;
  let assetsFailed = 0;

  for (const child of m.children) {
    const thumb = await downloadThumb(child.thumbnailUrl);
    if (thumb.assetId) assetsDownloaded += 1;
    if (thumb.failed) assetsFailed += 1;

    const existing = await db
      .select({ id: tables.videoChildren.id, thumbnailAssetId: tables.videoChildren.thumbnailAssetId })
      .from(tables.videoChildren)
      .where(and(eq(tables.videoChildren.videoId, videoId), eq(tables.videoChildren.externalId, child.externalId)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(tables.videoChildren)
        .set({
          position: child.position,
          mediaType: child.mediaType,
          thumbnailAssetId: thumb.assetId ?? existing[0].thumbnailAssetId,
          rawPayload: child.raw,
        })
        .where(eq(tables.videoChildren.id, existing[0].id));
    } else {
      await db.insert(tables.videoChildren).values({
        id: newId(),
        videoId,
        position: child.position,
        externalId: child.externalId,
        mediaType: child.mediaType,
        thumbnailAssetId: thumb.assetId,
        rawPayload: child.raw,
      });
    }
  }

  return { assetsDownloaded, assetsFailed };
}

/**
 * Called after every channel sync, and by `importSingleReel` after a one-off import.
 * Not the path a settings change uses — see `recomputeAllChannelScoresSync` below for
 * that; this async version reads `app_settings` through the ordinary (non-transactional)
 * `getScoringOptions`, which is exactly right here because a sync isn't racing a
 * settings write for the same rows.
 */
export async function recomputeChannelScores(channelId: string): Promise<number | null> {
  const rows = await db
    .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
    .from(tables.videos)
    .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)));
  const calc = rows.map(toCalc);
  // Baseline method, window, minimum usable posts and views floor all come from
  // app_settings (src/server/settings) — this is the one place scoring reads them, so a
  // setting change takes effect on every channel's next sync without a code change.
  const scoringOptions = await getScoringOptions();
  const scores = scoreVideosAgainstBaseline(calc, scoringOptions);
  for (const row of rows) {
    await db.update(tables.videos).set({ outlierScore: scores.get(row.id) ?? null }).where(eq(tables.videos.id, row.id));
  }
  return computeChannelBaseline(calc, scoringOptions);
}

/** The transaction handle `db.transaction`'s callback receives — better-sqlite3's
 *  driver requires that callback to be synchronous, so every function below that takes
 *  one must use `.all()` / `.run()`, never `await`, exactly like `acquireLock` above. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function recomputeChannelScoresSync(tx: Tx, channelId: string, scoringOptions: ScoringOptions): void {
  const rows = tx
    .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
    .from(tables.videos)
    .where(and(eq(tables.videos.channelId, channelId), isNull(tables.videos.deletedAt)))
    .all();
  const calc = rows.map(toCalc);
  const scores = scoreVideosAgainstBaseline(calc, scoringOptions);
  for (const row of rows) {
    tx.update(tables.videos).set({ outlierScore: scores.get(row.id) ?? null }).where(eq(tables.videos.id, row.id)).run();
  }
}

/**
 * The synchronous, transaction-safe twin of the recompute loop, for exactly one
 * caller: `updateAppSettingsAction` in `src/server/actions/settings-actions.ts` runs
 * this INSIDE the same `db.transaction` that writes the changed settings rows, so a
 * settings save that changes what a score means is atomic — either the new settings
 * and every recomputed score land together, or (on any error) better-sqlite3 rolls the
 * whole transaction back and NOTHING changes, including the settings rows written
 * earlier in the same transaction. There is no state where the setting is saved but
 * only some channels' scores reflect it, and no state where a thrown error is silent:
 * a rollback surfaces as the thrown error propagating out of `db.transaction`, which
 * `updateAppSettingsAction` turns into `{ ok: false, error }`.
 *
 * `scoringOptions` is passed in, not re-derived here, because the caller has already
 * resolved it (via `resolveAllSettings`/`scoringOptionsFromSettings`) from the rows it
 * just wrote in this same transaction — recomputing it a second time from inside this
 * function would either re-read those rows redundantly or, worse, invite a version that
 * reads them a different way and drifts from the caller's own resolution.
 */
export function recomputeAllChannelScoresSync(tx: Tx, scoringOptions: ScoringOptions): void {
  const channelRows = tx.select({ id: tables.channels.id }).from(tables.channels).all();
  for (const { id } of channelRows) {
    recomputeChannelScoresSync(tx, id, scoringOptions);
  }
}

/**
 * Marks posts that were inside the lookback window but did not come back this run.
 * Scoped to the window on purpose: older rows are out of this run's remit and must not
 * be flagged deleted just because we didn't ask about them.
 */
async function softDeleteMissing(channelId: string, boundaryIso: string, seenExternalIds: string[], runId?: string): Promise<number> {
  const candidates = await db
    .select({ id: tables.videos.id, externalId: tables.videos.externalId })
    .from(tables.videos)
    .where(
      and(
        eq(tables.videos.channelId, channelId),
        gte(tables.videos.postedAt, boundaryIso),
        isNull(tables.videos.deletedAt)
      )
    );

  const seen = new Set(seenExternalIds);
  const missing = candidates.filter((c) => !seen.has(c.externalId));
  if (missing.length === 0) return 0;

  const now = nowIso();
  await db
    .update(tables.videos)
    .set({ deletedAt: now })
    .where(inArray(tables.videos.id, missing.map((m) => m.id)));

  log.info("sync.soft_deleted", { channelId, count: missing.length }, runId);
  return missing.length;
}

/** Saves where an interrupted deep crawl should resume: the cursor to fetch next, the
 *  boundary it was walking (so the resumed walk keeps the same window), when it was saved
 *  (a TTL guard), and which run left it (for logs). Cleared by `clearCursor` once the
 *  window is fully enumerated. */
async function persistCursor(channelId: string, cursor: string | null, boundary: string, runId: string, at: string): Promise<void> {
  await db
    .update(tables.channels)
    .set({ syncCursor: cursor, syncBoundary: boundary, syncCursorAt: at, syncCursorRunId: runId })
    .where(eq(tables.channels.id, channelId));
}

/** Clears the resume cursor once a run has fully enumerated the window, so the next run
 *  starts a fresh newest-first walk rather than resuming a finished crawl. */
async function clearCursor(channelId: string): Promise<void> {
  await db
    .update(tables.channels)
    .set({ syncCursor: null, syncBoundary: null, syncCursorAt: null, syncCursorRunId: null })
    .where(eq(tables.channels.id, channelId));
}

type ThumbResult = { assetId: string | null; failed: boolean };

interface ChannelPull {
  profile: IgProfile;
  items: IgMedia[];
  /** Thumbnail URLs of in-cap posts and slides the DB holds no asset for yet. */
  missingThumbs: Set<string>;
}

async function knownExternalIds(externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await db
    .select({ externalId: tables.videos.externalId })
    .from(tables.videos)
    .where(and(eq(tables.videos.platform, "instagram"), inArray(tables.videos.externalId, externalIds)));
  return new Set(rows.map((r) => r.externalId));
}

async function storeChannelPull(
  channel: ChannelRow,
  pull: CompletePull<ChannelPull>,
  ctx: { counters: SyncCounters; tracker: RunTracker; assetDeps: EnsureAssetDeps; runId: string }
): Promise<string[]> {
  const { profile, items, missingThumbs } = pull.rows;
  const { counters, tracker, runId } = ctx;
  const avatar = await tryEnsureAsset(profile.avatarUrl, "avatar", { channelHandle: channel.handle }, ctx.assetDeps);
  if (avatar.assetId) counters.assetsDownloaded += 1;
  if (avatar.failed) counters.assetsFailed += 1;
  // Fetched in parallel on `thumbQueue`, then the item loop below runs serially against the
  // results. A URL with no entry (already stored, or none given) reads as "not fetched",
  // which upsertVideo and upsertChildren treat as "keep the asset".
  const thumbs = new Map(
    await thumbQueue.addAll(
      [...missingThumbs].map((url) => async () => {
        const result = await tryEnsureAsset(url, "thumbnail", { channelHandle: channel.handle }, ctx.assetDeps);
        // A download can take up to IG_DOWNLOAD_TIMEOUT_MS; keep the row alive meanwhile.
        await tracker.flushIfDue({ phase: "saving", counters });
        return [url, result] as const;
      })
    )
  );
  await db
    .update(tables.channels)
    .set({
      externalId: profile.externalId,
      displayName: profile.displayName,
      avatarAssetId: avatar.assetId ?? channel.avatarAssetId,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      mediaCount: profile.mediaCount,
      bio: profile.bio,
      isVerified: profile.isVerified,
      isPrivate: profile.isPrivate,
      syncError: null,
      syncErrorCode: null,
      lastSyncedAt: nowIso(),
    })
    .where(eq(tables.channels.id, channel.id));

  const thumbOf = async (url: string | null): Promise<ThumbResult> => (url && thumbs.get(url)) || { assetId: null, failed: false };
  // Collected across the pull and flushed in one multi-row insert below, instead of one
  // `videoSnapshots` insert per item (Goal 3 T4). upsertVideo stays per item: it returns
  // the id and created/updated distinction the counters need, and it isolates a bad row.
  const snapshots: VideoSnapshotInsert[] = [];
  const seen: string[] = [];
  for (const item of items) {
    await tracker.flushIfDue({ phase: "saving", counters });
    try {
      const thumb = await thumbOf(item.thumbnailUrl);
      if (thumb.assetId) counters.assetsDownloaded += 1;
      if (thumb.failed) counters.assetsFailed += 1;

      // Videos are on-demand by default (brief §5 / Q3): the file is fetched on first
      // play, not during sync. EAGER_VIDEO_DOWNLOAD flips that for users who would
      // rather spend the disk.
      let videoAssetId: string | null = null;
      if (config.EAGER_VIDEO_DOWNLOAD && item.videoUrl) {
        const vid = await tryEnsureAsset(item.videoUrl, "video", { videoExternalId: item.externalId }, ctx.assetDeps);
        videoAssetId = vid.assetId;
        if (vid.assetId) counters.assetsDownloaded += 1;
        if (vid.failed) counters.assetsFailed += 1;
      }

      const up = await upsertVideo(channel.id, item, { thumbnailAssetId: thumb.assetId, videoAssetId });
      if (up.created) counters.itemsCreated += 1;
      else counters.itemsUpdated += 1;

      if (item.children.length > 0) {
        const childAssets = await upsertChildren(up.id, item, thumbOf);
        counters.assetsDownloaded += childAssets.assetsDownloaded;
        counters.assetsFailed += childAssets.assetsFailed;
      }

      snapshots.push({ id: newId(), videoId: up.id, capturedAt: nowIso(), viewCount: up.viewCount, likeCount: up.likeCount, commentCount: up.commentCount });
      seen.push(item.externalId);
    } catch (err) {
      // One malformed or unwritable post must not end the channel's sync.
      counters.itemsFailed += 1;
      log.error("sync.item.failed", { channelId: channel.id, externalId: item.externalId, code: errorCode(err), message: errorMessage(err) }, runId);
    }
  }

  // If the batch throws (one poison row in the mix), fall back to inserting the rows one
  // at a time so that single bad row costs one item, not the rest. Its video row was
  // already upserted above; only the snapshot is lost, and it is counted.
  if (snapshots.length > 0) {
    try {
      await insertVideoSnapshots(snapshots);
    } catch (batchErr) {
      log.warn("sync.snapshots.batchFailed", { channelId: channel.id, count: snapshots.length, code: errorCode(batchErr), message: errorMessage(batchErr) }, runId);
      for (const row of snapshots) {
        try {
          await insertVideoSnapshots([row]);
        } catch (rowErr) {
          counters.itemsFailed += 1;
          log.error("sync.snapshot.failed", { channelId: channel.id, videoId: row.videoId, code: errorCode(rowErr), message: errorMessage(rowErr) }, runId);
        }
      }
    }
  }
  await tracker.flush({ phase: "saving", counters });
  return seen;
}

// ---------------------------------------------------------------- per-channel

async function syncOneChannel(
  channel: ChannelRow,
  opts: Required<Pick<RunSyncOpts, "lookbackDays" | "maxItems">> & {
    client: IgClient;
    sleep: (ms: number) => Promise<void>;
    assetDeps: EnsureAssetDeps;
    now: () => Date;
    tracker: RunTracker;
    /** How many of this channel's newest reels the view-count pass may ask about. Resolved
     *  once per run from the `viewCountEnrichPerChannel` setting, not read from `config`
     *  here, so a stored row takes effect on the next sync with no restart. */
    enrichPerChannel: number;
    /** Hours since the last full walk within which this run may stop early at known posts. */
    metricsFreshnessHours: number;
    cardPull: boolean;
  }
): Promise<{ gap?: SyncGap; counters: SyncCounters; stopReason: StopReason | null }> {
  const counters = zeroCounters();
  const { tracker } = opts;
  /** Stamped on every event below so a run's trace is the whole run. Without it the Runs
   *  page could only show the handful of emitters that happen to put a jobId in their
   *  fields — the run-level ones — and a channel that failed left no line in its own run. */
  const runId = tracker.jobId;
  // A card pull's Stop lets the rival in hand finish; the worker stops before the next one.
  const cancelledMidChannel = (): Promise<boolean> => (opts.cardPull ? Promise.resolve(false) : tracker.isCancelRequested());

  const lookbackMs = opts.lookbackDays * 86_400_000;
  const freshBoundary = new Date(opts.now().getTime() - lookbackMs).toISOString();

  // Resume an interrupted deep crawl. Re-read the row (not the ChannelRow captured at run
  // start, which can be stale) for a cursor a prior run left below its stopping point.
  // Resume ONLY when a cursor exists AND it is younger than the lookback window: a TTL
  // guard so a long-abandoned crawl does a fresh full walk rather than resuming a boundary
  // that no longer covers today's window. On resume the STORED boundary is reused so the
  // walk enumerates the same window it started, not a shifted one.
  const [saved] = await db
    .select({ syncCursor: tables.channels.syncCursor, syncBoundary: tables.channels.syncBoundary, syncCursorAt: tables.channels.syncCursorAt })
    .from(tables.channels)
    .where(eq(tables.channels.id, channel.id));
  const cursorAgeMs = saved?.syncCursorAt ? opts.now().getTime() - new Date(saved.syncCursorAt).getTime() : Infinity;
  const resumed = Boolean(saved?.syncCursor) && cursorAgeMs < lookbackMs;
  const boundary = resumed ? saved?.syncBoundary ?? freshBoundary : freshBoundary;

  log.info("sync.channel.started", { channelId: channel.id, handle: channel.handle, boundary, lookbackDays: opts.lookbackDays, resumed }, runId);
  if (resumed) {
    log.info("sync.resume", { channelId: channel.id, cursor: saved?.syncCursor }, runId);
  }

  // Incremental walk: this run may stop paging once it reaches already-known posts, but only
  // while the last FULL walk is recent enough that no in-window post's snapshot has gone
  // stale. Past `metricsFreshnessHours` this is false, so the run walks the whole window and
  // refreshes every post's view/like snapshot, which is what keeps outlier scores honest.
  // Never during a resume: that walk is deliberately re-fetching known top posts to reach
  // the un-fetched older ones below its cursor.
  const freshnessMs = opts.metricsFreshnessHours * 3_600_000;
  const fullSyncFresh =
    channel.lastFullSyncAt != null && opts.now().getTime() - new Date(channel.lastFullSyncAt).getTime() < freshnessMs;

  /** Every upstream call that is worth retrying goes through here, so the retry count and
   *  the "retrying" phase reach the job row the user is watching. */
  const attempt = <T>(label: string, fn: () => Promise<T>): Promise<T> =>
    withRetry(fn, {
      maxRetries: config.SYNC_MAX_RETRIES,
      baseMs: config.SYNC_RETRY_BASE_MS,
      sleep: opts.sleep,
      cancelled: cancelledMidChannel,
      cardPull: opts.cardPull,
      onAbandon: ({ error, during }) => {
        log.info("sync.retry.abandoned", {
          channelId: channel.id,
          handle: channel.handle,
          call: label,
          during,
          code: error.code,
          reason: "cancel requested; not spending more requests at Instagram on a run the user stopped",
        }, runId);
      },
      onRetry: async ({ attempt: n, delayMs, error }) => {
        tracker.noteRetry();
        log.warn("sync.retry", {
          channelId: channel.id,
          handle: channel.handle,
          call: label,
          attempt: n,
          of: config.SYNC_MAX_RETRIES,
          delayMs,
          code: error.code,
        }, runId);
        await tracker.flush({ phase: "retrying", counters });
      },
    });

  /**
   * One upstream call, retried when worthwhile, and watched while it is outstanding so a
   * slow request can neither swallow a cancel nor let the row look dead. `phase` is what
   * the row should say while this particular call is in flight.
   */
  const upstream = <T>(label: string, phase: SyncPhase, fn: () => Promise<T>): Promise<T> =>
    attempt(label, () =>
      withLiveness(fn, async () => {
        await tracker.flushIfDue({ phase, counters });
        return cancelledMidChannel();
      })
    );

  let cursor: string | undefined = resumed ? saved?.syncCursor ?? undefined : undefined;
  let pageNextCursor: string | null = null;
  let stopReason: StopReason | null = null;

  const walk = async (): Promise<PullResult<ChannelPull, unknown>> => {
    const items: IgMedia[] = [];
    const missingThumbs = new Set<string>();
    let pages = 0;
    let profile: IgProfile | undefined;
    try {
      profile = await upstream("profile", "profile", () => opts.client.profile(channel.handle));

      for (;;) {
        await tracker.flush({ phase: "fetching", counters });
        const pageCursor = cursor;
        const page = await upstream("medias", "fetching", () =>
          opts.client.medias({
            handle: channel.handle,
            sinceIso: boundary,
            maxItems: opts.maxItems - counters.itemsSeen,
            cursor: pageCursor,
          })
        );
        pages += 1;
        pageNextCursor = page.nextCursor;

        // Only items under the cap: the walk stops there, so a thumbnail past it would be
        // downloaded for nothing.
        const inCap = page.items.slice(0, Math.max(0, opts.maxItems - counters.itemsSeen));
        const stored = await storedThumbs(inCap.map((i) => i.externalId));
        for (const item of inCap) {
          if (item.thumbnailUrl && !stored.has(item.externalId)) missingThumbs.add(item.thumbnailUrl);
          for (const c of item.children) {
            if (c.thumbnailUrl && !stored.has(`${item.externalId}/${c.externalId}`)) missingThumbs.add(c.thumbnailUrl);
          }
        }

        const known = await knownExternalIds(inCap.map((i) => i.externalId));
        let newOnPage = 0;
        for (const item of page.items) {
          if (counters.itemsSeen >= opts.maxItems) {
            stopReason = "cap";
            break;
          }
          items.push(item);
          if (!known.has(item.externalId)) newOnPage += 1;
          counters.itemsSeen += 1;
        }
        await tracker.flush({ phase: "saving", counters });

        if (stopReason === "cap") break;
        // Incremental stop: a page with items but zero new ones means we have paged into
        // territory the DB already has (Instagram is newest first, and at most a handful of
        // pinned known posts can lead, fewer than one page). Gated on `fullSyncFresh` so
        // this only fires while no in-window snapshot is stale, and never during a resume
        // (which deliberately re-walks known posts to reach older un-fetched ones).
        if (!resumed && fullSyncFresh && page.items.length > 0 && newOnPage === 0) {
          stopReason = "upToDate";
          log.info("sync.incremental.up_to_date", { channelId: channel.id, handle: channel.handle, itemsSeen: counters.itemsSeen }, runId);
          break;
        }
        if (page.stopReason) {
          stopReason = page.stopReason;
          break;
        }
        if (!page.nextCursor) {
          stopReason = "exhausted";
          break;
        }
        // Checked only after the natural stop conditions, so a run that in fact finished
        // its window is still reported as having finished it. Reaching here means pages
        // remained, so the pull is cut short like any other mid-walk stop.
        if (await cancelledMidChannel()) throw new SyncCancelledError();
        cursor = page.nextCursor;
        await opts.sleep(jitterMs());
      }
      return { kind: "complete", rows: { profile, items, missingThumbs } };
    } catch (err) {
      if (pages === 0 || !profile) return { kind: "failed", reason: err };
      return { kind: "partial", rows: { profile, items, missingThumbs }, missing: `media pages after page ${pages}`, reason: err };
    }
  };

  const pull = await walk();
  if (pull.kind !== "complete") {
    const err = pull.reason;
    if (err instanceof SyncCancelledError) {
      // Not a gap and not a channel error: nothing here is broken, the user stopped us.
      // Recording it as a failure would put a red mark against a channel that was working.
      log.info("sync.channel.cancelled", { channelId: channel.id, handle: channel.handle, ...counters }, runId);
      return { counters, stopReason: "cancelled" };
    }
    return { gap: await channelGap(channel, err, runId, pull.kind === "partial" ? pull.missing : null), counters, stopReason: "error" };
  }

  try {
    const seenExternalIds = await storeChannelPull(channel, pull, { counters, tracker, assetDeps: opts.assetDeps, runId });

    // Persist or clear the resume cursor. A capped run left in-window posts below the last
    // cursor unfetched, so save where to continue; a run that fully enumerated the window
    // (lookback/exhausted) or caught up (upToDate) has nothing left below, so clear it.
    if (stopReason === "cap") {
      // The cap breaks MID-page, before this page's tail items are processed, so resume
      // must RE-FETCH this page from the cursor it was requested with (`cursor`), NOT skip
      // ahead to page.nextCursor, or the tail is lost until a later full walk. Re-processing
      // the head is harmless: upserts are idempotent.
      //
      // A cap on page 1 has no request cursor of its own, so there is nothing to re-fetch.
      // Falling back to `pageNextCursor` (the page's own next-page cursor, which the sidecar
      // reports even on a "cap" stop) guarantees forward progress when MAX_ITEMS_PER_SYNC is
      // smaller than one raw page (PERF-2): the next run continues from page 2 rather than
      // re-walking page 1's head forever. The few items of page 1's own tail a pathologically
      // low cap skips this way are picked up by a later full walk.
      if (cursor !== undefined) await persistCursor(channel.id, cursor, boundary, runId, opts.now().toISOString());
      else if (pageNextCursor) await persistCursor(channel.id, pageNextCursor, boundary, runId, opts.now().toISOString());
      else await clearCursor(channel.id);
    } else {
      await clearCursor(channel.id);
    }

    // Stamp the last FULL walk. Only a fresh walk from the top that reached the window's end
    // (lookback or exhausted, not resumed and not an incremental up-to-date stop) refreshed
    // every in-window post's snapshot. Later runs check it before they may stop early, so an
    // incremental sync can never let a post's metrics age past `syncMetricsFreshnessHours`.
    const fullWalk = stopReason === "lookback" || stopReason === "exhausted";
    if (fullWalk && !resumed) {
      await db.update(tables.channels).set({ lastFullSyncAt: opts.now().toISOString() }).where(eq(tables.channels.id, channel.id));
    }

    // Soft-delete is only sound when this run enumerated the WHOLE window. A capped run has
    // in-window posts we never asked about, and marking those "deleted from Instagram" would
    // be a fabrication. A RESUMED run enumerated only the remainder below its cursor, never
    // the posts above it, so it cannot tell which of those are gone either.
    if (fullWalk && seenExternalIds.length > 0 && !resumed) {
      counters.itemsDeleted = await softDeleteMissing(channel.id, boundary, seenExternalIds, runId);
    } else if (resumed && fullWalk) {
      log.info("sync.soft_delete.skipped", {
        channelId: channel.id,
        stopReason,
        reason: "resumed run enumerated only the remainder below its cursor; a full walk from the top is required before soft-deleting",
      }, runId);
    } else if (seenExternalIds.length === 0) {
      // A run that saw NOTHING cannot distinguish "the creator deleted everything" from
      // "the fetch came back empty". This fired for real when pinned posts stopped the walk
      // early, and soft-deleted 8 live @kallaway posts.
      log.warn("sync.soft_delete.skipped", {
        channelId: channel.id,
        stopReason,
        reason: "zero items seen; refusing to interpret an empty fetch as deletions",
      }, runId);
    } else {
      log.info("sync.soft_delete.skipped", {
        channelId: channel.id,
        stopReason,
        reason: "window not fully enumerated; cannot distinguish deleted from unfetched",
      }, runId);
    }

    // Before scoring, not after: `recomputeChannelScores` below reads `videos.view_count`,
    // so a count written after it would not reach a score until the next sync.
    //
    // Off unless VIEW_COUNT_ENRICH_PER_CHANNEL is set. Each reel here is one more live
    // request from the burner. And not at all once the user has said stop: a cancel that
    // landed while the last page was being written would otherwise still buy the burner a
    // full pass, up to 200 authenticated requests for a result nobody is waiting for.
    if (opts.enrichPerChannel > 0 && !(await tracker.isCancelRequested())) {
      const enrichment = await enrichViewCounts(channel.id, {
        client: opts.client,
        sleep: opts.sleep,
        limit: opts.enrichPerChannel,
        runId,
        shouldStop: () => tracker.isCancelRequested(),
        // The pass's only heartbeat. Reuses the phase the flush directly below writes, so
        // the run reports "scoring" throughout rather than sitting on the previous phase.
        tick: () => tracker.flushIfDue({ phase: "scoring", counters }),
      });
      log.info("sync.enrich.finished", { channelId: channel.id, handle: channel.handle, ...enrichment }, runId);
    }

    await tracker.flush({ phase: "scoring", counters });
    const medianViews = await recomputeChannelScores(channel.id);
    await db.insert(tables.channelSnapshots).values({
      id: newId(),
      channelId: channel.id,
      capturedAt: nowIso(),
      followerCount: pull.rows.profile.followerCount,
      medianViews,
    });

    // Sync mirrors Instagram metadata and assets, nothing else. Analysis is authored only
    // by an external agent through MCP (crowsnest_save_analysis), never in-app.

    // Stamp the trustworthy completion time: this channel finished a complete pull and its
    // newest posts are current, which is what the library-sweep freshness skip reads.
    await db
      .update(tables.channels)
      .set({ lastSuccessfulSyncAt: opts.now().toISOString() })
      .where(eq(tables.channels.id, channel.id));

    log.info("sync.channel.finished", { channelId: channel.id, handle: channel.handle, stopReason, ...counters }, runId);
    return { counters, stopReason };
  } catch (err) {
    return { gap: await channelGap(channel, err, runId, null), counters, stopReason: "error" };
  }
}

async function channelGap(channel: ChannelRow, err: unknown, runId: string, missing: string | null): Promise<SyncGap> {
  const code = errorCode(err);
  const message = errorMessage(err);
  log.error("sync.channel.failed", { channelId: channel.id, handle: channel.handle, code, message, ...(missing ? { missing } : {}) }, runId);
  await db
    .update(tables.channels)
    .set({ syncError: message, syncErrorCode: code })
    .where(eq(tables.channels.id, channel.id));
  // Instagram's own retry-after hint (used above to size the backoff and then discarded)
  // is copied onto the gap only when this is the code it actually applies to, see the doc
  // comment on SyncGap.retryAfterSec. Genuinely absent whenever there is nothing honest to
  // say, so a downstream reader can never mistake "we didn't ask" for "we don't know".
  const retryAfterSec =
    err instanceof IgError && err.code === "IG_RATE_LIMITED" && typeof err.detail.retry_after_sec === "number" && Number.isFinite(err.detail.retry_after_sec)
      ? err.detail.retry_after_sec
      : undefined;
  return {
    channelId: channel.id,
    handle: channel.handle,
    provider: "instagrapi",
    error: message,
    code: err instanceof IgError ? err.code : null,
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    ...(missing ? { partial: true, missing } : {}),
  };
}

// ---------------------------------------------------------------- public API

export async function runSync(opts: RunSyncOpts = {}): Promise<SyncResult> {
  if (opts.channelIds !== undefined) {
    const invalid = opts.channelIds.length === 0 || opts.channelIds.some((id) => typeof id !== "string" || id.length === 0);
    if (invalid) throw new Error("runSync: channelIds must be a non-empty array of non-empty channel ids when provided");
  }

  const client = opts.client ?? igClient;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? (() => new Date());
  // config.LOOKBACK_DAYS and config.MAX_ITEMS_PER_SYNC are still the env-only fallback
  // UNDER the settings module (see src/server/settings), not read directly here any
  // more. A DB-stored sync_lookback_days / max_items_per_sync now wins over either
  // without a restart (B3, review-engineering-2026-07-31.md §3).
  const lookbackDays = opts.lookbackDays ?? (await getSetting("syncLookbackDays"));
  const maxItems = opts.maxItems ?? (await getSetting("maxItemsPerSync"));
  // Resolved once for the whole run, not per channel, so every channel in one sync gets
  // the same budget even if the setting is edited while the run is in flight.
  const enrichPerChannel = opts.enrichPerChannel ?? (await getSetting("viewCountEnrichPerChannel"));
  const metricsFreshnessHours = opts.metricsFreshnessHours ?? (await getSetting("syncMetricsFreshnessHours"));
  // Clamped defensively even though the settings schema already bounds it >= 1: a test
  // seam value should get the same floor as the setting it stands in for.
  const concurrency = Math.max(1, opts.concurrency ?? (await getSetting("syncConcurrency")));
  // Asset downloads go through the SAME client as the rest of the run. Defaulting them
  // to the module-level singleton instead would mean an injected client only covered
  // half the outbound calls — which is both a testing lie and, in production, two
  // different paths to the same sidecar.
  const assetDeps = opts.assetDeps ?? { client };

  const singleChannelId = opts.channelIds?.length === 1 ? opts.channelIds[0] : null;
  const jobId = await acquireLock(singleChannelId, lookbackDays);
  if (opts.onJobStarted) {
    // A listener that throws must not take down a run that already holds the lock —
    // the lock would stay held until the reaper got to it.
    try {
      opts.onJobStarted(jobId);
    } catch (err) {
      log.error("sync.on_job_started.failed", { jobId, message: errorMessage(err) });
    }
  }
  const tracker = createTracker(jobId, now, opts.onProgress);
  await tracker.flush({ phase: "starting" });

  const totals = tracker.totals;
  const gaps: SyncGap[] = [];
  let channelsSynced = 0;
  let lastStopReason: StopReason | null = null;
  let cancelObserved = false;
  /** True only when cancelling actually left something undone — that is what separates a
   *  'partial' cancelled run from one that had already finished everything. */
  let cancelLeftWorkUndone = false;
  /** The gap that ended a card pull early. */
  let halt: SyncGap | null = null;
  let handles: string[] = [];
  let nextIndex = 0;

  try {
    // A removed channel is never synced again, whether it was named explicitly or
    // picked up by the platform sweep. Removal is soft, so without this filter the
    // flag would set and the next run would go straight back to fetching it.
    const skipBeforeIso = opts.channelIds ? null : (opts.skipSyncedSince ?? null);

    const walked = opts.channelIds
      ? await db
          .select()
          .from(tables.channels)
          .where(and(inArray(tables.channels.id, opts.channelIds), isNull(tables.channels.deletedAt)))
      : await db
          .select()
          .from(tables.channels)
          .where(
            and(
              eq(tables.channels.platform, "instagram"),
              isNull(tables.channels.deletedAt),
              // Skip channels synced within the window. `lt(lastSuccessfulSyncAt, cutoff)`
              // alone would also drop never-synced channels (NULL is never < anything), so a
              // channel that has never had a clean sync must always be included.
              ...(skipBeforeIso
                ? [or(isNull(tables.channels.lastSuccessfulSyncAt), lt(tables.channels.lastSuccessfulSyncAt, skipBeforeIso))]
                : [])
            )
          );

    // A card pull also refreshes the own channel, after the rivals, but counts and lists only rivals.
    const ownRow = opts.cardPull ? walked.find((c) => c.isOwn) : undefined;
    const channelRows = ownRow ? walked.filter((c) => c !== ownRow) : walked;
    handles = channelRows.map((c) => c.handle);
    log.info("sync.started", { jobId, channels: channelRows.length, lookbackDays, maxItems });
    await tracker.flush({ channelsTotal: channelRows.length, phase: "starting" });

    // Bounded worker pool, `concurrency` wide: the sidecar still serializes every actual
    // Instagram call behind its own process-global lock (see the goal brief), so this
    // never produces concurrent IG traffic — it only overlaps one channel's local work
    // (thumbnail download, DB writes, scoring) with the next channel's fetch. At
    // concurrency 1 there is exactly one worker draining `channelRows` in order, which
    // makes this byte-for-byte the old serial `for` loop.
    //
    // Workers share `nextIndex`, `totals`, `gaps`, `channelsSynced`, `lastStopReason`,
    // `cancelObserved`, and `cancelLeftWorkUndone` with no locks: JS runs one worker's
    // synchronous code at a time, and every read-then-write of that shared state below
    // happens with no `await` in between, so it can never interleave across workers.
    let cancelLogged = false;

    async function worker(): Promise<void> {
      for (;;) {
        // Same order as the old for-of loop: nothing left to dispatch ends the worker
        // before it ever asks about cancellation, same as an empty/exhausted array never
        // entering the loop body.
        if (nextIndex >= channelRows.length || halt) return;
        if (await tracker.isCancelRequested()) {
          // Do not start any channel not already dispatched; channels already in flight
          // on other workers are left to finish below.
          if (!cancelLogged) {
            cancelLogged = true;
            cancelObserved = true;
            cancelLeftWorkUndone = true;
            log.info("sync.cancelled", { jobId, before: channelRows[nextIndex]?.handle, channelsDone: tracker.channelsDone });
          }
          return;
        }
        // Re-check: another worker may have claimed the last remaining channel while this
        // one was awaiting the cancel check above. From here to `nextIndex += 1` there is
        // no `await`, so the claim itself is atomic.
        if (nextIndex >= channelRows.length || halt) return;
        const channel = channelRows[nextIndex];
        nextIndex += 1;

        // Last-started wins: with N workers in flight there is no one truthful "current"
        // channel, so this names whichever channel most recently started.
        await tracker.flush({ phase: "profile", currentChannelHandle: channel.handle });

        // syncOneChannel catches its own per-channel failures and returns a gap, but a
        // throw from the resume-cursor read (which runs before its try) or any other
        // unexpected error must NOT reject this worker: with siblings in flight, a
        // rejected Promise.all would finalize the job row while they are still writing to
        // it, and this channel would vanish from both `gaps` and `channelsSynced`. Fold an
        // escaped throw into a channel gap so the run finalizes as partial with the channel
        // counted, exactly as a returned gap would. (In-process this is defensive: the DB
        // is synchronous better-sqlite3, so workers never truly write concurrently.)
        let result: { gap?: SyncGap; counters: SyncCounters; stopReason: StopReason | null };
        try {
          result = await syncOneChannel(channel, { client, sleep, assetDeps, now, tracker, lookbackDays, maxItems, enrichPerChannel, metricsFreshnessHours, cardPull: opts.cardPull ?? false });
        } catch (err) {
          const code = errorCode(err);
          log.error("sync.channel.failed", { channelId: channel.id, handle: channel.handle, code, message: errorMessage(err) }, jobId);
          result = {
            counters: zeroCounters(),
            stopReason: null,
            gap: { channelId: channel.id, handle: channel.handle, provider: channel.platform, error: errorMessage(err), code },
          };
        }
        for (const k of Object.keys(totals) as (keyof SyncCounters)[]) totals[k] += result.counters[k];
        if (result.gap) gaps.push(result.gap);
        else channelsSynced += 1;
        if (opts.cardPull && !halt && result.gap?.code && HALT_CODES.has(result.gap.code)) {
          halt = result.gap;
          log.warn("sync.halted", { jobId, handle: channel.handle, code: result.gap.code, channelsDone: tracker.channelsDone + 1 });
        }
        lastStopReason = result.stopReason ?? lastStopReason;
        if (result.stopReason === "cancelled") {
          cancelObserved = true;
          cancelLeftWorkUndone = true;
        }
        tracker.channelsDone += 1;
        await tracker.flush();
      }
    }

    // Extra workers beyond `channelRows.length` just see `nextIndex >= length` on their
    // first turn and return immediately — no special-casing needed for a short list.
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (ownRow && !halt && !(await tracker.isCancelRequested())) {
      await tracker.flush({ phase: "profile", currentChannelHandle: ownRow.handle });
      const own = await syncOneChannel(ownRow, { client, sleep, assetDeps, now, tracker, lookbackDays, maxItems, enrichPerChannel, metricsFreshnessHours, cardPull: true }).catch(
        (err: unknown) => ({ gap: { code: errorCode(err), error: errorMessage(err) } })
      );
      if (own.gap) log.warn("sync.own_channel.failed", { jobId, handle: ownRow.handle, code: own.gap.code, message: own.gap.error }, jobId);
    }

    // A cancel can also land after the last page: it changed nothing, but the user still
    // asked for it, so the run says so rather than silently reporting a clean finish.
    if (!cancelObserved && (await tracker.isCancelRequested())) cancelObserved = true;

    /**
     * What a cancelled run reports, stated once so the UI and the next reader agree:
     *
     *  - `stop_reason` answers "why did it end" — 'cancelled' whenever the user asked,
     *    even if the ask landed after the last page. The user pressed the button; the row
     *    should not pretend otherwise.
     *  - `status` answers "did the work get done" — independently. A cancel that arrived
     *    too late to stop anything leaves `success`; one that abandoned channels or pages
     *    leaves `partial`.
     *
     * So `success` + `cancelled` is a real, meaningful combination: "you asked to stop,
     * and by then there was nothing left to stop".
     */
    const stopReason: StopReason | null = cancelObserved ? "cancelled" : lastStopReason;
    // 'partial' has to mean partial. A run where every channel failed used to record
    // 'partial' too, so the UI reported partial success for a total failure — the one
    // status a user must be able to trust. Partial now requires a survivor, or a channel
    // whose pull was cut after a page landed: it stored nothing, but the gap says what is missing.
    const everythingFailed = gaps.length > 0 && channelsSynced === 0 && !gaps.some((g) => g.partial);
    const status: SyncJobStatus = everythingFailed ? "failed" : gaps.length > 0 || cancelLeftWorkUndone ? "partial" : "success";
    await tracker.flush({ phase: "finalizing", currentChannelHandle: null });
    const owned = await finalizeJob(
      jobId,
      {
        finishedAt: nowIso(),
        stopReason,
        ...totals,
        channelsDone: tracker.channelsDone,
        retries: tracker.retries,
        stats: { channels: channelsSynced, videos: totals.itemsCreated + totals.itemsUpdated },
        gaps,
      },
      {
        status,
        // With no channel left standing there is no "the rest worked" story to tell, so the
        // job carries the first failure's code instead of a null the UI can't explain.
        errorCode: everythingFailed ? gaps[0].code ?? "SYNC_ALL_CHANNELS_FAILED" : null,
        errorMessage: everythingFailed ? gaps[0].error : null,
      }
    );

    log.info("sync.finished", { jobId, status, stopReason, channelsSynced, retries: tracker.retries, reaped: !owned, ...totals });

    try {
      await notifyRunFinished(jobId, status, totals, everythingFailed ? gaps[0]?.error ?? null : null);
    } catch {
      // A notification write must never break a completed sync.
    }

    return {
      jobId,
      channelsSynced,
      gaps,
      stopReason,
      ...totals,
      handles,
      dispatched: nextIndex,
    };
  } catch (err) {
    await finalizeJob(
      jobId,
      {
        finishedAt: nowIso(),
        ...totals,
        // A run that died after fighting through retries should say so; the retry count
        // is often the only clue that the upstream was already sick.
        channelsDone: tracker.channelsDone,
        retries: tracker.retries,
        phase: "finalizing",
        // Cleared for the same reason the success path clears it: a terminal row that
        // still names a channel reads as though that channel is being worked on.
        currentChannelHandle: null,
        gaps,
      },
      { status: "failed", errorCode: errorCode(err), errorMessage: errorMessage(err) }
    );
    log.error("sync.failed", { jobId, code: errorCode(err), message: errorMessage(err) });
    try {
      insertNotification({ kind: "run_failed", runId: jobId, title: "Sync failed", body: errorMessage(err) });
    } catch {
      // A notification write must never mask the original sync failure below.
    }
    throw err;
  }
}

/**
 * Tracks a new channel. The profile fetch is best-effort: a failure leaves a thin row
 * with syncError set rather than refusing to track the handle at all.
 */
export async function addChannel(
  input: { handle: string; platform?: "instagram" },
  deps: { client?: IgClient; assetDeps?: EnsureAssetDeps } = {}
): Promise<{ channelId: string }> {
  const client = deps.client ?? igClient;
  const assetDeps = deps.assetDeps ?? { client };
  const handle = normalizeHandle(input.handle);

  const existing = await db
    .select({ id: tables.channels.id, deletedAt: tables.channels.deletedAt })
    .from(tables.channels)
    .where(and(eq(tables.channels.platform, "instagram"), eq(tables.channels.handle, handle)))
    .limit(1);
  // A live row means the channel is already tracked — an idempotent add. A soft-deleted
  // row (removeChannel sets deletedAt) is revived below instead: the (platform, handle)
  // unique index makes a second insert impossible, so re-adding a previously removed
  // handle has to reuse and un-delete that same row. Returning it as-is was the "could
  // not add @hormozi" bug — the add looked successful but the row stayed deleted, so the
  // channel never reappeared in the list.
  const existingRow = existing[0];
  if (existingRow && existingRow.deletedAt === null) return { channelId: existingRow.id };

  let profile: Awaited<ReturnType<IgClient["profile"]>> | null = null;
  let error: { message: string; code: string } | null = null;
  try {
    profile = await client.profile(handle);
  } catch (err) {
    error = { message: errorMessage(err), code: errorCode(err) };
    log.warn("channel.add.profile_failed", { handle, ...error });
  }

  let avatarAssetId: string | null = null;
  if (profile?.avatarUrl) {
    const avatar = await tryEnsureAsset(profile.avatarUrl, "avatar", { channelHandle: handle }, assetDeps);
    avatarAssetId = avatar.assetId;
  }

  // Shared field set for both the insert and the revive-via-update. A failed profile
  // fetch leaves the profile columns undefined, which drizzle omits from the SET clause
  // on update (keeping whatever the revived row already had) and inserts as defaults on a
  // fresh row — either way a thin, warning-flagged channel, same as before.
  const profileFields = {
    externalId: profile?.externalId,
    displayName: profile?.displayName,
    avatarAssetId,
    followerCount: profile?.followerCount,
    followingCount: profile?.followingCount,
    mediaCount: profile?.mediaCount,
    bio: profile?.bio,
    isVerified: profile?.isVerified ?? false,
    isPrivate: profile?.isPrivate ?? false,
    syncError: error?.message ?? null,
    syncErrorCode: error?.code ?? null,
    lastSyncedAt: profile ? nowIso() : null,
  };

  if (existingRow) {
    // Revive the previously-removed row: clear the soft-delete and refresh it from the
    // freshly fetched profile. trackedSince is left untouched — the channel really has
    // been tracked since the first add.
    await db
      .update(tables.channels)
      .set({ ...profileFields, deletedAt: null })
      .where(eq(tables.channels.id, existingRow.id));
    log.info("channel.readded", { channelId: existingRow.id, handle, hadProfile: profile !== null });
    return { channelId: existingRow.id };
  }

  const id = newId();
  await db.insert(tables.channels).values({
    id,
    platform: "instagram",
    handle,
    ...profileFields,
    trackedSince: nowIso(),
  });

  log.info("channel.added", { channelId: id, handle, hadProfile: profile !== null });
  return { channelId: id };
}

/**
 * Manual single-reel import — the keyless yt-dlp escape hatch, deliberately NOT part of
 * the sync path (design brief §9). Creates a thin channel stub if the reel's owner isn't
 * tracked, downloads its thumbnail into our own storage, and upserts the post.
 */
export async function importReelByUrl(
  url: string,
  deps: {
    fetchReel?: (url: string) => Promise<VideoStatsFromYtdlp>;
    assetDeps?: EnsureAssetDeps;
  } = {}
): Promise<{ videoId: string; channelId: string }> {
  const fetchReel = deps.fetchReel ?? (await import("../providers/ytdlp")).fetchReelByUrl;
  const stats = await fetchReel(url);
  const handle = normalizeHandle(stats.channelHandle);

  const existingChannel = await db
    .select({ id: tables.channels.id })
    .from(tables.channels)
    .where(and(eq(tables.channels.platform, "instagram"), eq(tables.channels.handle, handle)))
    .limit(1);

  let channelId: string;
  if (existingChannel[0]) {
    channelId = existingChannel[0].id;
  } else {
    channelId = newId();
    await db.insert(tables.channels).values({
      id: channelId,
      platform: "instagram",
      handle,
      syncError: null,
      trackedSince: nowIso(),
    });
  }

  const thumb = await tryEnsureAsset(stats.thumbnailUrl ?? null, "thumbnail", { channelHandle: handle }, deps.assetDeps ?? {});

  const media: IgMedia = {
    externalId: stats.id,
    shortcode: null,
    mediaType: "video",
    productType: "clips",
    url: stats.url,
    caption: stats.caption ?? null,
    takenAt: stats.postedAt,
    durationSec: stats.durationSec ?? null,
    viewCount: stats.viewCount,
    likeCount: stats.likeCount ?? null,
    commentCount: stats.commentCount ?? null,
    thumbnailUrl: null,
    videoUrl: null,
    children: [],
    raw: {},
  };

  const up = await upsertVideo(channelId, media, { thumbnailAssetId: thumb.assetId, videoAssetId: null });
  await recomputeChannelScores(channelId);

  log.info("reel.imported", { videoId: up.id, channelId, created: up.created });
  return { videoId: up.id, channelId };
}

/** The subset of yt-dlp's mapped output this module consumes. */
interface VideoStatsFromYtdlp {
  id: string;
  url: string;
  caption?: string;
  postedAt: string;
  durationSec?: number;
  thumbnailUrl?: string;
  viewCount: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  channelHandle: string;
}

/**
 * Asks a running sync to stop. Co-operative by design: the engine notices at the next
 * page or channel boundary, so an in-flight HTTP call is allowed to finish and everything
 * already written stays written. Killing the process instead would leave the lock held
 * and the job row stuck on 'running' until the reaper got to it.
 *
 * Returns false when there is nothing to cancel (unknown job, or one that already
 * finished) so the caller can say so instead of pretending it worked.
 */
export async function requestCancel(jobId: string): Promise<boolean> {
  const rows = await db
    .select({ status: tables.syncJobs.status })
    .from(tables.syncJobs)
    .where(eq(tables.syncJobs.id, jobId))
    .limit(1);
  if (rows[0]?.status !== "running") return false;

  await db.update(tables.syncJobs).set({ cancelRequested: true }).where(eq(tables.syncJobs.id, jobId));
  log.info("sync.cancel.requested", { jobId });
  return true;
}

// `getRunningJob` was removed here. Its only consumer, `getRunningSyncAction`, was itself
// dead and has been deleted; the product finds a running job through `sync-actions.ts`
// instead. What was left read like product API while nothing but tests called it — the
// same shape as the orphaned transcription chain and the dead action it outlived. The
// tests that need to observe a run in flight now query `sync_jobs` directly, which is
// what they were really asserting.

/** Internals reachable from tests only. */
export const __test = { enrichmentCandidates, enrichViewCounts };
