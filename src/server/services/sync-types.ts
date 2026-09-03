/**
 * The wire contract for live sync progress — shared by the engine (writer), the Server
 * Actions (reader), and the client components (renderer).
 *
 * It lives in its own module for a hard reason: `sync-actions.ts` is a `"use server"`
 * file, and such a file may only export async functions. A type exported from there is
 * a build error, so the shape everyone agrees on cannot live next to the actions that
 * return it.
 *
 * Why this exists at all: `sync_jobs` counters used to be written exactly once, when a
 * run finished. Anything watching a run in flight therefore had nothing truthful to
 * read, which is why "Sync now" could only ever be an indeterminate spinner. The engine
 * now flushes the fields below at every page and channel boundary.
 */

/** Where a run currently is. Ordered roughly by when it occurs within one channel. */
export const SYNC_PHASES = [
  /** Lock acquired, channel list not yet resolved. */
  "starting",
  /** Fetching the channel profile + avatar. */
  "profile",
  /** Asking Instagram for a page of media. */
  "fetching",
  /** Writing posts and downloading thumbnails from the page just fetched. */
  "saving",
  /** A retryable upstream failure is being backed off. Distinct from `fetching` so a
   *  slow-but-recovering sync reads as recovering rather than as a hang. */
  "retrying",
  /** Recomputing outlier scores for the channel just finished. */
  "scoring",
  /** All channels done; writing the terminal job row. */
  "finalizing",
] as const;

export type SyncPhase = (typeof SYNC_PHASES)[number];

export type StopReason = "lookback" | "cap" | "exhausted" | "error" | "cancelled" | "upToDate";

export type SyncJobStatus = "running" | "success" | "partial" | "failed";

/**
 * The sidebar dot's vocabulary: every run status, plus the one state that is not a run —
 * a database that has never had one.
 *
 * Derived from `SyncJobStatus` rather than spelled out again. It previously lived in
 * `queries/sync-status.ts` as its own hand-written union, which meant two lists of the
 * same statuses that nothing forced to agree; that module is gone and this is the only
 * copy left.
 */
export type SyncStatusValue = SyncJobStatus | "never";

/**
 * A channel-level failure inside an otherwise-successful run. `handle` and `code` are
 * carried alongside `channelId` so the UI can name the channel and choose a recovery
 * hint without a second query — the previous shape forced the UI to render a raw id.
 */
export interface SyncGap {
  channelId: string;
  handle: string;
  provider: string;
  error: string;
  /** IgErrorCode when the failure crossed the sidecar boundary; null otherwise. */
  code: string | null;
  /**
   * Seconds Instagram's own response asked us to wait, copied from the failing call's
   * `IgError.detail.retry_after_sec` (see `backoffMs` in sync-engine.ts). Present only
   * when the gap's code is IG_RATE_LIMITED and Instagram actually supplied a wait;
   * absent for every other code, and absent for a rate limit whose ladder ran out on a
   * guessed backoff instead of a hinted one. A consumer must not invent a countdown
   * when this is missing — an "Instagram is cooling down, no ETA given" state is
   * honest; a guessed one is exactly the fabrication the brief forbids.
   */
  retryAfterSec?: number;
}

/** Everything the progress UI renders, in one poll. */
export interface SyncProgress {
  jobId: string;
  status: SyncJobStatus;
  phase: SyncPhase | null;
  /** Denormalized so the 1 s poll never joins `channels` to print a name. */
  currentChannelHandle: string | null;
  /** Null until the run has enumerated its channel list. */
  channelsTotal: number | null;
  channelsDone: number;

  startedAt: string;
  finishedAt: string | null;
  /** Bumped on every flush. A `running` row whose heartbeat has gone quiet is how the UI
   *  distinguishes "working" from "the process died holding the lock". */
  heartbeatAt: string | null;

  itemsSeen: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsFailed: number;
  itemsDeleted: number;
  assetsDownloaded: number;
  assetsFailed: number;
  /** Retried upstream calls so far. Non-zero means the run hit trouble and recovered. */
  retries: number;

  stopReason: StopReason | null;
  errorCode: string | null;
  errorMessage: string | null;
  gaps: SyncGap[];

  cancelRequested: boolean;
  lookbackDays: number | null;
  /** MAX_ITEMS_PER_SYNC, echoed so the UI has a denominator for the item count without
   *  reading server config itself. */
  maxItems: number;
}

/** Heartbeat older than this on a `running` row means the run is presumed dead. */
export const SYNC_STALL_SECONDS = 90;

/**
 * The `sync_jobs.lock_key` a view-count backfill runs under.
 *
 * Its own key, not "__library__", and that is the whole point: a backfill row lives in
 * `sync_jobs` so the Runs screen, the cancel button and the heartbeat all work on it for
 * free, while `acquireLock` filters rows with this key out of the sync's single-flight
 * arbitration. A backfill therefore never refuses a sync. The yielding goes one way, in
 * the backfill's own start check and its per-reel look for a sync that appeared.
 *
 * Lives here rather than in either service because both read it and neither should import
 * the other for a string.
 */
export const BACKFILL_LOCK_KEY = "__backfill__";

export function isSyncStalled(p: Pick<SyncProgress, "status" | "heartbeatAt">, now = Date.now()): boolean {
  if (p.status !== "running" || !p.heartbeatAt) return false;
  return now - new Date(p.heartbeatAt).getTime() > SYNC_STALL_SECONDS * 1000;
}
