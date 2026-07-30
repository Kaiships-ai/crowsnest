import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/server/db";
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
    db.select({ count: sql<number>`count(*)` }).from(tables.channels),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tables.channels)
      .where(gte(tables.channels.trackedSince, sevenDaysAgo)),
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
 * "Today's top outliers" (DESIGN.md §2.1): highest-scored videos posted in the last 7
 * days; if none were posted that recently, falls back to all-time highest-scored so the
 * section is never empty on a quiet week for an otherwise-populated tracker.
 */
export async function getTopOutliersToday(limit = 6): Promise<FeedItem[]> {
  const orderBy = [sql`${tables.videos.outlierScore} IS NULL`, desc(tables.videos.outlierScore)] as const;

  const recent = await db
    .select(feedItemColumns)
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(and(gte(tables.videos.postedAt, daysAgoIso(SEVEN_DAYS)), isNull(tables.videos.deletedAt)))
    .orderBy(...orderBy)
    .limit(limit);
  if (recent.length > 0) return recent.map(toFeedItem);

  const fallback = await db
    .select(feedItemColumns)
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(isNull(tables.videos.deletedAt))
    .orderBy(...orderBy)
    .limit(limit);
  return fallback.map(toFeedItem);
}

export interface FleetSpike {
  fleetId: string;
  fleetName: string;
  newOutliers7d: number;
  sparkline: number[];
}

/**
 * "Fleets with new spikes" (DESIGN.md §2.1) — only fleets that actually have at least
 * one new (score >= 2) outlier posted in the last 7 days, per the section's own name;
 * an empty-membership fleet is skipped outright rather than ever handed an empty array
 * to `inArray` (mirrors the guard in feed.ts's buildWhere, backlog item M2).
 */
export async function getFleetSpikes(): Promise<FleetSpike[]> {
  const sevenDaysAgo = daysAgoIso(SEVEN_DAYS);
  const ninetyDaysAgo = daysAgoIso(SPARKLINE_WINDOW_DAYS);
  const fleets = await db.select().from(tables.fleets);

  const spikes = await Promise.all(
    fleets.map(async (fleet): Promise<FleetSpike | null> => {
      const memberRows = await db
        .select({ channelId: tables.fleetChannels.channelId })
        .from(tables.fleetChannels)
        .where(eq(tables.fleetChannels.fleetId, fleet.id));
      const channelIds = memberRows.map((r) => r.channelId);
      if (channelIds.length === 0) return null;

      const [newOutliersRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tables.videos)
        .where(
          and(
            inArray(tables.videos.channelId, channelIds),
            gte(tables.videos.outlierScore, OUTLIER_MIN_SCORE),
            gte(tables.videos.postedAt, sevenDaysAgo),
            isNull(tables.videos.deletedAt)
          )
        );
      const newOutliers7d = newOutliersRow?.count ?? 0;
      if (newOutliers7d === 0) return null;

      const recentVideos = await db
        .select({ postedAt: tables.videos.postedAt, viewCount: tables.videos.viewCount })
        .from(tables.videos)
        .where(
          and(
            inArray(tables.videos.channelId, channelIds),
            gte(tables.videos.postedAt, ninetyDaysAgo),
            isNull(tables.videos.deletedAt)
          )
        );

      return {
        fleetId: fleet.id,
        fleetName: fleet.name,
        newOutliers7d,
        sparkline: bucketViewsByPostedAt(recentVideos),
      };
    })
  );

  return spikes
    .filter((s): s is FleetSpike => s !== null)
    .sort((a, b) => b.newOutliers7d - a.newOutliers7d);
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
