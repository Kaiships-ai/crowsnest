import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { CLASSIFIER_VERSION, graphClient, type GraphAccount, type GraphComment, type GraphMedia, type GraphPostInsights } from "@/server/graph/client";
import { GraphApiError, type GraphErrorCode } from "@/server/graph/errors";
import { OWN_COMMENTS_FETCH_ERROR_KEY } from "@/server/queries/own-channel";

/**
 * The one writer of the own-channel tables (own_account_snapshots, own_posts,
 * own_post_insights, own_comments, own_account_breakdowns). "Measure now" calls it with
 * scope "all"; the scheduler with scope "due". A module-level single-flight lock covers
 * both: a due run finding the lock held returns MEASURE_BUSY, a manual run waits.
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
  stoppedEarly: "budget" | "rate_limited" | "auth_failed" | null;
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

async function setAppSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.delete(tables.appSettings).where(eq(tables.appSettings.key, key));
    return;
  }
  await db.insert(tables.appSettings).values({ key, value }).onConflictDoUpdate({ target: tables.appSettings.key, set: { value } });
}

/** Upserts one own_posts row keyed on externalId (the Graph media id). Returns the
 *  internal row id so the caller can attach an insights row to it. */
async function upsertOwnPost(m: GraphMedia, measuredAt: string): Promise<string> {
  const [existing] = await db.select({ id: tables.ownPosts.id }).from(tables.ownPosts).where(eq(tables.ownPosts.externalId, m.externalId)).limit(1);
  const common = {
    permalink: m.permalink, mediaType: m.mediaType, productType: m.productType, format: m.format,
    caption: m.caption, postedAt: m.postedAt, thumbnailUrl: m.thumbnailUrl, lastMeasuredAt: measuredAt,
  };
  if (existing) {
    await db.update(tables.ownPosts).set(common).where(eq(tables.ownPosts.id, existing.id));
    return existing.id;
  }
  const id = newId();
  await db.insert(tables.ownPosts).values({ id, externalId: m.externalId, ...common, firstSeenAt: measuredAt });
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

async function measureComments(account: GraphAccount): Promise<{ commentsSeen: number; partial: boolean }> {
  try {
    const comments = await graphClient.fetchComments(account.username);
    const allOwnPosts = await db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts);
    const postIdByPermalink = new Map(allOwnPosts.map((p) => [p.permalink, p.id]));
    for (const c of comments) await upsertOwnComment(c, postIdByPermalink);
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, null);
    return { commentsSeen: comments.length, partial: false };
  } catch (err) {
    await setAppSetting(OWN_COMMENTS_FETCH_ERROR_KEY, messageOf(err));
    log.warn("graph.measure.comments_failed", { message: messageOf(err) });
    return { commentsSeen: 0, partial: true };
  }
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

  let postsMeasured = 0;
  let postsFailed = 0;
  const stoppedEarly: MeasureSummary["stoppedEarly"] = null;
  for (const m of media) {
    const fetched = await graphClient.fetchPostInsights(m);
    callsUsed += fetched.callsUsed;
    const ownPostId = await upsertOwnPost(m, measuredAt);
    await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId, capturedAt: measuredAt, ...insightColumns(fetched.insights) });
    if (fetched.insights.error) postsFailed += 1;
    else postsMeasured += 1;
  }

  let commentsSeen = 0;
  let partial = false;
  if (opts.scope === "all") ({ commentsSeen, partial } = await measureComments(account));

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
