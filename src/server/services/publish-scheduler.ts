import { and, asc, eq, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { DEFAULT_MAX_ATTEMPTS } from "@/lib/publish-attempts";
import { publishPlannedPost, type PublishPostResult } from "./publish-post";

/**
 * The in-process publish scheduler (implementation plan Phase C, task C1/C2).
 *
 * One tick, {@link runDuePublishes}, does the whole job: pick due `scheduled` rows,
 * claim each with a single atomic `UPDATE ... WHERE state='scheduled'`, and hand a
 * successful claim to {@link publishPlannedPost} (publish-post.ts), which writes the
 * terminal state itself. A tick that gets 0 rows changed on a claim means another tick
 * already took that row — that race, not a lock, is the whole no-double-publish
 * guarantee (same pattern as `finalizeJob` in sync-engine.ts).
 *
 * Retry is scheduler policy, not publish-post's: a `failed` row under `MAX_ATTEMPTS` is
 * re-armed to `scheduled` with a backed-off `scheduledAt`; at or above the cap it stays
 * `failed` (terminal) forever. publish-post.ts already increments `attemptCount` on
 * every failure, so this module only reads it.
 *
 * A third, independent pass (PUB-04) reaps rows stuck in `publishing`: a process killed
 * between the atomic claim and publishPlannedPost's own terminal write leaves a row
 * `publishing` forever, since nothing else ever moves a `publishing` row off that state.
 * The reap re-claims a `publishing` row whose `updatedAt` is older than
 * `PUBLISHING_STALE_MS`, using the exact same guarded conditional-UPDATE shape as the
 * scheduled->publishing claim (same pattern as `reapStaleLocks` in sync-engine.ts), then
 * hands it to `publishPlannedPost` the same as a fresh claim.
 *
 * `updatedAt` is a heartbeat, not just a claim timestamp: publishPlannedPost (publish-
 * post.ts) touches it at the start of its real work, between each major step, and on
 * every attempt of its dominant long step (the container poll), so a legitimate publish
 * still running past `PUBLISHING_STALE_MS` since its original claim keeps looking fresh
 * to this reaper and is never concurrently re-claimed into a second, duplicate publish.
 * Only a row whose process actually stopped touching it (a crash) ever goes stale.
 *
 * Everything reachable from the outside (db reads/writes, the publish call, the retry
 * policy) is injectable via `PublishSchedulerDeps`, defaulting to the real db and the
 * real `publishPlannedPost` — same deps-injection seam publish-post.ts itself uses, so
 * tests never touch the network or (for most cases) a real database.
 */

export { DEFAULT_MAX_ATTEMPTS };

/**
 * Only a transient failure is worth an automatic retry. A permanent one (no_video with
 * the asset gone, no_bucket or auth misconfiguration, a container the Graph API rejected)
 * would burn the same 1m/5m/15m budget and still fail, so it stays `failed` immediately
 * and surfaces for the user to fix. Mirrors how sync consults IgError.retryable.
 */
export const RETRYABLE_ERROR_CLASSES = ["rate_limit", "timeout", "storage", "unknown"] as const;

/** 1m / 5m / 15m, then holds at 15m — attemptCount is 1-based (publish-post.ts writes
 *  `row.attemptCount + 1` on the failure this backoff is scheduling the retry for). */
export function defaultBackoffMs(attemptCount: number): number {
  const steps = [60_000, 5 * 60_000, 15 * 60_000];
  return steps[Math.min(Math.max(attemptCount, 1), steps.length) - 1];
}

/** Cap per tick so a large backlog of due rows can never block the interval loop for
 *  more than one tick's worth of publishes. */
const CLAIM_BATCH_SIZE = 10;

/**
 * How long a `publishing` row may sit with no heartbeat write before the reaper treats
 * it as crash-stranded and re-claims it (PUB-04). Set well above the longest gap between
 * publishPlannedPost's heartbeats, not just above one attempt's total worst case:
 * mid-poll, `pollReelContainer` heartbeats every attempt (2s apart, each attempt capped
 * at Graph's own 30s `AbortSignal.timeout`, so the worst single gap is ~32s); every other
 * step is bracketed by its own heartbeat before and after. 20 minutes leaves a wide
 * margin over that ~32s worst-case gap, so a live publish's `updatedAt` can never
 * actually go stale — only a genuinely crashed process (which stops heartbeating
 * entirely) is ever reaped.
 *
 * Residual risk: the object upload step (`provider.upload`) is bracketed by heartbeats
 * before and after but not ticked during it, since it has no attempt-loop to hook a
 * heartbeat into like `pollReelContainer` does. A single upload pathologically slower
 * than `PUBLISHING_STALE_MS` could still be reclaimed concurrently; this is far narrower
 * than the pre-heartbeat risk (any publish, not just an extreme upload) and matches the
 * bound storage-provider.ts already assumes for one object.
 */
export const PUBLISHING_STALE_MS = 20 * 60_000;

/** No `app_settings` key exists yet for this interval (none of Settings' existing
 *  cadence keys cover the publish scheduler, and adding one is out of this task's file
 *  scope — see settings/index.ts). Assumption: a raw env override plus this hardcoded
 *  default is the smallest correct stand-in; promote to a real setting if the product
 *  ever wants this changed without a restart. */
const DEFAULT_TICK_INTERVAL_MS = 30_000;
function resolveTickIntervalMs(): number {
  const raw = process.env.PUBLISH_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS;
}

export interface PublishSchedulerDeps {
  /** Defaults to `publishPlannedPost` called with no dep overrides. */
  publish: (postId: string) => Promise<PublishPostResult>;
  /** `scheduled` rows due at or before `nowIso`, oldest first, capped at `limit`. */
  selectDueScheduled: (nowIso: string, limit: number) => Promise<{ id: string }[]>;
  /** The atomic claim: `UPDATE ... SET state='publishing' WHERE id=? AND
   *  state='scheduled' AND scheduledAt IS NOT NULL AND scheduledAt <= now`, so a row
   *  cancelled or moved after the batch select is left alone. True iff one row changed. */
  claim: (id: string, nowIso: string) => Promise<boolean>;
  /** `publishing` rows whose `updatedAt` is older than `cutoffIso`, capped at `limit`
   *  (PUB-04). */
  selectStalePublishing: (cutoffIso: string, limit: number) => Promise<{ id: string }[]>;
  /** The reaper's atomic re-claim: `UPDATE ... SET updatedAt=? WHERE id=? AND
   *  state='publishing' AND updatedAt < cutoffIso`. Returns true iff exactly one row
   *  changed — same shape as `claim`, so two ticks (or a tick racing the still-alive
   *  original attempt's eventual terminal write, which unconditionally overwrites
   *  `updatedAt` too) can never both win. */
  reclaimPublishing: (id: string, nowIso: string, cutoffIso: string) => Promise<boolean>;
  /** `failed` rows with `attemptCount < maxAttempts`, capped at `limit`. */
  selectRetryableFailed: (maxAttempts: number, limit: number) => Promise<{ id: string; attemptCount: number }[]>;
  /** Re-arms one failed row back to `scheduled` at `scheduledAt`, but only if it is
   *  still `failed` (same conditional-UPDATE shape as `claim`, though nothing in this
   *  single-process scheduler actually races it — see the comment on the default). */
  rearmForRetry: (id: string, scheduledAt: string, nowIso: string) => Promise<void>;
  maxAttempts: number;
  backoffMs: (attemptCount: number) => number;
  /** How stale a `publishing` row's `updatedAt` must be before the reaper re-claims it.
   *  Defaults to `PUBLISHING_STALE_MS`. */
  publishingStaleMs: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function defaultSelectDueScheduled(nowIso: string, limit: number): Promise<{ id: string }[]> {
  return db
    .select({ id: tables.plannedPosts.id })
    .from(tables.plannedPosts)
    .where(and(eq(tables.plannedPosts.state, "scheduled"), isNotNull(tables.plannedPosts.scheduledAt), lte(tables.plannedPosts.scheduledAt, nowIso)))
    .orderBy(asc(tables.plannedPosts.scheduledAt))
    .limit(limit);
}

async function defaultClaim(id: string, nowIso: string): Promise<boolean> {
  const result = await db
    .update(tables.plannedPosts)
    .set({ state: "publishing", updatedAt: nowIso })
    .where(
      and(
        eq(tables.plannedPosts.id, id),
        eq(tables.plannedPosts.state, "scheduled"),
        isNotNull(tables.plannedPosts.scheduledAt),
        lte(tables.plannedPosts.scheduledAt, nowIso)
      )
    );
  return (result as { changes?: number }).changes === 1;
}

async function defaultSelectStalePublishing(cutoffIso: string, limit: number): Promise<{ id: string }[]> {
  return db
    .select({ id: tables.plannedPosts.id })
    .from(tables.plannedPosts)
    .where(and(eq(tables.plannedPosts.state, "publishing"), lt(tables.plannedPosts.updatedAt, cutoffIso)))
    .orderBy(asc(tables.plannedPosts.updatedAt))
    .limit(limit);
}

// Same guarded shape as `defaultClaim`: the WHERE re-checks both `state` and the
// staleness cutoff at write time, not just at select time, so a row resolved (or reaped
// by another tick) between the select and this UPDATE is correctly left alone (changes=0).
async function defaultReclaimPublishing(id: string, nowIso: string, cutoffIso: string): Promise<boolean> {
  const result = await db
    .update(tables.plannedPosts)
    .set({ updatedAt: nowIso })
    .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.state, "publishing"), lt(tables.plannedPosts.updatedAt, cutoffIso)));
  return (result as { changes?: number }).changes === 1;
}

async function defaultSelectRetryableFailed(maxAttempts: number, limit: number): Promise<{ id: string; attemptCount: number }[]> {
  return db
    .select({ id: tables.plannedPosts.id, attemptCount: tables.plannedPosts.attemptCount })
    .from(tables.plannedPosts)
    .where(
      and(
        eq(tables.plannedPosts.state, "failed"),
        lt(tables.plannedPosts.attemptCount, maxAttempts),
        inArray(tables.plannedPosts.errorClass, RETRYABLE_ERROR_CLASSES as unknown as string[])
      )
    )
    .limit(limit);
}

// This scheduler is one setInterval in one process (C2), so nothing else can claim a
// `failed` row between the select above and this write; the WHERE state='failed' guard
// is kept anyway so a re-arm is never a silent no-op if that ever changes, mirroring
// `claim`'s shape rather than introducing a second pattern for one writer.
async function defaultRearmForRetry(id: string, scheduledAt: string, nowIso: string): Promise<void> {
  await db
    .update(tables.plannedPosts)
    .set({ state: "scheduled", scheduledAt, updatedAt: nowIso })
    .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.state, "failed")));
}

const DEFAULT_DEPS: PublishSchedulerDeps = {
  publish: (postId) => publishPlannedPost(postId, { claimed: true }),
  selectDueScheduled: defaultSelectDueScheduled,
  claim: defaultClaim,
  selectStalePublishing: defaultSelectStalePublishing,
  reclaimPublishing: defaultReclaimPublishing,
  selectRetryableFailed: defaultSelectRetryableFailed,
  rearmForRetry: defaultRearmForRetry,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  backoffMs: defaultBackoffMs,
  publishingStaleMs: PUBLISHING_STALE_MS,
};

export interface PublishTickResult {
  /** Rows this tick actually claimed (changes === 1) — never counts a row another tick
   *  already took. */
  claimed: number;
  published: number;
  failed: number;
}

/**
 * One scheduler tick. Never throws: a failure reading candidates, claiming a row, or
 * re-arming a retry is logged and the tick still resolves.
 * A `publish` call that throws (instead of resolving with `state: "failed"`, which
 * publish-post.ts always does on its own errors) is caught per-row so one bad row can
 * never stop the rest of the batch or kill the interval this runs under.
 */
export async function runDuePublishes(now: Date = new Date(), deps: Partial<PublishSchedulerDeps> = {}): Promise<PublishTickResult> {
  const d: PublishSchedulerDeps = { ...DEFAULT_DEPS, ...deps };
  const nowIso = now.toISOString();
  const result: PublishTickResult = { claimed: 0, published: 0, failed: 0 };

  let candidates: { id: string }[];
  try {
    candidates = await d.selectDueScheduled(nowIso, CLAIM_BATCH_SIZE);
  } catch (err) {
    log.error("publish_scheduler.select_due_failed", { error: errorMessage(err) });
    return result;
  }

  for (const { id } of candidates) {
    try {
      const claimed = await d.claim(id, nowIso);
      if (!claimed) continue; // another tick already claimed this row — do not publish
      result.claimed += 1;
      const outcome = await d.publish(id);
      if (outcome.state === "published") result.published += 1;
      else if (outcome.state === "failed") result.failed += 1;
    } catch (err) {
      result.failed += 1;
      log.error("publish_scheduler.publish_threw", { postId: id, error: errorMessage(err) });
    }
  }

  // Independent of the claim pass above (PUB-04): re-claim any `publishing` row a crash
  // stranded past `publishingStaleMs` and hand it to `publishPlannedPost` exactly like a
  // fresh claim. A crashed row's `updatedAt` never moves, so this pass is what recovers
  // it — nothing else in the system ever will.
  const staleCutoffIso = new Date(now.getTime() - d.publishingStaleMs).toISOString();
  let stalePublishing: { id: string }[];
  try {
    stalePublishing = await d.selectStalePublishing(staleCutoffIso, CLAIM_BATCH_SIZE);
  } catch (err) {
    log.error("publish_scheduler.select_stale_publishing_failed", { error: errorMessage(err) });
    return result;
  }

  for (const { id } of stalePublishing) {
    try {
      const reclaimed = await d.reclaimPublishing(id, nowIso, staleCutoffIso);
      if (!reclaimed) continue; // already resolved, or another tick reaped it first
      result.claimed += 1;
      log.warn("publish_scheduler.publishing_reaped", { postId: id, staleAfterMs: d.publishingStaleMs });
      const outcome = await d.publish(id);
      if (outcome.state === "published") result.published += 1;
      else if (outcome.state === "failed") result.failed += 1;
    } catch (err) {
      result.failed += 1;
      log.error("publish_scheduler.publish_threw", { postId: id, error: errorMessage(err) });
    }
  }

  let retryable: { id: string; attemptCount: number }[];
  try {
    retryable = await d.selectRetryableFailed(d.maxAttempts, CLAIM_BATCH_SIZE);
  } catch (err) {
    log.error("publish_scheduler.select_retryable_failed", { error: errorMessage(err) });
    return result;
  }

  for (const row of retryable) {
    try {
      const nextAt = new Date(now.getTime() + d.backoffMs(row.attemptCount)).toISOString();
      await d.rearmForRetry(row.id, nextAt, nowIso);
    } catch (err) {
      log.error("publish_scheduler.rearm_failed", { postId: row.id, error: errorMessage(err) });
    }
  }

  return result;
}

/**
 * Starts the interval and returns a stop function. A `let running` reentrancy guard
 * skips a tick that would overlap one still in flight — `runDuePublishes` never
 * throws, but the guard (and the belt-and-suspenders `.catch` below) mean a rejected
 * tick can never wedge `running` true and stall every tick after it forever.
 */
export function startPublishScheduler(deps: Partial<PublishSchedulerDeps> & { intervalMs?: number } = {}): () => void {
  const { intervalMs, ...schedulerDeps } = deps;
  const period = intervalMs ?? resolveTickIntervalMs();

  let running = false;
  const timer = setInterval(() => {
    if (running) return; // previous tick still in flight, skip this one
    running = true;
    runDuePublishes(new Date(), schedulerDeps)
      .catch((err) => log.error("publish_scheduler.tick_rejected", { error: errorMessage(err) }))
      .finally(() => {
        running = false;
      });
  }, period);

  return () => clearInterval(timer);
}
