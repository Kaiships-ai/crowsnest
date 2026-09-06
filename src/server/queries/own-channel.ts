import { desc, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { CLASSIFIER_VERSION } from "@/server/graph/client";
import { computeOwnMedianReach, indexAgainstOwnMedian, type OwnPostForCalc } from "@/server/services/own-metrics";
import { getSetting } from "@/server/settings";

/**
 * Own-channel Instagram Insights reads (V1 data contracts §1).
 *
 * Every export here is a pure database reader — none of them call the Graph API or
 * import `src/server/config.ts`. That is deliberate, not an oversight: the contract's
 * three token states ("absent", "refused", "throttled or unreachable") differ only in
 * what the ACTION's error code says happened on the last live pull; what a query
 * returns for "absent" ("nothing has ever been measured") and for a token that was
 * never configured are the same shape, because a token that was never configured could
 * never have written a row. The banner that tells a user "not configured" apart from
 * "configured but the last pull failed" is driven by `checkGraphTokenAction`, called
 * separately by the page — not by these queries re-deriving it from `config`.
 *
 * None of these ever throw and none of them return a zero standing in for "not
 * measured": every numeric field is `null` until a real measurement produced it.
 */

export interface OwnMetric {
  /** Null means not measured. It never means zero. */
  value: number | null;
  /** How many posts in the window contributed a non-null value for this metric. */
  sampleSize: number;
  /** Posts in the window whose insights call failed. */
  failedSampleSize: number;
  /** False for a metric the client does not request yet. Renders as "not wired". */
  wired: boolean;
}

export interface OwnChannelOverview {
  account: {
    username: string;
    followerCount: number | null;
    followsCount: number | null;
    mediaCount: number | null;
    /** Null when no measurement has ever been taken. */
    measuredAt: string | null;
  } | null;
  windowDays: number;
  postsInWindow: number;
  postsMeasured: number;
  metrics: {
    reach: OwnMetric;
    saved: OwnMetric;
    shares: OwnMetric;
    profileVisits: OwnMetric;
    followsFromPost: OwnMetric;
    watchTimeSec: OwnMetric;
  };
  /** Null below `scoreMinUsablePosts` usable posts or when the median is zero, mirroring
   *  computeOwnMedianReach's minUsable rule. */
  medianReach: number | null;
  medianSampleSize: number;
}

export interface OwnPostRow {
  ownPostId: string;
  externalId: string;
  permalink: string;
  format: string;
  caption: string | null;
  postedAt: string;
  durationSec: number | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  saved: number | null;
  shares: number | null;
  /** reach divided by median reach, one decimal. Null when either side is null. */
  reachIndex: number | null;
  measuredAt: string | null;
  insightsError: string | null;
}

export interface OwnCommentSummary {
  counts: Record<string, number>;
  organic: { author: string | null; text: string; postedAt: string | null; permalink: string }[];
  classifierVersion: string;
  /** Null when the comment pull failed while the post pull succeeded. */
  fetchError: string | null;
}

/** `app_settings` key holding the last comment-pull failure, since `own_comments` has
 *  no error column of its own (comments are stored rows, not a pull's outcome). Row
 *  absent means the last pull succeeded or none has ever run — both render the same
 *  "no error" state, matching every other query's absent-means-empty rule. */
export const OWN_COMMENTS_FETCH_ERROR_KEY = "own_comments_fetch_error";

const DEFAULT_WINDOW_DAYS = 30;

type OwnPostInsightsRow = typeof tables.ownPostInsights.$inferSelect;

/** Exported for queries/planned-posts.ts: the calendar's published cells need each own
 *  post's date and latest reach, and this is already the one place that joins an own
 *  post to its latest measurement — a second implementation is how the two drift. */
export interface JoinedOwnPost {
  ownPostId: string;
  externalId: string;
  permalink: string;
  format: string;
  caption: string | null;
  postedAt: string;
  durationSec: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  likes: number | null;
  views: number | null;
  profileVisits: number | null;
  followsFromPost: number | null;
  watchTimeSec: number | null;
  /** Null when this post has never been through a measure run at all — distinct from
   *  a run that came back with every field null. */
  measuredAt: string | null;
  insightsError: string | null;
}

/**
 * Every own_posts row (newest first) joined with its OWN latest own_post_insights row.
 * "Latest" is computed in application code rather than a SQL window function: the rest
 * of this codebase already does the equivalent select-then-reduce for a channel's
 * newest snapshot (see `queries/channels.ts`'s `getMedianViews`), and a single-user
 * account's post count never approaches a scale where that matters.
 */
export async function getPostsWithLatestInsights(): Promise<JoinedOwnPost[]> {
  const posts = await db.select().from(tables.ownPosts).orderBy(desc(tables.ownPosts.postedAt));
  if (posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const insightRows = await db
    .select()
    .from(tables.ownPostInsights)
    .where(inArray(tables.ownPostInsights.ownPostId, postIds))
    .orderBy(desc(tables.ownPostInsights.capturedAt));

  const latestByPost = new Map<string, OwnPostInsightsRow>();
  for (const row of insightRows) {
    if (!latestByPost.has(row.ownPostId)) latestByPost.set(row.ownPostId, row);
  }

  return posts.map((p) => {
    const latest = latestByPost.get(p.id);
    return {
      ownPostId: p.id,
      externalId: p.externalId,
      permalink: p.permalink,
      format: p.format,
      caption: p.caption,
      postedAt: p.postedAt,
      durationSec: p.durationSec,
      reach: latest?.reach ?? null,
      saved: latest?.saved ?? null,
      shares: latest?.shares ?? null,
      likes: latest?.likes ?? null,
      views: latest?.views ?? null,
      profileVisits: latest?.profileVisits ?? null,
      followsFromPost: latest?.followsFromPost ?? null,
      watchTimeSec: latest?.watchTimeSec ?? null,
      measuredAt: latest?.capturedAt ?? null,
      insightsError: latest?.fetchError ?? null,
    };
  });
}

function toCalcInput(posts: JoinedOwnPost[]): OwnPostForCalc[] {
  return posts.map((p) => ({ ownPostId: p.ownPostId, reach: p.reach, postedAt: p.postedAt }));
}

/** Same trailing window `computeOwnMedianReach` uses internally (20 posts),
 *  duplicated here only to report the sample size the median function itself does not
 *  return. Not gated by `minUsable`: this reports how many posts are IN the sample,
 *  independent of whether that count clears the floor for a median to exist. */
function medianSampleSizeOf(posts: OwnPostForCalc[], window = 20): number {
  return posts
    .filter((p) => p.reach !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, window).length;
}

const WIRED: Record<keyof OwnChannelOverview["metrics"], boolean> = {
  reach: true,
  saved: true,
  shares: true,
  profileVisits: false,
  followsFromPost: false,
  watchTimeSec: false,
};

function aggregateMetric(posts: JoinedOwnPost[], key: "reach" | "saved" | "shares" | "profileVisits" | "followsFromPost" | "watchTimeSec", failedSampleSize: number): OwnMetric {
  const values = posts.map((p) => p[key]).filter((v): v is number => v !== null);
  return {
    value: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null,
    sampleSize: values.length,
    failedSampleSize,
    wired: WIRED[key],
  };
}

export async function getOwnChannelOverview(
  windowDays: number = DEFAULT_WINDOW_DAYS,
  opts: { offsetDays?: number } = {},
): Promise<OwnChannelOverview> {
  const [snapshot] = await db.select().from(tables.ownAccountSnapshots).orderBy(desc(tables.ownAccountSnapshots.capturedAt)).limit(1);
  const account = snapshot
    ? {
        username: snapshot.username,
        followerCount: snapshot.followerCount,
        followsCount: snapshot.followsCount,
        mediaCount: snapshot.mediaCount,
        measuredAt: snapshot.capturedAt,
      }
    : null;

  const [allPosts, minUsable] = await Promise.all([getPostsWithLatestInsights(), getSetting("scoreMinUsablePosts")]);
  // offsetDays shifts the day-range window back for a prior-period comparison (month over
  // month). It applies ONLY to this inWindow filter; the median below stays a trailing
  // post-count window over allPosts, unchanged, so a prior-period read is still scored
  // against the same baseline as the current one.
  const offsetDays = opts.offsetDays ?? 0;
  const now = Date.now();
  const end = new Date(now - offsetDays * 86_400_000).toISOString();
  const start = new Date(now - (offsetDays + windowDays) * 86_400_000).toISOString();
  const inWindow = allPosts.filter((p) => p.postedAt >= start && p.postedAt < end);

  const failedSampleSize = inWindow.filter((p) => p.insightsError !== null).length;
  const postsMeasured = inWindow.filter((p) => p.measuredAt !== null && p.insightsError === null).length;

  const calcInput = toCalcInput(allPosts);

  return {
    account,
    windowDays,
    postsInWindow: inWindow.length,
    postsMeasured,
    metrics: {
      reach: aggregateMetric(inWindow, "reach", failedSampleSize),
      saved: aggregateMetric(inWindow, "saved", failedSampleSize),
      shares: aggregateMetric(inWindow, "shares", failedSampleSize),
      profileVisits: aggregateMetric(inWindow, "profileVisits", failedSampleSize),
      followsFromPost: aggregateMetric(inWindow, "followsFromPost", failedSampleSize),
      watchTimeSec: aggregateMetric(inWindow, "watchTimeSec", failedSampleSize),
    },
    // Median is computed over the trailing post window regardless of `windowDays`,
    // mirroring the channel-side baseline's own post-count window rather than a day range.
    // minUsable comes from the same `scoreMinUsablePosts` setting the channel-side
    // scores use (B2, review-engineering-2026-07-31.md §3), not a separate hardcoded 5.
    medianReach: computeOwnMedianReach(calcInput, { minUsable }),
    medianSampleSize: medianSampleSizeOf(calcInput),
  };
}

export async function getOwnPosts(opts: { limit?: number; offset?: number } = {}): Promise<{ items: OwnPostRow[]; total: number }> {
  const limit = opts.limit ?? 24;
  const offset = opts.offset ?? 0;

  const [allPosts, minUsable] = await Promise.all([getPostsWithLatestInsights(), getSetting("scoreMinUsablePosts")]);
  const medianReach = computeOwnMedianReach(toCalcInput(allPosts), { minUsable });

  const items: OwnPostRow[] = allPosts.slice(offset, offset + limit).map((p) => ({
    ownPostId: p.ownPostId,
    externalId: p.externalId,
    permalink: p.permalink,
    format: p.format,
    caption: p.caption,
    postedAt: p.postedAt,
    durationSec: p.durationSec,
    reach: p.reach,
    views: p.views,
    likes: p.likes,
    saved: p.saved,
    shares: p.shares,
    reachIndex: indexAgainstOwnMedian(p.reach, medianReach),
    measuredAt: p.measuredAt,
    insightsError: p.insightsError,
  }));

  return { items, total: allPosts.length };
}

/** History of one post's measurements, newest first. Feeds a per-post trend and is the
 *  reason insights are stored per measurement rather than overwritten in place. */
export async function getOwnPostInsightHistory(ownPostId: string): Promise<
  { capturedAt: string; reach: number | null; saved: number | null; shares: number | null; views: number | null }[]
> {
  return db
    .select({
      capturedAt: tables.ownPostInsights.capturedAt,
      reach: tables.ownPostInsights.reach,
      saved: tables.ownPostInsights.saved,
      shares: tables.ownPostInsights.shares,
      views: tables.ownPostInsights.views,
    })
    .from(tables.ownPostInsights)
    .where(eq(tables.ownPostInsights.ownPostId, ownPostId))
    .orderBy(desc(tables.ownPostInsights.capturedAt));
}

export async function getOwnComments(): Promise<OwnCommentSummary> {
  const [comments, posts, errorSetting] = await Promise.all([
    db.select().from(tables.ownComments),
    db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts),
    db.select().from(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY)).limit(1),
  ]);

  const permalinkByPostId = new Map(posts.map((p) => [p.id, p.permalink]));
  const counts: Record<string, number> = {};
  const organic: OwnCommentSummary["organic"] = [];

  for (const c of comments) {
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    if (c.kind === "organic") {
      organic.push({
        author: c.author,
        text: c.text,
        postedAt: c.postedAt,
        permalink: permalinkByPostId.get(c.ownPostId) ?? "",
      });
    }
  }

  return {
    counts,
    organic,
    // The CURRENT classifier's version, not necessarily what stamped every stored row —
    // rows classified under an older SELF_TEST_TEXT/BOT_REPLY_TEXT set are identifiable
    // via their own classifier_version column, but the summary reports one version
    // string, and the current one is what a fresh reading would use.
    classifierVersion: CLASSIFIER_VERSION,
    fetchError: errorSetting[0]?.value ?? null,
  };
}
