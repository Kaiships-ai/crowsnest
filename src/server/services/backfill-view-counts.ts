/**
 * The view-count backfill (enhancements spec M5-U1).
 *
 * A sync's enrichment pass only ever looks at the newest `viewCountEnrichPerChannel`
 * reels of each channel, which is the right shape for keeping fresh numbers fresh and the
 * wrong shape for a library that accumulated hundreds of rows while the knob was 0. This
 * job is the catch-up: every reel with no play count at all, oldest debt included, paced
 * and cancelable, and always yielding to a real sync.
 *
 * It reuses `sync_jobs` rather than inventing a job table, so the Runs screen, the cancel
 * button, the heartbeat and the stale-lock reaper all work on it unchanged. What it does
 * NOT reuse is the sync's single-flight lock: see `BACKFILL_LOCK_KEY` in sync-types.ts.
 * The relationship is deliberately one-way. A sync never waits for a backfill; a backfill
 * refuses to start under a sync and stops if one appears.
 *
 * Never soft-deletes and never enumerates a window, so it cannot repeat the failure the
 * lock arbitration exists to prevent. The only row it writes is `videos.view_count`, and
 * only where that column is currently null.
 */

import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { igClient, type IgClient } from "../ig/client";
import { log } from "../lib/logger";
import { BACKFILL_LOCK_KEY } from "./sync-types";
import { ENRICH_MAX_CONSECUTIVE_SKIPS, recomputeChannelScores } from "./sync-engine";

/** Same pacing the sync's page walk uses. One request per reel is a much higher frequency
 *  than one per page, and the sidecar's own docstring says the caller paces. */
const JITTER_MIN_MS = 300;
const JITTER_SPAN_MS = 500;

/** How many reels one backfill run may ask about. A bound, not a target: the job is meant
 *  to be run again rather than to hold a burner account open for an hour. */
const DEFAULT_LIMIT = 200;

/** How often the job row's heartbeat is refreshed while the loop runs, so the reaper and
 *  the Runs screen can both tell a working backfill from a dead one. */
const HEARTBEAT_EVERY = 5;

function jitterMs(): number {
  return JITTER_MIN_MS + Math.random() * JITTER_SPAN_MS;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "IG_UNKNOWN";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Raised when something else owns the upstream right now. Not a failure of the backfill:
 *  the caller is expected to offer it again later, which is why it carries a reason a UI
 *  can print rather than a generic message. */
export class BackfillBlockedError extends Error {
  readonly code = "BACKFILL_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "BackfillBlockedError";
  }
}

export type BackfillStopReason = "exhausted" | "cancelled" | "sync_started" | "missing_wall" | "error";

export interface BackfillResult {
  jobId: string;
  /** How many blank reels this run set out to ask about. */
  candidates: number;
  /** Counts actually written. */
  enriched: number;
  /** Answered `IG_NOT_FOUND`: the post is gone from Instagram. */
  skipped: number;
  /** Answered, but with no play count. Instagram withheld it. */
  withheld: number;
  stopReason: BackfillStopReason;
}

export interface BackfillOpts {
  client?: Pick<IgClient, "fetchMediaStats">;
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
  /** Fired once the job row exists, so a caller can hold the id without awaiting the run
   *  (same seam and same reason as `runSync`'s). */
  onJobStarted?: (jobId: string) => void;
}

/** Any sync holding the real lock right now. Backfill rows are excluded: two backfills are
 *  prevented separately, and a backfill is not a sync. */
async function runningSyncId(): Promise<string | null> {
  const rows = await db
    .select({ id: tables.syncJobs.id })
    .from(tables.syncJobs)
    .where(and(eq(tables.syncJobs.status, "running"), ne(tables.syncJobs.lockKey, BACKFILL_LOCK_KEY)))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function runningBackfillId(): Promise<string | null> {
  const rows = await db
    .select({ id: tables.syncJobs.id })
    .from(tables.syncJobs)
    .where(and(eq(tables.syncJobs.status, "running"), eq(tables.syncJobs.lockKey, BACKFILL_LOCK_KEY)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Reels with no play count at all. Newest first: those are the ones a user is most likely
 *  to be looking at, and the ones a score is most likely to need. */
async function blankReels(limit: number): Promise<{ id: string; externalId: string; channelId: string }[]> {
  if (limit <= 0) return [];
  return db
    .select({ id: tables.videos.id, externalId: tables.videos.externalId, channelId: tables.videos.channelId })
    .from(tables.videos)
    .where(
      and(
        isNull(tables.videos.viewCount),
        isNull(tables.videos.deletedAt),
        eq(tables.videos.productType, "clips")
      )
    )
    .orderBy(desc(tables.videos.postedAt))
    .limit(limit);
}

async function isCancelRequested(jobId: string): Promise<boolean> {
  const rows = await db
    .select({ cancelRequested: tables.syncJobs.cancelRequested })
    .from(tables.syncJobs)
    .where(eq(tables.syncJobs.id, jobId))
    .limit(1);
  return rows[0]?.cancelRequested === true;
}

export async function runViewCountBackfill(opts: BackfillOpts = {}): Promise<BackfillResult> {
  const client = opts.client ?? igClient;
  const sleep = opts.sleep ?? defaultSleep;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // Both checks before the row is inserted, so a refusal leaves nothing behind.
  const syncId = await runningSyncId();
  if (syncId) {
    throw new BackfillBlockedError("A sync is running. The backfill yields to it; try again once the sync finishes.");
  }
  if (await runningBackfillId()) {
    throw new BackfillBlockedError("A backfill is already running.");
  }

  const jobId = newId();
  await db.insert(tables.syncJobs).values({
    id: jobId,
    channelId: null,
    lockKey: BACKFILL_LOCK_KEY,
    startedAt: nowIso(),
    heartbeatAt: nowIso(),
    status: "running",
    phase: "scoring",
  });
  if (opts.onJobStarted) {
    try {
      opts.onJobStarted(jobId);
    } catch (err) {
      // A listener that throws must not strand a job row that already holds the key.
      log.error("backfill.on_job_started.failed", { jobId, message: errorMessage(err) }, jobId);
    }
  }

  let enriched = 0;
  let skipped = 0;
  let withheld = 0;
  let consecutiveSkips = 0;
  let processed = 0;
  let stopReason: BackfillStopReason = "exhausted";
  let failure: { code: string; message: string } | null = null;
  let candidates: { id: string; externalId: string; channelId: string }[] = [];
  /** Channels whose view counts this run actually changed. A view count IS the input to a
   *  channel's baseline, so leaving these unrecomputed would show the feed a fresh number
   *  next to a score computed without it. `score-recompute-guard.test.ts` enforces exactly
   *  this pairing for every writer of `tables.videos`. */
  const touchedChannels = new Set<string>();

  try {
    candidates = await blankReels(limit);
    log.info("backfill.started", { jobId, candidates: candidates.length, limit }, jobId);

    for (const [index, row] of candidates.entries()) {
      if (index % HEARTBEAT_EVERY === 0) {
        await db
          .update(tables.syncJobs)
          .set({ heartbeatAt: nowIso(), itemsSeen: processed, itemsUpdated: enriched, itemsFailed: skipped })
          .where(eq(tables.syncJobs.id, jobId));
      }

      if (await isCancelRequested(jobId)) {
        stopReason = "cancelled";
        log.info("backfill.cancelled", { jobId, enriched, skipped, withheld, remaining: candidates.length - index }, jobId);
        break;
      }

      // A sync that started while this was running owns the upstream now. Stopping is both
      // the polite and the safe answer: the sync's own pass writes the same column, and two
      // request streams from one burner account is what trips rate limiting.
      const interrupting = await runningSyncId();
      if (interrupting) {
        stopReason = "sync_started";
        log.info("backfill.yielded", { jobId, syncId: interrupting, enriched, skipped, withheld, remaining: candidates.length - index }, jobId);
        break;
      }

      if (index > 0) await sleep(jitterMs());

      let viewCount: number | null;
      try {
        const stats = await client.fetchMediaStats(row.externalId);
        viewCount = stats.viewCount;
      } catch (err) {
        if (errorCode(err) === "IG_NOT_FOUND") {
          skipped += 1;
          processed += 1;
          consecutiveSkips += 1;
          if (consecutiveSkips >= ENRICH_MAX_CONSECUTIVE_SKIPS) {
            // Same wall, and the same refusal to name a cause, as the sync's pass. Report
            // what was observed and let a human diagnose.
            stopReason = "missing_wall";
            log.warn("backfill.stopped_missing", {
              jobId, externalId: row.externalId, consecutiveSkips, enriched, skipped, withheld,
              reason: `${ENRICH_MAX_CONSECUTIVE_SKIPS} consecutive medias came back missing, which is too many to be ordinary deletions; stopping rather than guessing why`,
            }, jobId);
            break;
          }
          continue;
        }
        failure = { code: errorCode(err), message: errorMessage(err) };
        stopReason = "error";
        log.error("backfill.failed", { jobId, ...failure, enriched, skipped, withheld }, jobId);
        break;
      }
      consecutiveSkips = 0;
      processed += 1;

      // `fetchMediaStats` maps a zero to null. Writing that null back would be pointless;
      // writing a 0 would repeat the bug that turned a 2.27M-view reel into 0.
      if (viewCount == null) {
        withheld += 1;
        continue;
      }

      try {
        await db
          .update(tables.videos)
          .set({ viewCount, lastRefreshedAt: nowIso() })
          .where(eq(tables.videos.id, row.id));
      } catch (err) {
        failure = { code: errorCode(err), message: errorMessage(err) };
        stopReason = "error";
        log.error("backfill.write_failed", { jobId, externalId: row.externalId, ...failure }, jobId);
        break;
      }
      enriched += 1;
      touchedChannels.add(row.channelId);
    }
  } catch (err) {
    // A read of the candidate list, a heartbeat or a cancel check can all fail. None of
    // them should leave the key held.
    failure = { code: errorCode(err), message: errorMessage(err) };
    stopReason = "error";
    log.error("backfill.failed", { jobId, ...failure, enriched, skipped, withheld }, jobId);
  }

  // Before the job row is finalized, and outside the loop so a channel with twenty
  // backfilled reels is recomputed once rather than twenty times. Runs even when the loop
  // ended early: counts that were written are real, and a cancel is not a reason to leave
  // the scores derived from them stale. Each channel is wrapped on its own so one bad
  // recompute cannot cost the others theirs.
  for (const channelId of touchedChannels) {
    try {
      await recomputeChannelScores(channelId);
    } catch (err) {
      log.error("backfill.recompute_failed", { jobId, channelId, code: errorCode(err), message: errorMessage(err) }, jobId);
    }
  }

  const status = stopReason === "error" ? "failed" : stopReason === "exhausted" || stopReason === "missing_wall" ? "success" : "partial";
  await db
    .update(tables.syncJobs)
    .set({
      status,
      finishedAt: nowIso(),
      heartbeatAt: nowIso(),
      phase: "finalizing",
      stopReason: stopReason === "cancelled" ? "cancelled" : stopReason === "error" ? "error" : "exhausted",
      itemsSeen: processed,
      itemsUpdated: enriched,
      itemsFailed: skipped,
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message ?? null,
    })
    .where(eq(tables.syncJobs.id, jobId));

  log.info("backfill.finished", { jobId, status, stopReason, candidates: candidates.length, enriched, skipped, withheld }, jobId);

  return { jobId, candidates: candidates.length, enriched, skipped, withheld, stopReason };
}
