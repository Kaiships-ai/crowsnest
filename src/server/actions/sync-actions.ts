"use server";

import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { log } from "../lib/logger";
import { errorMessage, type ActionResult } from "../lib/action-result";
import { IgError, SyncAlreadyRunningError } from "../ig/errors";
import { igClient, type IgClient } from "../ig/client";
import { getSetting } from "../settings";
import { addChannel, importReelByUrl, normalizeHandle, requestCancel, runSync } from "../services/sync-engine";
import { BackfillBlockedError, runViewCountBackfill } from "../services/backfill-view-counts";
import {
  SYNC_PHASES,
  type StopReason,
  type SyncGap,
  type SyncJobStatus,
  type SyncPhase,
  type SyncProgress,
} from "../services/sync-types";

/**
 * Thin "use server" wrappers around the sync engine. Every export returns a result
 * object instead of throwing across the action boundary.
 *
 * The `code` field is load-bearing: the UI has to tell "Instagram wants a security
 * challenge" apart from "the sidecar isn't running" apart from "a sync is already in
 * progress". Previously every failure collapsed into one error string.
 *
 * The other thing this module does is refuse to hold a request open for a whole sync.
 * There used to be a `syncAllAction`/`syncChannelAction` pair that awaited `runSync()`
 * end to end, so the browser sat on one pending POST for minutes and a reload threw away
 * every trace of the run. They are gone, along with the bridge exports that called them:
 * `startSyncAction` returns as soon as the lock is won and lets the run finish detached,
 * and `getSyncProgressAction` is how anyone — the tab that started it, another tab, or a
 * reload — reads it back.
 */
function toResult(err: unknown): { ok: false; error: string; code?: string } {
  if (err instanceof IgError) return { ok: false, error: err.userMessage, code: err.code };
  if (err instanceof SyncAlreadyRunningError) return { ok: false, error: err.message, code: err.code };
  // Carries its own code so the UI can say "a sync is running, try again after" rather
  // than showing a backfill refusal as a generic failure. It is not a fault.
  if (err instanceof BackfillBlockedError) return { ok: false, error: err.message, code: err.code };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function errorCodeOf(err: unknown): string {
  if (err instanceof IgError) return err.code;
  if (err instanceof SyncAlreadyRunningError) return err.code;
  return "IG_UNKNOWN";
}

// ---------------------------------------------------------------- detached start

/**
 * Ceiling on the wait for the lock step. `acquireLock` is the first thing `runSync`
 * does and SQLite is in-process, so this is only ever reached if the database itself is
 * wedged — and answering with an error beats leaving the POST hanging with no response
 * at all.
 */
const LOCK_TIMEOUT_MS = 10_000;

/**
 * Records a detached run's crash on its own row. `runSync` already writes a terminal
 * `failed` row for errors it catches, so the guard on `status = 'running'` means this
 * never clobbers the engine's own bookkeeping — it only fires when the engine's write
 * was itself what threw. Its real job is that the rejection is handled at all: an
 * un-awaited promise that rejects takes the Node process down with it.
 */
async function markJobFailed(jobId: string, err: unknown): Promise<void> {
  try {
    await db
      .update(tables.syncJobs)
      .set({
        status: "failed",
        finishedAt: nowIso(),
        errorCode: errorCodeOf(err),
        errorMessage: errorMessage(err),
      })
      .where(and(eq(tables.syncJobs.id, jobId), eq(tables.syncJobs.status, "running")));
  } catch (writeErr) {
    log.error("sync.detached.record_failed", { jobId, message: errorMessage(writeErr) });
  }
}

/**
 * Starts a sync and returns the moment the engine has won the lock — not when the run
 * finishes. Everything after that is read back through `getSyncProgressAction`.
 *
 * The id handed back always names a row that really exists and a run this call really
 * owns, because it comes from the engine's `onJobStarted`: that hook fires once,
 * immediately after `acquireLock` wins and before any network call, and never fires on
 * the losing side of the lock. So "callback fired" and "we own a job row" are the same
 * statement — there is nothing to reconstruct and nothing to race.
 *
 * Losing the lock arrives instead as a `SyncAlreadyRunningError` rejection, surfaced
 * with its code so the UI can say "a sync is already running" and attach to that job
 * rather than reporting a hard failure.
 */
export async function startSyncAction(channelIds?: string[]): Promise<ActionResult<{ jobId: string }>> {
  try {
    let resolveJobId: (id: string | null) => void = () => {};
    // Resolves to the id when the lock is won, or to null when the run ends without
    // ever winning it. Settling it on both paths is what stops this action hanging.
    const jobIdKnown = new Promise<string | null>((resolve) => {
      resolveJobId = resolve;
    });

    let failure: unknown;

    void runSync({
      ...(channelIds ? { channelIds } : {}),
      onJobStarted: resolveJobId,
    }).then(
      () => {},
      async (err: unknown) => {
        failure = err;
        // No-op when the lock was won (the first resolve wins); the point is the case
        // where it was not, so the await below cannot deadlock.
        resolveJobId(null);
        const jobId = await jobIdKnown;
        log.error("sync.detached.failed", { jobId, code: errorCodeOf(err), message: errorMessage(err) });
        if (jobId) await markJobFailed(jobId, err);
      }
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const jobId = await Promise.race([
      jobIdKnown,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCK_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    if (!jobId) {
      if (failure !== undefined) return toResult(failure);
      // The run neither won the lock nor failed within the ceiling. Nothing truthful can
      // be said about a job id here, so none is invented.
      return {
        ok: false,
        error: `Sync did not start: the lock was not acquired within ${LOCK_TIMEOUT_MS}ms`,
        code: "SYNC_NOT_STARTED",
      };
    }

    log.info("sync.started.detached", { jobId });
    return { ok: true, jobId };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Starts the view-count backfill and returns as soon as its job row exists, for the same
 * reason `startSyncAction` does: the run can take minutes and no browser should hold a
 * POST open for it. Progress and cancel both go through the ordinary run machinery, since
 * a backfill IS a `sync_jobs` row — `getSyncProgressAction` and `cancelSyncAction` work on
 * the returned id unchanged.
 *
 * Refuses, rather than queues, while a sync is running. The backfill always yields.
 */
export async function startViewCountBackfillAction(): Promise<ActionResult<{ jobId: string }>> {
  try {
    let resolveJobId: (id: string | null) => void = () => {};
    const jobIdKnown = new Promise<string | null>((resolve) => {
      resolveJobId = resolve;
    });

    let failure: unknown;
    void runViewCountBackfill({ onJobStarted: resolveJobId }).then(
      () => {},
      async (err: unknown) => {
        failure = err;
        resolveJobId(null);
        log.error("backfill.detached.failed", { code: errorCodeOf(err), message: errorMessage(err) });
      }
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const jobId = await Promise.race([
      jobIdKnown,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOCK_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);

    if (!jobId) {
      // The common case here is the deliberate refusal (a sync holds the upstream), which
      // rejects before a row is ever inserted, so `failure` is set and carries its code.
      if (failure !== undefined) return toResult(failure);
      return { ok: false, error: `Backfill did not start within ${LOCK_TIMEOUT_MS}ms`, code: "BACKFILL_NOT_STARTED" };
    }

    log.info("backfill.started.detached", { jobId });
    return { ok: true, jobId };
  } catch (err) {
    return toResult(err);
  }
}

// ---------------------------------------------------------------- progress

/**
 * `gaps` is read as raw text rather than through drizzle's JSON mapper on purpose: a
 * malformed blob makes the mapper throw during the SELECT itself, which would blank the
 * whole progress panel over one bad row. Parsing it here lets it degrade to "no gaps".
 */
const progressColumns = {
  id: tables.syncJobs.id,
  /** Not part of `SyncProgress` — it is the run's scope, and the channel-scoped lookup
   *  needs it to say whether a job is this channel's own run or a library-wide one. */
  channelId: tables.syncJobs.channelId,
  status: tables.syncJobs.status,
  phase: tables.syncJobs.phase,
  currentChannelHandle: tables.syncJobs.currentChannelHandle,
  channelsTotal: tables.syncJobs.channelsTotal,
  channelsDone: tables.syncJobs.channelsDone,
  startedAt: tables.syncJobs.startedAt,
  finishedAt: tables.syncJobs.finishedAt,
  heartbeatAt: tables.syncJobs.heartbeatAt,
  itemsSeen: tables.syncJobs.itemsSeen,
  itemsCreated: tables.syncJobs.itemsCreated,
  itemsUpdated: tables.syncJobs.itemsUpdated,
  itemsFailed: tables.syncJobs.itemsFailed,
  itemsDeleted: tables.syncJobs.itemsDeleted,
  assetsDownloaded: tables.syncJobs.assetsDownloaded,
  assetsFailed: tables.syncJobs.assetsFailed,
  retries: tables.syncJobs.retries,
  stopReason: tables.syncJobs.stopReason,
  errorCode: tables.syncJobs.errorCode,
  errorMessage: tables.syncJobs.errorMessage,
  cancelRequested: tables.syncJobs.cancelRequested,
  lookbackDays: tables.syncJobs.lookbackDays,
  gapsRaw: sql<string | null>`${tables.syncJobs.gaps}`,
};

async function selectProgressRow(where: SQL | undefined) {
  const [row] = await db
    .select(progressColumns)
    .from(tables.syncJobs)
    .where(where)
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1);
  return row ?? null;
}

type ProgressRow = NonNullable<Awaited<ReturnType<typeof selectProgressRow>>>;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * A gap blob is written by the engine and read a poll later, so it is not trusted here:
 * a run killed mid-write, or a row from before `handle`/`code` were added, must cost the
 * panel its gap list and nothing else.
 */
function parseGaps(raw: string | null): SyncGap[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn("sync.progress.gaps_unparseable", { length: raw.length });
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const gaps: SyncGap[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const g = entry as Record<string, unknown>;
    const channelId = asString(g.channelId);
    // Without a channel id a gap cannot be named or retried, so it is not a gap.
    if (!channelId) continue;
    gaps.push({
      channelId,
      // Falls back to the id, not "". Most gap rows in an existing database pre-date the
      // `handle` field, and an empty string renders a blank channel name above an
      // unnamed Retry button — an id the user can at least paste into search is strictly
      // more use than nothing.
      handle: asString(g.handle) ?? channelId,
      provider: asString(g.provider) ?? "",
      error: asString(g.error) ?? "",
      code: asString(g.code),
    });
  }
  return gaps;
}

// B3 (review-engineering-2026-07-31.md §3): maxItems used to echo config.MAX_ITEMS_PER_SYNC
// directly, bypassing the settings module's DB-over-env-over-default precedence entirely.
// It now reads the same maxItemsPerSync setting runSync itself resolves, which is why this
// is async where it used to be a plain sync formatter.
async function toProgress(row: ProgressRow): Promise<SyncProgress> {
  const phase = (SYNC_PHASES as readonly string[]).includes(row.phase ?? "") ? (row.phase as SyncPhase) : null;
  const maxItems = await getSetting("maxItemsPerSync");
  return {
    jobId: row.id,
    status: row.status as SyncJobStatus,
    phase,
    currentChannelHandle: row.currentChannelHandle,
    channelsTotal: row.channelsTotal,
    channelsDone: row.channelsDone,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    heartbeatAt: row.heartbeatAt,
    itemsSeen: row.itemsSeen,
    itemsCreated: row.itemsCreated,
    itemsUpdated: row.itemsUpdated,
    itemsFailed: row.itemsFailed,
    itemsDeleted: row.itemsDeleted,
    assetsDownloaded: row.assetsDownloaded,
    assetsFailed: row.assetsFailed,
    retries: row.retries,
    stopReason: row.stopReason as StopReason | null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    gaps: parseGaps(row.gapsRaw),
    cancelRequested: row.cancelRequested,
    lookbackDays: row.lookbackDays,
    maxItems,
  };
}

/**
 * One poll's worth of truth about a run. Called with no id it answers "whatever is
 * happening right now" — the running job if there is one, otherwise the most recent
 * finished one. That fallback is what lets a fresh tab, or a reload, pick up a run
 * started by another tab instead of showing nothing.
 */
export async function getSyncProgressAction(jobId?: string | null): Promise<ActionResult<{ progress: SyncProgress | null }>> {
  try {
    const row = jobId
      ? await selectProgressRow(eq(tables.syncJobs.id, jobId))
      : ((await selectProgressRow(eq(tables.syncJobs.status, "running"))) ?? (await selectProgressRow(undefined)));
    return { ok: true, progress: row ? await toProgress(row) : null };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Which runs actually touch one channel: a run scoped to exactly it, or a library-wide
 * run, which walks every channel and therefore covers it too. A run scoped to a
 * DIFFERENT channel covers nothing here.
 */
function coversChannel(channelId: string): SQL | undefined {
  return or(eq(tables.syncJobs.channelId, channelId), isNull(tables.syncJobs.channelId));
}

/**
 * The same poll, scoped to one channel — what a channel page needs, and what it could
 * not get before: `getSyncProgressAction` keys on job id alone, so a channel page that
 * mounted fresh surfaced whatever run happened to be in flight and disabled its own
 * sync button over an unrelated channel's run.
 *
 * `coverage` is returned alongside because `SyncProgress` describes a run, not a run's
 * relationship to a channel, and the two cases need different words in the UI: `channel`
 * is this channel's own run, `library` is a whole-library run that includes it and is a
 * truthful reason to disable the button, `null` is nothing to show.
 *
 * Falls back to the most recent finished run that covered this channel, mirroring the
 * global lookup, so the page can still show a last-run summary between syncs.
 */
export async function getChannelSyncProgressAction(
  channelId: string
): Promise<ActionResult<{ progress: SyncProgress | null; coverage: "channel" | "library" | null }>> {
  try {
    const live = await db
      .select(progressColumns)
      .from(tables.syncJobs)
      .where(and(eq(tables.syncJobs.status, "running"), coversChannel(channelId)))
      // Specificity first (`channel_id IS NULL` sorts 0 before 1), then newest. Only
      // matters while a library run and a per-channel run can hold their separate lock
      // keys at once: this channel's own run describes it better than the library's does.
      .orderBy(sql`${tables.syncJobs.channelId} is null`, desc(tables.syncJobs.startedAt))
      .limit(2);

    if (live.length > 1) {
      // Two live runs walking one channel is a lock-scope bug, not a display problem.
      // Picking one deterministically keeps the page honest; the log is the evidence.
      log.warn("sync.progress.channel_covered_twice", { channelId, jobIds: live.map((r) => r.id) });
    }

    const row = live[0] ?? (await selectProgressRow(coversChannel(channelId)));
    if (!row) return { ok: true, progress: null, coverage: null };

    return {
      ok: true,
      progress: await toProgress(row),
      coverage: row.channelId === null ? "library" : "channel",
    };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Co-operative cancel. The engine owns the semantics — this only asks, and the run stops
 * at its next page or channel boundary keeping everything already committed.
 *
 * Cancelling a job that already finished is not an error, but it is not a success
 * either: `requested` is the engine's own answer to "was there still something to
 * cancel", passed through rather than flattened into a green tick over a run that had
 * already ended.
 */
export async function cancelSyncAction(jobId: string): Promise<ActionResult<{ requested: boolean }>> {
  try {
    return { ok: true, requested: await requestCancel(jobId) };
  } catch (err) {
    return toResult(err);
  }
}

// ---------------------------------------------------------------- channels

/**
 * Adds a channel. `requireProfile` picks between the two things callers mean by "add".
 *
 * `addChannel()` treats the profile fetch as best-effort: when it fails it still writes a
 * thin row with syncError set. First-run needs exactly that, because /profile needs a
 * logged-in sidecar and onboarding collects handles before the login step — see
 * `components/first-run/sources-step.tsx`. So the default stays lenient.
 *
 * The add-channel dialog wants the opposite. A handle that cannot be resolved is usually
 * a typo, and the old behaviour tracked it anyway while the reason went only to /logs, so
 * the user got a permanently broken column and no explanation. With `requireProfile` the
 * fetch is hoisted here, ahead of any insert: it throws, nothing is written, and the
 * IgError's userMessage is what the dialog shows.
 *
 * The resolved profile is then handed back down through the `client` dep, so
 * `addChannel`'s own `client.profile(handle)` is served from here and the sidecar is
 * still asked exactly once. The already-tracked check below mirrors `addChannel`'s own
 * short-circuit for the same reason it exists there: re-adding a live channel is a no-op,
 * and it should not start failing just because Instagram happens to be unreachable.
 */
export async function addChannelAction(
  handle: string,
  opts: { requireProfile?: boolean } = {}
): Promise<ActionResult<{ channelId: string }>> {
  try {
    if (!opts.requireProfile) return { ok: true, ...(await addChannel({ handle })) };

    // normalizeHandle throws on junk ("has spaces", a non-Instagram URL) before anything
    // reaches the network, and gives the fetch below the same string addChannel will use.
    const normalized = normalizeHandle(handle);
    const live = await db
      .select({ id: tables.channels.id })
      .from(tables.channels)
      .where(
        and(
          eq(tables.channels.platform, "instagram"),
          eq(tables.channels.handle, normalized),
          isNull(tables.channels.deletedAt)
        )
      )
      .limit(1);
    if (live[0]) return { ok: true, channelId: live[0].id };

    const profile = await igClient.profile(normalized);
    const client: IgClient = { ...igClient, profile: async () => profile };
    return { ok: true, ...(await addChannel({ handle: normalized }, { client })) };
  } catch (err) {
    // The old channel.add.profile_failed line was the only record of this; keep a record,
    // now that the user gets the reason on screen rather than instead of it.
    if (opts.requireProfile) {
      log.warn("channel.add.rejected", { handle, code: errorCodeOf(err), message: errorMessage(err) });
    }
    return toResult(err);
  }
}

export async function importReelAction(url: string): Promise<ActionResult<{ videoId: string; channelId: string }>> {
  try {
    return { ok: true, ...(await importReelByUrl(url)) };
  } catch (err) {
    return toResult(err);
  }
}

/** The settings page's "last sync" summary — the whole row, not a progress projection. */
export async function getLatestSyncJob(): Promise<ActionResult<{ job: typeof tables.syncJobs.$inferSelect | null }>> {
  try {
    const rows = await db.select().from(tables.syncJobs).orderBy(desc(tables.syncJobs.startedAt)).limit(1);
    return { ok: true, job: rows[0] ?? null };
  } catch (err) {
    return toResult(err);
  }
}
