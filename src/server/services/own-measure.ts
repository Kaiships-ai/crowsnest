import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { CLASSIFIER_VERSION, graphClient, isPermanentFailure, type GraphAccount, type GraphComment, type GraphCommentsResult, type GraphMedia, type GraphPostInsights, type PostInsightsResult } from "@/server/graph/client";
import { GraphApiError, type GraphErrorCode } from "@/server/graph/errors";
import { invalidateTokenStatus, rememberTokenStatus } from "@/server/graph/token-status";
import { OWN_AUDIENCE_FETCH_ERROR_KEY, OWN_COMMENTS_FETCH_ERROR_KEY, OWN_FOLLOWER_SPLIT_FETCH_ERROR_KEY } from "@/server/queries/own-channel";

/**
 * The one writer of the own-channel tables (own_account_snapshots, own_posts,
 * own_post_insights, own_comments, own_account_breakdowns). "Measure now" calls it with
 * scope "all"; the scheduler with scope "due". A process-wide single-flight lock covers
 * both: a due run finding the lock held returns MEASURE_BUSY, a manual run waits.
 * Comments ride Measure now every time and a due run once a day, with their call share
 * reserved ahead of the posts.
 *
 * Never deletes: a post that disappears from the account stays in own_posts with its
 * history intact. The account call failing is a hard failure (nothing to show); comments
 * failing after posts succeeded is ok with partial: true.
 */

/** Scheduled runs leave headroom under Instagram's 200 calls an hour for Measure now. */
export const OWN_MEASURE_CALL_BUDGET = 150;
/** Measure now: close to the 200-an-hour Graph limit. The rate-limit stop is the real guard. */
export const OWN_MEASURE_MANUAL_CALL_BUDGET = 190;
/** Instagram's per-account Graph limit, and the calls kept free under it for anything else. */
const GRAPH_CALLS_PER_HOUR = 200;
const GRAPH_CALL_HEADROOM = 10;

export type MeasureScope = "all" | "due";
export interface MeasureSummary {
  measuredAt: string;
  postsSeen: number;
  postsMeasured: number;
  postsFailed: number;
  commentsSeen: number;
  partial: boolean;
  callsUsed: number;
  stoppedEarly: "budget" | "rate_limited" | null;
  /** This run's budget was cut by Graph calls earlier runs spent in the last hour. */
  limitedByRecentCalls: boolean;
}
export type MeasureResult = ({ ok: true } & MeasureSummary) | { ok: false; error: string; code: GraphErrorCode | "MEASURE_BUSY" };

export function messageOf(err: unknown): string {
  if (err instanceof GraphApiError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}

export function toFailure(err: unknown): { ok: false; error: string; code: GraphErrorCode } {
  if (err instanceof GraphApiError) return { ok: false, error: err.userMessage, code: err.code };
  log.error("graph.action.unexpected", { error: messageOf(err) });
  return { ok: false, error: messageOf(err), code: "GRAPH_UNKNOWN" };
}

const HOUR_MS = 3_600_000;
/** app_settings key holding when comments last pulled successfully; a scheduled run
 *  refreshes them once this is a day old (Measure now always does). */
const OWN_COMMENTS_FETCHED_AT_KEY = "own_comments_fetched_at";
const NEW_REEL_WINDOW_MS = 72 * HOUR_MS;
/** An hourly tick can land a little before the hour since the last capture; without slack
 *  that post would slip a whole hour (or day). */
const DUE_SLACK_MS = 5 * 60_000;

/** A post's failed captures since it was last measured successfully (none measured yet). */
export interface CaptureFailures {
  /** Newest failed capturedAt. */
  at: string;
  count: number;
  /** The newest failure is a non-transient invalid_request (for example code 100). */
  permanent: boolean;
}

/** Hourly while a post is under 72 hours old, daily after, each with five minutes of slack. A post never captured
 *  successfully is due at once, but backs off after a failure: one retry an hour later,
 *  then daily, and daily from the first failure when Instagram refused the request itself.
 *  Derived from stored captures on every tick, so the scheduler keeps no state. */
export function isDue(postedAt: string, lastCapturedAt: string | null, now: Date, failures: CaptureFailures | null = null): boolean {
  if (lastCapturedAt === null) {
    if (failures === null) return true;
    const wait = failures.count === 1 && !failures.permanent ? HOUR_MS : 24 * HOUR_MS;
    return now.getTime() - Date.parse(failures.at) >= wait - DUE_SLACK_MS;
  }
  const age = now.getTime() - Date.parse(postedAt);
  const sinceCapture = now.getTime() - Date.parse(lastCapturedAt);
  return sinceCapture >= (age < NEW_REEL_WINDOW_MS ? HOUR_MS : 24 * HOUR_MS) - DUE_SLACK_MS;
}

async function captureStateByExternalId(externalIds: string[]): Promise<{ lastOk: Map<string, string>; failures: Map<string, CaptureFailures> }> {
  const lastOk = new Map<string, string>();
  const failures = new Map<string, CaptureFailures>();
  if (externalIds.length === 0) return { lastOk, failures };
  // One row per post: max() over our own capturedAt, which is always toISOString() ("Z",
  // fixed width), so the string max is the newest. A failed capture (fetchError set) is
  // not a measurement, so it never makes a post look fresh.
  const rows = await db
    .select({ externalId: tables.ownPosts.externalId, capturedAt: sql<string>`max(${tables.ownPostInsights.capturedAt})` })
    .from(tables.ownPostInsights)
    .innerJoin(tables.ownPosts, eq(tables.ownPosts.id, tables.ownPostInsights.ownPostId))
    .where(and(inArray(tables.ownPosts.externalId, externalIds), isNull(tables.ownPostInsights.fetchError)))
    .groupBy(tables.ownPosts.externalId);
  for (const r of rows) lastOk.set(r.externalId, r.capturedAt);
  // Failed rows only matter for a post with no success; the backoff keeps them to about one a day.
  const neverOk = externalIds.filter((id) => !lastOk.has(id));
  if (neverOk.length === 0) return { lastOk, failures };
  const failed = await db
    .select({ externalId: tables.ownPosts.externalId, capturedAt: tables.ownPostInsights.capturedAt, fetchError: tables.ownPostInsights.fetchError })
    .from(tables.ownPostInsights)
    .innerJoin(tables.ownPosts, eq(tables.ownPosts.id, tables.ownPostInsights.ownPostId))
    .where(and(inArray(tables.ownPosts.externalId, neverOk), isNotNull(tables.ownPostInsights.fetchError)))
    .orderBy(desc(tables.ownPostInsights.capturedAt));
  for (const f of failed) {
    const seen = failures.get(f.externalId);
    if (seen) seen.count += 1;
    else failures.set(f.externalId, { at: f.capturedAt, count: 1, permanent: isPermanentFailure(f.fetchError ?? "") });
  }
  return { lastOk, failures };
}

async function breakdownsStale(now: Date): Promise<boolean> {
  const [newest] = await db.select({ capturedAt: tables.ownAccountBreakdowns.capturedAt }).from(tables.ownAccountBreakdowns).orderBy(desc(tables.ownAccountBreakdowns.capturedAt)).limit(1);
  return !newest || now.getTime() - Date.parse(newest.capturedAt) >= 24 * HOUR_MS;
}

async function commentsDue(scope: MeasureScope, now: Date): Promise<boolean> {
  if (scope === "all") return true;
  const [row] = await db.select({ value: tables.appSettings.value }).from(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCHED_AT_KEY)).limit(1);
  return !row || now.getTime() - Date.parse(row.value) >= 24 * HOUR_MS;
}

async function setAppSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.delete(tables.appSettings).where(eq(tables.appSettings.key, key));
    return;
  }
  await db.insert(tables.appSettings).values({ key, value }).onConflictDoUpdate({ target: tables.appSettings.key, set: { value } });
}

/** Upserts one own_posts row keyed on externalId (the Graph media id). Returns the
 *  internal row id so the caller can attach an insights row to it. lastMeasuredAt is
 *  set separately, only once the post's insights land. */
async function upsertOwnPost(m: GraphMedia, seenAt: string): Promise<string> {
  const [existing] = await db.select({ id: tables.ownPosts.id }).from(tables.ownPosts).where(eq(tables.ownPosts.externalId, m.externalId)).limit(1);
  const common = {
    permalink: m.permalink, mediaType: m.mediaType, productType: m.productType, format: m.format,
    caption: m.caption, postedAt: m.postedAt, thumbnailUrl: m.thumbnailUrl,
  };
  if (existing) {
    await db.update(tables.ownPosts).set(common).where(eq(tables.ownPosts.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await db.insert(tables.ownPosts).values({ id, externalId: m.externalId, ...common, firstSeenAt: seenAt });
  return id;
}

function insightColumns(i: GraphPostInsights) {
  return {
    reach: i.reach, saved: i.saved, shares: i.shares, totalInteractions: i.totalInteractions, comments: i.comments,
    likes: i.likes, views: i.views, profileVisits: i.profileVisits, followsFromPost: i.followsFromPost,
    watchTimeSec: i.watchTimeSec, reposts: i.reposts, skipRate: i.skipRate, bioLinkTaps: i.bioLinkTaps,
    avgWatchTimeMs: i.avgWatchTimeMs, totalWatchTimeMs: i.totalWatchTimeMs, fetchError: i.error,
  };
}

/** Upserts one own_comments row keyed on externalId (the Graph comment id). A comment
 *  whose post permalink does not match any known own_posts row is skipped rather than
 *  failing the whole run: own_comments.own_post_id is NOT NULL, so a comment that
 *  cannot be linked cannot be stored. */
async function upsertOwnComment(comment: GraphComment, postIdByPermalink: Map<string, string>): Promise<boolean> {
  const ownPostId = postIdByPermalink.get(comment.permalink);
  if (!ownPostId) {
    log.warn("graph.comment.orphaned", { permalink: comment.permalink });
    return false;
  }

  const [existing] = await db.select({ id: tables.ownComments.id }).from(tables.ownComments).where(eq(tables.ownComments.externalId, comment.externalId)).limit(1);
  const common = {
    author: comment.author,
    text: comment.text,
    postedAt: comment.postedAt,
    kind: comment.kind,
    classifierVersion: CLASSIFIER_VERSION,
    capturedAt: nowIso(),
  };

  if (existing) {
    await db.update(tables.ownComments).set(common).where(eq(tables.ownComments.id, existing.id));
  } else {
    await db.insert(tables.ownComments).values({ id: newId(), ownPostId, externalId: comment.externalId, ...common });
  }
  return true;
}

/** Auth and rate-limit failures end a run; any other failure is per-item. */
function fatalStop(err: unknown): GraphApiError | null {
  return err instanceof GraphApiError && (err.code === "GRAPH_AUTH_FAILED" || err.code === "GRAPH_RATE_LIMITED") ? err : null;
}

async function measureComments(
  account: GraphAccount,
  media: GraphMedia[],
  measuredAt: string
): Promise<{ commentsSeen: number; partial: boolean; callsUsed: number; stop: GraphApiError | null }> {
  let fetched: GraphCommentsResult;
  try {
    fetched = await graphClient.fetchComments(account.username, media);
  } catch (err) {
    // Not configured, or a malformed comment mid-pull: count one call.
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(err));
    log.warn("graph.measure.comments_failed", { message: messageOf(err) });
    return { commentsSeen: 0, partial: true, callsUsed: 1, stop: fatalStop(err) };
  }
  const { comments, callsUsed, stop } = fetched;
  const allOwnPosts = await db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts);
  const postIdByPermalink = new Map(allOwnPosts.map((p) => [p.permalink, p.id]));
  for (const c of comments) await upsertOwnComment(c, postIdByPermalink);
  if (stop) {
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(stop));
    log.warn("graph.measure.comments_failed", { message: messageOf(stop) });
    return { commentsSeen: comments.length, partial: true, callsUsed, stop };
  }
  await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, null);
  await setAppSetting(OWN_COMMENTS_FETCHED_AT_KEY, measuredAt);
  return { commentsSeen: comments.length, partial: false, callsUsed, stop: null };
}

async function runMeasure(opts: { scope: MeasureScope; now: Date; budget?: number }): Promise<MeasureResult> {
  const now = opts.now;
  let callsUsed = 0;
  const runBudget = opts.budget ?? (opts.scope === "all" ? OWN_MEASURE_MANUAL_CALL_BUDGET : OWN_MEASURE_CALL_BUDGET);
  const budget = Math.min(runBudget, GRAPH_CALLS_PER_HOUR - callsInLastHour(now) - GRAPH_CALL_HEADROOM);
  const limitedByRecentCalls = budget < runBudget;

  let account: GraphAccount;
  try {
    callsUsed += 1;
    account = await graphClient.fetchAccount();
  } catch (err) {
    return toFailure(err);
  }

  const measuredAt = now.toISOString();
  await db.insert(tables.ownAccountSnapshots).values({
    id: newId(), capturedAt: measuredAt, externalId: account.id, username: account.username,
    followerCount: account.followersCount, followsCount: account.followsCount, mediaCount: account.mediaCount,
  });

  let media: GraphMedia[];
  try {
    callsUsed += 1;
    media = await graphClient.fetchMedia();
  } catch (err) {
    return toFailure(err);
  }

  // Every listed post is stored up front, so a post the run never reaches (budget, rate
  // limit, a thrown call) still exists in own_posts and is due next tick.
  const ownPostIdByExternalId = new Map<string, string>();
  for (const m of media) ownPostIdByExternalId.set(m.externalId, await upsertOwnPost(m, measuredAt));

  const captures = opts.scope === "due" ? await captureStateByExternalId(media.map((m) => m.externalId)) : null;
  const inScope = captures === null ? media : media.filter((m) => isDue(m.postedAt, captures.lastOk.get(m.externalId) ?? null, now, captures.failures.get(m.externalId) ?? null));

  // Comments cost 1 call per post with comments (they reuse this run's media list). Their
  // share is reserved before the post loop so a full account still gets them.
  const commentCalls = (await commentsDue(opts.scope, now)) ? media.filter((m) => (m.commentsCount ?? 0) > 0).length : 0;

  let postsMeasured = 0;
  let postsFailed = 0;
  let stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  for (const m of inScope) {
    // Reserve the calls a post needs: one insights call, plus profile_activity for a reel.
    // A rare core-set fallback can add one more; the rate-limit stop guards that edge.
    if (callsUsed + (m.productType === "REELS" ? 2 : 1) + commentCalls > budget) {
      stoppedEarly = "budget";
      break;
    }
    let fetched: PostInsightsResult;
    try {
      fetched = await graphClient.fetchPostInsights(m);
    } catch (err) {
      // The token vanished mid-run: every other post would throw the same way.
      if (err instanceof GraphApiError && err.code === "GRAPH_NOT_CONFIGURED") return toFailure(err);
      const fatal = fatalStop(err);
      if (!fatal) {
        callsUsed += 1;
        log.warn("own_measure.post_failed", { externalId: m.externalId, error: messageOf(err) });
        // Stored as a failed capture so isDue backs this post off like any other failure.
        await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId: ownPostIdByExternalId.get(m.externalId) as string, capturedAt: measuredAt, fetchError: messageOf(err) });
        postsFailed += 1;
        continue;
      }
      fetched = { insights: null, callsUsed: 1, stop: fatal };
    }
    callsUsed += fetched.callsUsed;
    if (fetched.insights) {
      const ownPostId = ownPostIdByExternalId.get(m.externalId) as string;
      if (!fetched.insights.error) await db.update(tables.ownPosts).set({ lastMeasuredAt: measuredAt }).where(eq(tables.ownPosts.id, ownPostId));
      await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(fetched.insights) });
      if (fetched.insights.error) postsFailed += 1;
      else postsMeasured += 1;
    }
    // A dead token, or one without the insights permission, ends the run as a failure
    // (rows already written stay), so the action surfaces it and the scheduler logs
    // failed. A rate limit stops the run early.
    if (fetched.stop && fetched.stop.code !== "GRAPH_RATE_LIMITED") return toFailure(fetched.stop);
    if (fetched.stop) {
      stoppedEarly = "rate_limited";
      break;
    }
  }

  let commentsSeen = 0;
  let partial = false;
  if (commentCalls > 0) {
    if (stoppedEarly === "rate_limited" || callsUsed + commentCalls > budget) {
      partial = true;
      await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, "Comments skipped: this run's Graph call budget was spent.");
    } else {
      const c = await measureComments(account, media, measuredAt);
      ({ commentsSeen, partial } = c);
      callsUsed += c.callsUsed;
      if (c.stop?.code === "GRAPH_AUTH_FAILED") return toFailure(c.stop);
      if (c.stop) stoppedEarly = "rate_limited";
    }
  }

  // ponytail: when every breakdown call is refused no row lands, so this retries each
  // tick (4 calls an hour); store a refusal timestamp if that ever matters.
  if (stoppedEarly === null && callsUsed + 4 <= budget && (await breakdownsStale(now))) {
    try {
      const b = await graphClient.fetchAccountBreakdowns();
      callsUsed += b.callsUsed;
      if (b.rows.length > 0) {
        await db.insert(tables.ownAccountBreakdowns).values(b.rows.map((r) => ({ id: newId(), capturedAt: measuredAt, ...r })));
      }
      // Stored even when a later audience call stopped the run: the split call itself
      // finished. Undefined when the split call was the stop, so nothing is stored.
      if (b.splitError !== undefined) await setAppSetting(OWN_FOLLOWER_SPLIT_FETCH_ERROR_KEY, b.splitError);
      if (b.stop?.code === "GRAPH_AUTH_FAILED") return toFailure(b.stop);
      if (b.stop) stoppedEarly = "rate_limited";
      else await setAppSetting(OWN_AUDIENCE_FETCH_ERROR_KEY, b.audienceError);
    } catch (err) {
      // Only a non-Graph failure lands here (the client returns auth and rate limit as stop).
      log.warn("own_measure.breakdowns_failed", { error: messageOf(err) });
    }
  }

  rememberTokenStatus({ configured: true, username: account.username, state: "ok", message: null, checkedAt: measuredAt });
  log.info("graph.measure.done", { scope: opts.scope, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed });
  return { ok: true, measuredAt, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed, stoppedEarly, limitedByRecentCalls };
}

/** Process-wide state on globalThis: tsx server.ts (the scheduler) and Next's bundle
 *  (Measure now) each load their own copy of this module in the same process, so a
 *  module-level lock would let both run at once. Read through a function so a test can
 *  drop it. */
interface OwnMeasureState {
  inFlight: Promise<MeasureResult> | null;
  /** Graph calls each finished run spent, by run start: the shared hourly ledger. */
  calls: { at: number; n: number }[];
}
function shared(): OwnMeasureState {
  const g = globalThis as { __crowsnestOwnMeasure?: OwnMeasureState };
  return (g.__crowsnestOwnMeasure ??= { inFlight: null, calls: [] });
}

function callsInLastHour(now: Date): number {
  const t = now.getTime();
  const s = shared();
  s.calls = s.calls.filter((c) => c.at > t - HOUR_MS);
  return s.calls.filter((c) => c.at <= t).reduce((sum, c) => sum + c.n, 0);
}

export async function measureOwnChannel(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult> {
  const state = shared();
  if (state.inFlight && opts.scope === "due") return { ok: false, error: "A measurement is already running.", code: "MEASURE_BUSY" };
  while (state.inFlight) await state.inFlight.catch(() => undefined);
  const now = opts.now ?? new Date();
  const run = runMeasure({ ...opts, now });
  state.inFlight = run;
  try {
    const result = await run;
    // ponytail: a failed run's calls are not counted (it ended on its first auth or
    // permission refusal, a few calls); thread callsUsed through failures if that matters.
    if (result.ok) state.calls.push({ at: now.getTime(), n: result.callsUsed });
    // A dead token must not keep reading as connected from the cached status.
    if (!result.ok && result.code === "GRAPH_AUTH_FAILED") invalidateTokenStatus();
    // The account call still works without insights, so a live check would read ok:
    // remember the refusal instead so the screen shows the permission state.
    if (!result.ok && result.code === "GRAPH_PERMISSION_DENIED") {
      rememberTokenStatus({ configured: true, username: null, state: "permission_denied", message: result.error, checkedAt: new Date().toISOString() });
    }
    return result;
  } finally {
    if (state.inFlight === run) state.inFlight = null;
  }
}
