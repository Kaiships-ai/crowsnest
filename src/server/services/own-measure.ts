import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { CLASSIFIER_VERSION, graphClient, type GraphAccount, type GraphComment, type GraphCommentsResult, type GraphMedia, type GraphPostInsights, type PostInsightsResult } from "@/server/graph/client";
import { GraphApiError, type GraphErrorCode } from "@/server/graph/errors";
import { OWN_AUDIENCE_FETCH_ERROR_KEY, OWN_COMMENTS_FETCH_ERROR_KEY } from "@/server/queries/own-channel";

/**
 * The one writer of the own-channel tables (own_account_snapshots, own_posts,
 * own_post_insights, own_comments, own_account_breakdowns). "Measure now" calls it with
 * scope "all"; the scheduler with scope "due". A module-level single-flight lock covers
 * both: a due run finding the lock held returns MEASURE_BUSY, a manual run waits.
 * Comments ride Measure now every time and a due run once a day, with their call share
 * reserved ahead of the posts.
 *
 * Never deletes: a post that disappears from the account stays in own_posts with its
 * history intact. The account call failing is a hard failure (nothing to show); comments
 * failing after posts succeeded is ok with partial: true.
 */

export const OWN_MEASURE_CALL_BUDGET = 150;

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

/** Hourly while a post is under 72 hours old, daily after, and always when never captured
 *  successfully (a failed capture is retried next tick).
 *  Derived from stored captures on every tick, so the scheduler keeps no state. */
export function isDue(postedAt: string, lastCapturedAt: string | null, now: Date): boolean {
  if (lastCapturedAt === null) return true;
  const age = now.getTime() - Date.parse(postedAt);
  const sinceCapture = now.getTime() - Date.parse(lastCapturedAt);
  return sinceCapture >= (age < NEW_REEL_WINDOW_MS ? HOUR_MS : 24 * HOUR_MS);
}

async function latestCaptureByExternalId(externalIds: string[]): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  // One row per post: max() over our own capturedAt, which is always toISOString() ("Z",
  // fixed width), so the string max is the newest. A failed capture (fetchError set) is
  // not a measurement, so it never makes a post look fresh.
  const rows = await db
    .select({ externalId: tables.ownPosts.externalId, capturedAt: sql<string>`max(${tables.ownPostInsights.capturedAt})` })
    .from(tables.ownPostInsights)
    .innerJoin(tables.ownPosts, eq(tables.ownPosts.id, tables.ownPostInsights.ownPostId))
    .where(and(inArray(tables.ownPosts.externalId, externalIds), isNull(tables.ownPostInsights.fetchError)))
    .groupBy(tables.ownPosts.externalId);
  return new Map(rows.map((r) => [r.externalId, r.capturedAt]));
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
 *  cannot be linked cannot be stored, and `fetchComments`'s own media page (limit 50)
 *  is not guaranteed to be the exact same set `fetchMedia` returned. */
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
  measuredAt: string
): Promise<{ commentsSeen: number; partial: boolean; callsUsed: number; stop: GraphApiError | null }> {
  let fetched: GraphCommentsResult;
  try {
    fetched = await graphClient.fetchComments(account.username);
  } catch (err) {
    // The media list call itself failed: one call spent.
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

async function runMeasure(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult> {
  const now = opts.now ?? new Date();
  let callsUsed = 0;

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

  const budget = opts.budget ?? OWN_MEASURE_CALL_BUDGET;
  const lastCaptured = opts.scope === "due" ? await latestCaptureByExternalId(media.map((m) => m.externalId)) : new Map<string, string>();
  const inScope = opts.scope === "all" ? media : media.filter((m) => isDue(m.postedAt, lastCaptured.get(m.externalId) ?? null, now));

  // Comments cost 1 media list + 1 call per post with comments. Their share is reserved
  // before the post loop so a full account still gets them.
  const commentCalls = (await commentsDue(opts.scope, now)) ? 1 + media.filter((m) => (m.commentsCount ?? 0) > 0).length : 0;

  let postsMeasured = 0;
  let postsFailed = 0;
  let stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  for (const m of inScope) {
    // Reserve the worst case (extended + fallback, plus profile_activity for a reel).
    if (callsUsed + (m.productType === "REELS" ? 3 : 2) + commentCalls > budget) {
      stoppedEarly = "budget";
      break;
    }
    let fetched: PostInsightsResult;
    try {
      fetched = await graphClient.fetchPostInsights(m);
    } catch (err) {
      const fatal = fatalStop(err);
      if (!fatal) {
        callsUsed += 1;
        log.warn("own_measure.post_failed", { externalId: m.externalId, error: messageOf(err) });
        postsFailed += 1;
        continue;
      }
      fetched = { insights: null, callsUsed: 1, stop: fatal };
    }
    callsUsed += fetched.callsUsed;
    if (fetched.insights) {
      const ownPostId = ownPostIdByExternalId.get(m.externalId) as string;
      await db.update(tables.ownPosts).set({ lastMeasuredAt: measuredAt }).where(eq(tables.ownPosts.id, ownPostId));
      await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(fetched.insights) });
      if (fetched.insights.error) postsFailed += 1;
      else postsMeasured += 1;
    }
    // A dead token ends the run as a failure (rows already written stay), so the action
    // surfaces it and the scheduler logs failed. A rate limit stops the run early.
    if (fetched.stop?.code === "GRAPH_AUTH_FAILED") return toFailure(fetched.stop);
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
      const c = await measureComments(account, measuredAt);
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
      if (b.stop?.code === "GRAPH_AUTH_FAILED") return toFailure(b.stop);
      if (b.stop) stoppedEarly = "rate_limited";
      else await setAppSetting(OWN_AUDIENCE_FETCH_ERROR_KEY, b.audienceError);
    } catch (err) {
      // Only a non-Graph failure lands here (the client returns auth and rate limit as stop).
      log.warn("own_measure.breakdowns_failed", { error: messageOf(err) });
    }
  }

  log.info("graph.measure.done", { scope: opts.scope, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed });
  return { ok: true, measuredAt, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed, stoppedEarly };
}

let inFlight: Promise<MeasureResult> | null = null;

export async function measureOwnChannel(opts: { scope: MeasureScope; now?: Date; budget?: number }): Promise<MeasureResult> {
  if (inFlight && opts.scope === "due") return { ok: false, error: "A measurement is already running.", code: "MEASURE_BUSY" };
  while (inFlight) await inFlight.catch(() => undefined);
  const run = runMeasure(opts);
  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}
