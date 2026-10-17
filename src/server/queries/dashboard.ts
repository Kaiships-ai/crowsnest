import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { feedItemColumns, toFeedItem, type FeedItem } from "./feed";

const DAY_MS = 86_400_000;
const SEVEN_DAYS = 7;
const SPARKLINE_WINDOW_DAYS = 90;
const SPARKLINE_BUCKETS = 12;
const OUTLIER_MIN_SCORE = 2;
const RECENTLY_VIEWED_LIMIT = 4;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** 12 equal-width buckets across the trailing `windowDays`, oldest -> newest, each the
 * sum of `viewCount` for rows whose `postedAt` falls in that bucket. Shared by the KPI
 * tile's sparkline and each fleet's spike-row sparkline so both read the same way. */
function bucketViewsByPostedAt(
  rows: { postedAt: string; viewCount: number | null }[],
  windowDays: number = SPARKLINE_WINDOW_DAYS,
  buckets: number = SPARKLINE_BUCKETS
): number[] {
  const bucketMs = (windowDays * DAY_MS) / buckets;
  const start = Date.now() - windowDays * DAY_MS;
  const sums = new Array(buckets).fill(0) as number[];
  for (const row of rows) {
    const t = new Date(row.postedAt).getTime();
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - start) / bucketMs)));
    sums[idx] += row.viewCount ?? 0;
  }
  return sums;
}

export interface DashboardStats {
  channelsTracked: number;
  channelsDelta7d: number;
  newOutliers7d: number;
  vaultedThisWeek: number;
  scriptsDrafted: number;
  viewsSparkline: number[];
}

/**
 * Dashboard KPI row (DESIGN.md §2.1, Task 1 of the phase-4 plan). `channelsDelta7d` is
 * net-new channels added this week (there's no historical snapshot of *channel count*
 * over time to diff against, but `channels.trackedSince` gives us exactly "added in the
 * last 7 days" for free). `scriptsDrafted` is a running total (all scripts, any status —
 * the mockup shows a plain count, not a "this week" delta like its siblings).
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const sevenDaysAgo = daysAgoIso(SEVEN_DAYS);
  const ninetyDaysAgo = daysAgoIso(SPARKLINE_WINDOW_DAYS);

  const [
    [channelsRow],
    [newChannelsRow],
    [outliersRow],
    [vaultedRow],
    [scriptsRow],
    recentVideos,
  ] = await Promise.all([
    // Both counts exclude removed channels. Removal is soft, so an unfiltered count
    // would keep reporting a channel the rest of the app no longer shows.
    db.select({ count: sql<number>`count(*)` }).from(tables.channels).where(isNull(tables.channels.deletedAt)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tables.channels)
      .where(and(gte(tables.channels.trackedSince, sevenDaysAgo), isNull(tables.channels.deletedAt))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tables.videos)
      .where(
        and(
          gte(tables.videos.outlierScore, OUTLIER_MIN_SCORE),
          gte(tables.videos.postedAt, sevenDaysAgo),
          isNull(tables.videos.deletedAt)
        )
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tables.vaultItems)
      .where(gte(tables.vaultItems.createdAt, sevenDaysAgo)),
    db.select({ count: sql<number>`count(*)` }).from(tables.scripts),
    db
      .select({ postedAt: tables.videos.postedAt, viewCount: tables.videos.viewCount })
      .from(tables.videos)
      .where(and(gte(tables.videos.postedAt, ninetyDaysAgo), isNull(tables.videos.deletedAt))),
  ]);

  return {
    channelsTracked: channelsRow?.count ?? 0,
    channelsDelta7d: newChannelsRow?.count ?? 0,
    newOutliers7d: outliersRow?.count ?? 0,
    vaultedThisWeek: vaultedRow?.count ?? 0,
    scriptsDrafted: scriptsRow?.count ?? 0,
    viewsSparkline: bucketViewsByPostedAt(recentVideos),
  };
}


/**
 * How many outliers (score >= OUTLIER_MIN_SCORE, not removed) were first seen after
 * `sinceIso`. First seen, not posted: a sync can pull in a month-old post today, and
 * that is new to Kai even though the post is not. A null cutoff means this is the first
 * ever visit, so nothing is "new" yet — the alternative would be calling the entire
 * library new on the first load.
 */
export async function getNewOutliersSince(sinceIso: string | null): Promise<number> {
  if (!sinceIso) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.videos)
    .where(
      and(
        gte(tables.videos.outlierScore, OUTLIER_MIN_SCORE),
        gte(tables.videos.firstSeenAt, sinceIso),
        isNull(tables.videos.deletedAt)
      )
    );
  return row?.count ?? 0;
}

const FEED_LAST_VISIT_KEY = "feed_last_visit";

/**
 * Reads the stored Feed last-visit timestamp without writing it — the sidebar's live
 * "new outliers" cue is computed in `(shell)/layout.tsx` on every navigation, and only
 * the Feed page itself should move the cutoff (see `bumpFeedLastVisit`). Keeping the read
 * and the bump separate is what lets the cue still show the count on the navigation that
 * lands on Feed, then clear on the next one, rather than the layout zeroing its own cue.
 * Distinct from `dashboard_last_visit`: opening the Dashboard must not clear the Feed cue.
 */
export async function getFeedLastVisit(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(tables.appSettings)
    .where(eq(tables.appSettings.key, FEED_LAST_VISIT_KEY))
    .limit(1);
  return row?.value ?? null;
}

/** Moves the Feed last-visit cutoff to `now`. Called on Feed page load, so "new since
 *  your last visit" means since the previous time you opened Feed. Same key-value table
 *  and insert-or-update shape as `readAndBumpDashboardLastVisit`, no schema change. */
export async function bumpFeedLastVisit(now: string = nowIso()): Promise<void> {
  const [row] = await db
    .select()
    .from(tables.appSettings)
    .where(eq(tables.appSettings.key, FEED_LAST_VISIT_KEY))
    .limit(1);
  if (row) {
    await db.update(tables.appSettings).set({ value: now }).where(eq(tables.appSettings.key, FEED_LAST_VISIT_KEY));
  } else {
    await db.insert(tables.appSettings).values({ key: FEED_LAST_VISIT_KEY, value: now });
  }
}

/**
 * The sidebar Feed cue: how many outliers are new since the creator last opened Feed.
 * Reuses `getNewOutliersSince` (score >= OUTLIER_MIN_SCORE, first seen after the cutoff,
 * not removed) so the rail's amber signal counts exactly what the Dashboard's own
 * new-outliers stat does — one definition of "new outlier", never a second. Null cutoff
 * (first ever Feed visit) yields 0, same honest first-visit rule.
 */
export async function getNewFeedOutliers(): Promise<number> {
  return getNewOutliersSince(await getFeedLastVisit());
}

const RECENTLY_VIEWED_KEY = "recently_viewed";

/**
 * "Recently viewed" (DESIGN.md §2.1) — reads back `app_settings.recently_viewed`
 * (written by queries/video.ts's `recordRecentlyViewed` on every Video Detail page
 * load) and resolves it to full FeedItems, preserving the stored most-recent-first
 * order (a plain `inArray` join would return rows in arbitrary SQL order instead).
 */
export async function getRecentlyViewed(limit = RECENTLY_VIEWED_LIMIT): Promise<FeedItem[]> {
  const [row] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, RECENTLY_VIEWED_KEY)).limit(1);
  if (!row) return [];

  let videoIds: unknown;
  try {
    videoIds = JSON.parse(row.value);
  } catch {
    return [];
  }
  if (!Array.isArray(videoIds) || videoIds.length === 0) return [];

  const rawRows = await db
    .select(feedItemColumns)
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(and(inArray(tables.videos.id, videoIds as string[]), isNull(tables.videos.deletedAt)));

  const byId = new Map(rawRows.map((r) => [r.videoId, toFeedItem(r)]));
  return (videoIds as string[])
    .map((id) => byId.get(id))
    .filter((item): item is FeedItem => item !== undefined)
    .slice(0, limit);
}

/** Whole-library sync jobs are keyed on this literal lock, not a real channel id — same
 *  constant `queries/runs.ts` reads for the same reason (see `channels.lockKey` on
 *  `sync_jobs` in schema.ts). */
const LIBRARY_LOCK_KEY = "__library__";

/**
 * The two halves of stack health this app has to read from its own tables — the last
 * sync and whatever is still running — for the dashboard's health panel (enhancements
 * spec M4-U8). The other two signals, the sidecar and the model backend, are live pings
 * the dashboard already makes; nothing here duplicates them.
 *
 * Read only, and no classification: whether a running job counts as stuck is decided by
 * `components/status/stack-health.ts`'s `selectStuckJobs` against the shared
 * `evaluateSla` threshold, so this returns every running job and lets that one rule
 * judge them. The shapes below are structurally the `LastSyncRow` and `RunningJob` that
 * module declares; the dashboard page passing one into the other is what type-checks
 * them against each other.
 */
type SyncJobStatusText = "running" | "success" | "partial" | "failed";

export interface StackHealth {
  lastSync: {
    jobId: string;
    status: SyncJobStatusText;
    startedAt: string;
    finishedAt: string | null;
    itemsCreated: number;
    itemsUpdated: number;
    channelsDone: number | null;
    channelsTotal: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  running: {
    jobId: string;
    kind: "sync" | "frame_pass";
    label: string;
    startedAt: string;
    heartbeatAt: string | null;
  }[];
  /** When these rows were read. Staleness has to be measured against this rather than
   *  against render time: the panel is a component, and calling a clock inside one is
   *  both impure (eslint's `react-hooks/purity` rejects it) and the wrong instant to
   *  compare a heartbeat to. */
  checkedAtMs: number;
}

export async function getStackHealth(): Promise<StackHealth> {
  const [lastSyncRows, runningSyncRows, runningFrameRows] = await Promise.all([
    db
      .select({
        jobId: tables.syncJobs.id,
        status: tables.syncJobs.status,
        startedAt: tables.syncJobs.startedAt,
        finishedAt: tables.syncJobs.finishedAt,
        itemsCreated: tables.syncJobs.itemsCreated,
        itemsUpdated: tables.syncJobs.itemsUpdated,
        channelsDone: tables.syncJobs.channelsDone,
        channelsTotal: tables.syncJobs.channelsTotal,
        errorCode: tables.syncJobs.errorCode,
        errorMessage: tables.syncJobs.errorMessage,
      })
      .from(tables.syncJobs)
      .orderBy(desc(tables.syncJobs.startedAt))
      .limit(1),
    db
      .select({
        jobId: tables.syncJobs.id,
        lockKey: tables.syncJobs.lockKey,
        handle: tables.syncJobs.currentChannelHandle,
        startedAt: tables.syncJobs.startedAt,
        heartbeatAt: tables.syncJobs.heartbeatAt,
      })
      .from(tables.syncJobs)
      .where(eq(tables.syncJobs.status, "running")),
    db
      .select({
        jobId: tables.framePassJobs.id,
        startedAt: tables.framePassJobs.startedAt,
        heartbeatAt: tables.framePassJobs.heartbeatAt,
      })
      .from(tables.framePassJobs)
      .where(eq(tables.framePassJobs.status, "running")),
  ]);

  const [lastSync] = lastSyncRows;
  const checkedAtMs = Date.now();

  return {
    checkedAtMs,
    // `status` is a plain text column, narrowed here the same way `runs.ts` narrows it
    // rather than widening the consumer to accept a bare string.
    lastSync: lastSync ? { ...lastSync, status: lastSync.status as SyncJobStatusText } : null,
    running: [
      ...runningSyncRows.map((row) => ({
        jobId: row.jobId,
        kind: "sync" as const,
        label: row.lockKey === LIBRARY_LOCK_KEY ? "Library sync" : (row.handle ?? "Channel sync"),
        startedAt: row.startedAt,
        heartbeatAt: row.heartbeatAt,
      })),
      ...runningFrameRows.map((row) => ({
        jobId: row.jobId,
        kind: "frame_pass" as const,
        label: "Frame pass",
        startedAt: row.startedAt,
        heartbeatAt: row.heartbeatAt,
      })),
    ],
  };
}
