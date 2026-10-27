import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { clockNow } from "@/server/lib/clock";
import { log } from "@/server/lib/logger";
import { hourFreesAt } from "@/server/lib/call-budget";
import { instagramGraph } from "@/server/connectors/instagram-graph/manifest";
import { CLASSIFIER_VERSION, GRAPH_CALLS_PER_HOUR, graphCallLedger, graphCallsInLastHour, graphClient, isPermanentFailure, type GraphAccount, type GraphBreakdownRow, type GraphComment, type GraphMedia, type GraphPostInsights, type InsightsFailure } from "@/server/graph/client";
import type { CompletePull, PullResult } from "@/server/lib/pull-result";
import { GraphApiError, type GraphErrorCode } from "@/server/graph/errors";
import { rememberTokenStatus } from "@/server/graph/token-status";
import { newestCaptureByPost, OWN_AUDIENCE_FETCH_ERROR_KEY, OWN_COMMENTS_FETCH_ERROR_KEY, OWN_FOLLOWER_SPLIT_FETCH_ERROR_KEY } from "@/server/queries/own-channel";

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
  /** `stopped` is the user's Stop between posts. */
  stoppedEarly: "budget" | "rate_limited" | "stopped" | null;
  /** After a budget or rate-limit stop: when the hour frees its first call again (the oldest call in the last hour, plus an hour). */
  retryAfter: string | null;
  /** This run's budget was cut by Graph calls earlier runs spent in the last hour. */
  limitedByRecentCalls: boolean;
}
export type MeasureResult = ({ ok: true } & MeasureSummary) | { ok: false; error: string; code: GraphErrorCode | "MEASURE_BUSY" | "MEASURE_FAILED" };

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

/** A post's failed captures since its last successful capture (all of them when it has none). */
export interface CaptureFailures {
  /** Newest failed capturedAt. */
  at: string;
  count: number;
  /** The newest failure is a non-transient invalid_request (for example code 100). */
  permanent: boolean;
}

/** Hourly while a post is under 72 hours old, daily after, each with five minutes of slack.
 *  A post never captured successfully is due at once. After a failure since its last
 *  success, the wait runs from the newest failure: a day when Instagram refused the request
 *  itself (invalid_request); otherwise an hour for a post under 72 hours old (not enough
 *  viewers, network, 5xx all clear), and for an older post one retry an hour later, then
 *  daily. Derived from stored captures on every tick, so the scheduler keeps no state. */
export function isDue(postedAt: string, lastCapturedAt: string | null, now: Date, failures: CaptureFailures | null = null): boolean {
  const young = now.getTime() - Date.parse(postedAt) < NEW_REEL_WINDOW_MS;
  if (failures !== null) {
    const wait = !failures.permanent && (young || failures.count === 1) ? HOUR_MS : 24 * HOUR_MS;
    return now.getTime() - Date.parse(failures.at) >= wait - DUE_SLACK_MS;
  }
  if (lastCapturedAt === null) return true;
  return now.getTime() - Date.parse(lastCapturedAt) >= (young ? HOUR_MS : 24 * HOUR_MS) - DUE_SLACK_MS;
}

/** Newest successful capture per post (the same pick My reels reads), plus each post's
 *  failures since that capture (all of them when it has none). Keyed by own_posts id. */
async function captureState(ownPostIds: string[]): Promise<{ lastOk: Map<string, string>; failures: Map<string, CaptureFailures> }> {
  const newestOk = await newestCaptureByPost(ownPostIds, true);
  const lastOk = new Map([...newestOk].map(([id, row]) => [id, row.capturedAt]));
  const failures = new Map<string, CaptureFailures>();
  if (ownPostIds.length === 0) return { lastOk, failures };
  // ponytail: reads every stored failure; the backoff keeps them to about one a day per
  // failing post. Bound it by capturedAt in SQL if that ever shows.
  const failed = await db
    .select({ ownPostId: tables.ownPostInsights.ownPostId, capturedAt: tables.ownPostInsights.capturedAt, fetchError: tables.ownPostInsights.fetchError })
    .from(tables.ownPostInsights)
    .where(and(inArray(tables.ownPostInsights.ownPostId, ownPostIds), isNotNull(tables.ownPostInsights.fetchError)))
    .orderBy(desc(tables.ownPostInsights.capturedAt));
  for (const f of failed) {
    const ok = lastOk.get(f.ownPostId);
    if (ok !== undefined && f.capturedAt <= ok) continue;
    const seen = failures.get(f.ownPostId);
    if (seen) seen.count += 1;
    else failures.set(f.ownPostId, { at: f.capturedAt, count: 1, permanent: isPermanentFailure(f.fetchError ?? "") });
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
    avgWatchTimeMs: i.avgWatchTimeMs, totalWatchTimeMs: i.totalWatchTimeMs,
  };
}

async function storePostCapture(ownPostId: string, measuredAt: string, pull: CompletePull<GraphPostInsights>): Promise<void> {
  await db.update(tables.ownPosts).set({ lastMeasuredAt: measuredAt }).where(eq(tables.ownPosts.id, ownPostId));
  await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(pull.rows) });
}

async function storeFailedCapture(ownPostId: string, measuredAt: string, pull: Exclude<PullResult<GraphPostInsights, InsightsFailure>, { kind: "complete" }>): Promise<void> {
  const fetchError = pull.kind === "partial" ? `partial, missing ${pull.missing}: ${pull.reason.error.message}` : pull.reason.error.message;
  await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, fetchError });
}

async function storeBreakdowns(measuredAt: string, pulls: CompletePull<GraphBreakdownRow[]>[]): Promise<void> {
  const rows = pulls.flatMap((p) => p.rows);
  if (rows.length > 0) await db.insert(tables.ownAccountBreakdowns).values(rows.map((r) => ({ id: newId(), capturedAt: measuredAt, ...r })));
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
): Promise<{ commentsSeen: number; partial: boolean; stop: GraphApiError | null }> {
  let pull: PullResult<GraphComment[], GraphApiError>;
  try {
    pull = await graphClient.fetchComments(account.username, media);
  } catch (err) {
    // Not configured, or a malformed comment mid-pull.
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(err));
    log.warn("graph.measure.comments_failed", { message: messageOf(err) });
    return { commentsSeen: 0, partial: true, stop: fatalStop(err) };
  }
  const comments = pull.kind === "failed" ? [] : pull.rows;
  const allOwnPosts = await db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts);
  const postIdByPermalink = new Map(allOwnPosts.map((p) => [p.permalink, p.id]));
  for (const c of comments) await upsertOwnComment(c, postIdByPermalink);
  if (pull.kind !== "complete") {
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(pull.reason));
    log.warn("graph.measure.comments_failed", { kind: pull.kind, message: messageOf(pull.reason) });
    return { commentsSeen: comments.length, partial: true, stop: fatalStop(pull.reason) };
  }
  await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, null);
  await setAppSetting(OWN_COMMENTS_FETCHED_AT_KEY, measuredAt);
  return { commentsSeen: comments.length, partial: false, stop: null };
}

/** A card pull's hooks: progress after each post, a Stop checked between posts, and Pull the rest. */
export interface MeasureHooks {
  onProgress?: (p: { done: number; total: number; label: string | null }) => void;
  shouldStop?: () => boolean;
  /** Skip posts measured at or after this time. */
  skipMeasuredSince?: string;
}

const CAPTION_LABEL_CHARS = 28;
export function captionLabel(caption: string | null): string | null {
  const line = caption?.split("\n")[0].trim();
  if (!line) return null;
  return line.length > CAPTION_LABEL_CHARS ? `${line.slice(0, CAPTION_LABEL_CHARS).trimEnd()}…` : line;
}

const retryAfterOf = (stoppedEarly: MeasureSummary["stoppedEarly"], now: Date): string | null =>
  stoppedEarly === "budget" || stoppedEarly === "rate_limited" ? (hourFreesAt(instagramGraph.id, now)?.toISOString() ?? null) : null;

async function runMeasure(opts: { scope: MeasureScope; now: Date; budget?: number } & MeasureHooks): Promise<MeasureResult> {
  const now = opts.now;
  // The transport counts every Graph call, so this run's spend is the ledger's growth
  // since it started, and the hour's spend includes token checks and publishes too.
  // ponytail: a publish or token check running alongside lands in this run's count too;
  // it spends the same hourly limit, so the budget stays honest.
  const ledger = graphCallLedger();
  const start = ledger.total;
  const used = () => ledger.total - start;
  const runBudget = opts.budget ?? (opts.scope === "all" ? OWN_MEASURE_MANUAL_CALL_BUDGET : OWN_MEASURE_CALL_BUDGET);
  const budget = Math.min(runBudget, GRAPH_CALLS_PER_HOUR - graphCallsInLastHour(now) - GRAPH_CALL_HEADROOM);
  const limitedByRecentCalls = budget < runBudget;
  // Account and media plus one post, before any Graph call: below that the run could only
  // write a snapshot and spend calls the hour no longer has.
  if (budget < 3) {
    log.info("graph.measure.skipped_budget", { scope: opts.scope, budget });
    return { ok: true, measuredAt: now.toISOString(), postsSeen: 0, postsMeasured: 0, postsFailed: 0, commentsSeen: 0, partial: false, callsUsed: 0, stoppedEarly: "budget", retryAfter: retryAfterOf("budget", now), limitedByRecentCalls };
  }

  let account: GraphAccount;
  try {
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
    media = await graphClient.fetchMedia();
  } catch (err) {
    return toFailure(err);
  }

  // Every listed post is stored up front, so a post the run never reaches (budget, rate
  // limit, a thrown call) still exists in own_posts and is due next tick.
  const ownPostIdByExternalId = new Map<string, string>();
  for (const m of media) ownPostIdByExternalId.set(m.externalId, await upsertOwnPost(m, measuredAt));

  const captures = opts.scope === "due" ? await captureState([...ownPostIdByExternalId.values()]) : null;
  const measuredSince = opts.skipMeasuredSince;
  const fresh = measuredSince
    ? new Set(
        (await db.select({ id: tables.ownPosts.id, at: tables.ownPosts.lastMeasuredAt }).from(tables.ownPosts).where(inArray(tables.ownPosts.id, [...ownPostIdByExternalId.values()])))
          .filter((p) => p.at !== null && p.at >= measuredSince)
          .map((p) => p.id),
      )
    : null;
  const inScope = media.filter((m) => {
    const id = ownPostIdByExternalId.get(m.externalId) as string;
    if (fresh?.has(id)) return false;
    return captures === null || isDue(m.postedAt, captures.lastOk.get(id) ?? null, now, captures.failures.get(id) ?? null);
  });

  // Comments cost 1 call per post with comments (they reuse this run's media list). Their
  // share is reserved before the post loop so a full account still gets them, but only when
  // it fits: a reservation that can never be spent would starve the posts for nothing.
  const commentCalls = (await commentsDue(opts.scope, now)) ? media.filter((m) => (m.commentsCount ?? 0) > 0).length : 0;
  const commentReserve = used() + commentCalls <= budget ? commentCalls : 0;

  let postsMeasured = 0;
  let postsFailed = 0;
  let stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  const progress = (label: string | null) => opts.onProgress?.({ done: postsMeasured + postsFailed, total: inScope.length, label });
  for (const m of inScope) {
    if (opts.shouldStop?.()) {
      stoppedEarly = "stopped";
      break;
    }
    // Reserve the calls a post needs: one insights call, plus profile_activity for a reel.
    // A rare core-set fallback can add one more; the rate-limit stop guards that edge.
    if (used() + (m.productType === "REELS" ? 2 : 1) + commentReserve > budget) {
      stoppedEarly = "budget";
      break;
    }
    const ownPostId = ownPostIdByExternalId.get(m.externalId) as string;
    progress(captionLabel(m.caption));
    let pull: PullResult<GraphPostInsights, InsightsFailure>;
    try {
      pull = await graphClient.fetchPostInsights(m);
    } catch (err) {
      // The token vanished mid-run: every other post would throw the same way.
      if (err instanceof GraphApiError && err.code === "GRAPH_NOT_CONFIGURED") return toFailure(err);
      const fatal = fatalStop(err);
      if (!fatal) {
        log.warn("own_measure.post_failed", { externalId: m.externalId, error: messageOf(err) });
        // Stored as a failed capture so isDue backs this post off like any other failure.
        await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, fetchError: messageOf(err) });
        postsFailed += 1;
        continue;
      }
      pull = { kind: "failed", reason: { error: fatal, endsRun: true } };
    }
    if (pull.kind === "complete") {
      await storePostCapture(ownPostId, measuredAt, pull);
      postsMeasured += 1;
      continue;
    }
    const stop = pull.reason.endsRun ? pull.reason.error : null;
    if (!stop || pull.kind === "partial") {
      await storeFailedCapture(ownPostId, measuredAt, pull);
      postsFailed += 1;
    }
    // A dead token, or one without the insights permission, ends the run as a failure
    // (rows already written stay), so the action surfaces it and the scheduler logs
    // failed. A rate limit stops the run early.
    if (stop && stop.code !== "GRAPH_RATE_LIMITED") return toFailure(stop);
    if (stop) {
      stoppedEarly = "rate_limited";
      break;
    }
  }
  progress(null);

  let commentsSeen = 0;
  let partial = false;
  if (commentCalls > 0 && stoppedEarly !== "stopped") {
    if (stoppedEarly === "rate_limited" || used() + commentCalls > budget) {
      partial = true;
      // An auth or permission stop already ended the run above, so only these two remain.
      const cause =
        stoppedEarly === "rate_limited"
          ? "Instagram rate limited this run."
          : limitedByRecentCalls
            ? "earlier measurements spent most of the last hour's Graph calls."
            : "this run's Graph call budget was spent.";
      await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, `Comments skipped: ${cause}`);
    } else {
      const c = await measureComments(account, media, measuredAt);
      ({ commentsSeen, partial } = c);
      if (c.stop?.code === "GRAPH_AUTH_FAILED") return toFailure(c.stop);
      if (c.stop) stoppedEarly = "rate_limited";
    }
  }

  // ponytail: when every breakdown call is refused no row lands, so this retries each
  // tick (4 calls an hour); store a refusal timestamp if that ever matters.
  if (stoppedEarly === null && used() + 4 <= budget && (await breakdownsStale(now))) {
    try {
      const { split, audience } = await graphClient.fetchAccountBreakdowns();
      await storeBreakdowns(measuredAt, [split, audience].filter((p): p is CompletePull<GraphBreakdownRow[]> => p.kind === "complete"));
      const stop = [split, audience].map((p) => (p.kind === "complete" ? null : fatalStop(p.reason))).find((e) => e !== null) ?? null;
      if (split.kind === "complete") await setAppSetting(OWN_FOLLOWER_SPLIT_FETCH_ERROR_KEY, null);
      else if (!fatalStop(split.reason)) await setAppSetting(OWN_FOLLOWER_SPLIT_FETCH_ERROR_KEY, split.reason.message);
      if (stop?.code === "GRAPH_AUTH_FAILED") return toFailure(stop);
      if (stop) stoppedEarly = "rate_limited";
      else await setAppSetting(OWN_AUDIENCE_FETCH_ERROR_KEY, audience.kind === "complete" ? null : audience.reason.message);
    } catch (err) {
      log.warn("own_measure.breakdowns_failed", { error: messageOf(err) });
    }
  }

  // Only a post's insights landing proves the insights grant: the account and media calls
  // work without it, so a run with none must not clear a remembered permission refusal.
  if (postsMeasured > 0) rememberTokenStatus({ configured: true, username: account.username, state: "ok", message: null, checkedAt: measuredAt });
  const callsUsed = used();
  log.info("graph.measure.done", { scope: opts.scope, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed });
  return { ok: true, measuredAt, postsSeen: media.length, postsMeasured, postsFailed, commentsSeen, partial, callsUsed, stoppedEarly, retryAfter: retryAfterOf(stoppedEarly, now), limitedByRecentCalls };
}

/** Process-wide state on globalThis: tsx server.ts (the scheduler) and Next's bundle
 *  (Measure now) each load their own copy of this module in the same process, so a
 *  module-level lock would let both run at once. The Graph call ledger (graphCallLedger)
 *  lives on the same object. Read through a function so a test can drop it. */
interface OwnMeasureState {
  inFlight?: Promise<MeasureResult> | null;
}
function shared(): OwnMeasureState {
  const g = globalThis as { __crowsnestOwnMeasure?: OwnMeasureState };
  return (g.__crowsnestOwnMeasure ??= {});
}

export async function measureOwnChannel(opts: { scope: MeasureScope; now?: Date; budget?: number; wait?: true } & MeasureHooks): Promise<MeasureResult> {
  const state = shared();
  if (state.inFlight && opts.scope === "due" && !opts.wait) return { ok: false, error: "A measurement is already running.", code: "MEASURE_BUSY" };
  while (state.inFlight) await state.inFlight.catch(() => undefined);
  const now = opts.now ?? clockNow();
  const run = runMeasure({ ...opts, now });
  state.inFlight = run;
  try {
    const result = await run;
    if (!result.ok && result.code === "GRAPH_AUTH_FAILED") {
      rememberTokenStatus({ configured: true, username: null, state: "auth_failed", message: result.error, checkedAt: new Date().toISOString() });
    }
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
