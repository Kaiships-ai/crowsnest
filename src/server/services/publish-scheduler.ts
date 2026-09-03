import { and, asc, eq, isNotNull, lt, lte } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
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
 * Everything reachable from the outside (db reads/writes, the publish call, the retry
 * policy) is injectable via `PublishSchedulerDeps`, defaulting to the real db and the
 * real `publishPlannedPost` — same deps-injection seam publish-post.ts itself uses, so
 * tests never touch the network or (for most cases) a real database.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;

/** 1m / 5m / 15m, then holds at 15m — attemptCount is 1-based (publish-post.ts writes
 *  `row.attemptCount + 1` on the failure this backoff is scheduling the retry for). */
export function defaultBackoffMs(attemptCount: number): number {
  const steps = [60_000, 5 * 60_000, 15 * 60_000];
  return steps[Math.min(Math.max(attemptCount, 1), steps.length) - 1];
}

/** Cap per tick so a large backlog of due rows can never block the interval loop for
 *  more than one tick's worth of publishes. */
const CLAIM_BATCH_SIZE = 10;

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
   *  state='scheduled'`. Returns true iff exactly one row changed. */
  claim: (id: string, nowIso: string) => Promise<boolean>;
  /** `failed` rows with `attemptCount < maxAttempts`, capped at `limit`. */
  selectRetryableFailed: (maxAttempts: number, limit: number) => Promise<{ id: string; attemptCount: number }[]>;
  /** Re-arms one failed row back to `scheduled` at `scheduledAt`, but only if it is
   *  still `failed` (same conditional-UPDATE shape as `claim`, though nothing in this
   *  single-process scheduler actually races it — see the comment on the default). */
  rearmForRetry: (id: string, scheduledAt: string, nowIso: string) => Promise<void>;
  maxAttempts: number;
  backoffMs: (attemptCount: number) => number;
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
    .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.state, "scheduled")));
  return (result as { changes?: number }).changes === 1;
}

async function defaultSelectRetryableFailed(maxAttempts: number, limit: number): Promise<{ id: string; attemptCount: number }[]> {
  return db
    .select({ id: tables.plannedPosts.id, attemptCount: tables.plannedPosts.attemptCount })
    .from(tables.plannedPosts)
    .where(and(eq(tables.plannedPosts.state, "failed"), lt(tables.plannedPosts.attemptCount, maxAttempts)))
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
  publish: (postId) => publishPlannedPost(postId),
  selectDueScheduled: defaultSelectDueScheduled,
  claim: defaultClaim,
  selectRetryableFailed: defaultSelectRetryableFailed,
  rearmForRetry: defaultRearmForRetry,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  backoffMs: defaultBackoffMs,
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
 * re-arming a retry is logged and the tick still resolves — same contract
 * `autoAnalyzeNewOutliers` (auto-analyze.ts) already uses for its own candidate query.
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
