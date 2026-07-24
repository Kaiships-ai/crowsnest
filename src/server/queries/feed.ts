import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db, tables } from "@/server/db";

export type FeedSort = "score" | "recent" | "views";

export interface FeedFilters {
  fleetId?: string;
  channelId?: string;
  platform?: "instagram" | "tiktok" | "youtube_shorts";
  minScore?: number;
  minViews?: number;
  sinceDays?: number;
  followerBand?: "nano" | "micro" | "mid" | "macro";
  sort: FeedSort;
  limit: number;
  offset: number;
}

export interface FeedItem {
  videoId: string;
  url: string;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: string;
  durationSec: number | null;
  viewCount: number | null;
  outlierScore: number | null;
  channel: {
    id: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    followerCount: number | null;
    platform: string;
  };
}

/**
 * Shared column shape for "a video joined with its channel" — the SQL-level source of
 * truth for FeedItem. Reused by video.ts's getVideoDetail so the two never drift.
 */
export const feedItemColumns = {
  videoId: tables.videos.id,
  url: tables.videos.url,
  caption: tables.videos.caption,
  thumbnailUrl: tables.videos.thumbnailUrl,
  postedAt: tables.videos.postedAt,
  durationSec: tables.videos.durationSec,
  viewCount: tables.videos.viewCount,
  outlierScore: tables.videos.outlierScore,
  channel: {
    id: tables.channels.id,
    handle: tables.channels.handle,
    displayName: tables.channels.displayName,
    avatarUrl: tables.channels.avatarUrl,
    followerCount: tables.channels.followerCount,
    platform: tables.channels.platform,
  },
} as const;

const FOLLOWER_BAND_BOUNDS: Record<NonNullable<FeedFilters["followerBand"]>, [number, number | null]> = {
  nano: [0, 10_000],
  micro: [10_000, 100_000],
  mid: [100_000, 1_000_000],
  macro: [1_000_000, null],
};

async function buildWhere(f: FeedFilters): Promise<SQL | undefined> {
  const conditions: SQL[] = [];

  if (f.channelId) conditions.push(eq(tables.videos.channelId, f.channelId));
  if (f.platform) conditions.push(eq(tables.videos.platform, f.platform));
  if (f.minScore !== undefined) conditions.push(gte(tables.videos.outlierScore, f.minScore));
  if (f.minViews !== undefined) conditions.push(gte(tables.videos.viewCount, f.minViews));
  if (f.sinceDays !== undefined) {
    const cutoff = new Date(Date.now() - f.sinceDays * 86_400_000).toISOString();
    conditions.push(gte(tables.videos.postedAt, cutoff));
  }
  if (f.followerBand) {
    const [min, max] = FOLLOWER_BAND_BOUNDS[f.followerBand];
    conditions.push(gte(tables.channels.followerCount, min));
    if (max !== null) conditions.push(lt(tables.channels.followerCount, max));
  }
  if (f.fleetId) {
    const rows = await db
      .select({ channelId: tables.fleetChannels.channelId })
      .from(tables.fleetChannels)
      .where(eq(tables.fleetChannels.fleetId, f.fleetId));
    conditions.push(inArray(tables.videos.channelId, rows.map((r) => r.channelId)));
  }

  return conditions.length ? and(...conditions) : undefined;
}

function buildOrderBy(sort: FeedSort) {
  switch (sort) {
    case "score":
      // SQLite already sorts NULLs last under DESC, but the IS NULL key is kept
      // explicit per plan spec (Task 1) so intent reads clearly at the call site.
      return [sql`${tables.videos.outlierScore} IS NULL`, desc(tables.videos.outlierScore)];
    case "views":
      return [desc(tables.videos.viewCount)];
    case "recent":
    default:
      return [desc(tables.videos.postedAt)];
  }
}

export async function getOutlierFeed(f: FeedFilters): Promise<{ items: FeedItem[]; total: number }> {
  const where = await buildWhere(f);

  const [items, totalRows] = await Promise.all([
    db
      .select(feedItemColumns)
      .from(tables.videos)
      .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
      .where(where)
      .orderBy(...buildOrderBy(f.sort))
      .limit(f.limit)
      .offset(f.offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(tables.videos)
      .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
      .where(where),
  ]);

  return { items, total: totalRows[0]?.count ?? 0 };
}

export async function getSavedFilters(): Promise<{ id: string; name: string; isSystem: boolean; criteria: Record<string, unknown> }[]> {
  return db
    .select({
      id: tables.savedFilters.id,
      name: tables.savedFilters.name,
      isSystem: tables.savedFilters.isSystem,
      criteria: tables.savedFilters.criteria,
    })
    .from(tables.savedFilters);
}
