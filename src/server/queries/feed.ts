import { and, desc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
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
  /** Free-text search over caption, channel handle, and channel display name.
   *  Case-insensitive substring match. Undefined or blank means no search — this is
   *  the field the command palette's post search and the feed's search box both drive. */
  query?: string;
  sort: FeedSort;
  limit: number;
  offset: number;
}

export interface FeedItem {
  videoId: string;
  url: string;
  caption: string | null;
  /** "photo" | "video" | "carousel" — a 30-day sync of a real creator returns all three. */
  mediaType: string;
  thumbnailAssetId: string | null;
  /** Null until the file is fetched; videos download on first play, not during sync. */
  videoAssetId: string | null;
  postedAt: string;
  durationSec: number | null;
  viewCount: number | null;
  outlierScore: number | null;
  /** (likeCount + commentCount) / viewCount, a raw ratio — 0.042, not "4.2%". The card
   *  multiplies by 100 and rounds for display; this layer doesn't make that call. Null
   *  when viewCount is null or zero, or either count is null — never a fabricated 0. */
  engagementRate: number | null;
  /** True when Instagram no longer shows this post (videos.deleted_at is set). The post
   *  still appears in results — a research tool that silently drops a formerly-outlier
   *  post loses the history it exists to keep, so this marks removal instead of hiding
   *  it. The card renders the removed marker off this flag. */
  deleted: boolean;
  channel: {
    id: string;
    handle: string;
    displayName: string | null;
    avatarAssetId: string | null;
    followerCount: number | null;
    platform: string;
  };
}

/**
 * Shared column shape for "a video joined with its channel" — the SQL-level source of
 * truth for FeedItem. Reused by video.ts's getVideoDetail so the two never drift.
 *
 * `thumbnailUrl`/`avatarUrl` no longer exist on the schema (expiring CDN URLs are never
 * stored) — this selects the `*AssetId` foreign keys instead. Callers resolve them to a
 * servable URL via `assetUrl()` from `src/lib/media-url.ts`; this layer never builds a
 * URL string itself.
 *
 * `likeCount`, `commentCount` and `deletedAt` are raw inputs, not part of `FeedItem` —
 * `toFeedItem` below turns them into the derived `engagementRate` and `deleted` fields.
 * They stay in this shared shape (rather than a private select in `getOutlierFeed`) so
 * `video.ts`'s `getVideoDetail`, which needs the raw counts and the raw timestamp for
 * its own top-level fields, reads them off the same row instead of a second query.
 */
export const feedItemColumns = {
  videoId: tables.videos.id,
  url: tables.videos.url,
  caption: tables.videos.caption,
  mediaType: tables.videos.mediaType,
  thumbnailAssetId: tables.videos.thumbnailAssetId,
  // Null until the video is fetched — downloads happen on first play, not at sync time.
  videoAssetId: tables.videos.videoAssetId,
  postedAt: tables.videos.postedAt,
  durationSec: tables.videos.durationSec,
  viewCount: tables.videos.viewCount,
  likeCount: tables.videos.likeCount,
  commentCount: tables.videos.commentCount,
  outlierScore: tables.videos.outlierScore,
  deletedAt: tables.videos.deletedAt,
  channel: {
    id: tables.channels.id,
    handle: tables.channels.handle,
    displayName: tables.channels.displayName,
    avatarAssetId: tables.channels.avatarAssetId,
    followerCount: tables.channels.followerCount,
    platform: tables.channels.platform,
  },
} as const;

/** The raw select shape `feedItemColumns` produces, before `toFeedItem` derives
 *  `engagementRate`/`deleted` and drops the raw inputs. Exported for callers that spread
 *  `feedItemColumns` into a wider select (similar.ts, saved-posts.ts) and need to type
 *  the row they hand to `toFeedItem`. */
export type FeedItemRow = {
  videoId: string;
  url: string;
  caption: string | null;
  mediaType: string;
  thumbnailAssetId: string | null;
  videoAssetId: string | null;
  postedAt: string;
  durationSec: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  outlierScore: number | null;
  deletedAt: string | null;
  channel: FeedItem["channel"];
};

/**
 * Turns a raw `feedItemColumns` row into a `FeedItem`: derives `engagementRate` and
 * `deleted` from the counts and the soft-delete timestamp, and drops those raw inputs
 * from the public shape. The one place this arithmetic happens, so a feed card and the
 * detail page can never compute two different engagement rates for the same post.
 */
export function toFeedItem(row: FeedItemRow): FeedItem {
  const { likeCount, commentCount, deletedAt, ...rest } = row;
  const engagementRate =
    rest.viewCount !== null && rest.viewCount > 0 && likeCount !== null && commentCount !== null
      ? (likeCount + commentCount) / rest.viewCount
      : null;
  return { ...rest, engagementRate, deleted: deletedAt !== null };
}

const FOLLOWER_BAND_BOUNDS: Record<NonNullable<FeedFilters["followerBand"]>, [number, number | null]> = {
  nano: [0, 10_000],
  micro: [10_000, 100_000],
  mid: [100_000, 1_000_000],
  macro: [1_000_000, null],
};

/**
 * The fields `buildWhere` actually reads. Deliberately narrower than `FeedFilters` (no
 * `sort`/`limit`/`offset`, which are paging/ordering concerns, not row-selection ones)
 * so `getFeedBandCounts` below can call it with a partial filter set — "every other
 * active filter, one band at a time" — without inventing paging values it never uses.
 */
type WhereFilters = Omit<FeedFilters, "sort" | "limit" | "offset">;

async function buildWhere(f: WhereFilters): Promise<SQL | undefined> {
  const conditions: SQL[] = [];

  // Deleted (removed-from-Instagram) posts are NOT excluded here. They used to be,
  // unconditionally — that was the bug: `videos.deleted_at` exists and the detail page
  // already renders a banner for it, but a post that's been filtered out of every feed
  // query can never be found to open (v1-gap-inventory.md). `FeedItem.deleted` carries
  // the flag instead so the card can mark it removed rather than pretending it never
  // existed.

  if (f.channelId) conditions.push(eq(tables.videos.channelId, f.channelId));
  if (f.platform) conditions.push(eq(tables.videos.platform, f.platform));
  if (f.minScore !== undefined) conditions.push(gte(tables.videos.outlierScore, f.minScore));
  if (f.minViews !== undefined) conditions.push(gte(tables.videos.viewCount, f.minViews));
  if (f.sinceDays !== undefined) {
    const cutoff = new Date(Date.now() - f.sinceDays * 86_400_000).toISOString();
    conditions.push(gte(tables.videos.postedAt, cutoff));
  }
  if (f.followerBand) {
    // Defense in depth alongside `bandOrAny` (feed-filters.ts), which is the parse-side
    // fix for C1: a bad `followerBand` (anything outside the four real bands) must never
    // reach a destructure of `undefined` here and 500 the page, whichever caller supplied
    // it.
    const bounds = FOLLOWER_BAND_BOUNDS[f.followerBand];
    if (bounds) {
      const [min, max] = bounds;
      conditions.push(gte(tables.channels.followerCount, min));
      if (max !== null) conditions.push(lt(tables.channels.followerCount, max));
    }
  }
  if (f.query && f.query.trim()) {
    const pattern = `%${f.query.trim()}%`;
    const clause = or(
      like(tables.videos.caption, pattern),
      like(tables.channels.handle, pattern),
      like(tables.channels.displayName, pattern)
    );
    if (clause) conditions.push(clause);
  }
  if (f.fleetId) {
    const rows = await db
      .select({ channelId: tables.fleetChannels.channelId })
      .from(tables.fleetChannels)
      .where(eq(tables.fleetChannels.fleetId, f.fleetId));
    const channelIds = rows.map((r) => r.channelId);
    // An empty-membership fleet must still scope the result to "nothing", but never
    // via inArray(col, []) — an empty IN-list isn't guaranteed safe/well-defined SQL
    // across dialects (backlog M2). `sql\`0\`` is an explicit, always-false condition.
    conditions.push(channelIds.length > 0 ? inArray(tables.videos.channelId, channelIds) : sql`0`);
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

  const [rows, totalRows] = await Promise.all([
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

  // `total` above IS the feed summary count (plan Wave 1 item 4): the real count of
  // everything the current filter slice holds, before pagination. No separate query.
  return { items: rows.map(toFeedItem), total: totalRows[0]?.count ?? 0 };
}

export interface FeedBandCounts {
  nano: number;
  micro: number;
  mid: number;
  macro: number;
}

/**
 * How many posts fall in each follower band, given every OTHER active filter — never a
 * separate count per chip re-deriving its own filter subset. Acceptance criterion: the
 * sum of the four counts equals the total under every non-band filter, and changing a
 * non-band filter changes the counts. `f.followerBand` is accepted but ignored (a caller
 * that reuses a `FeedFilters` object doesn't have to strip it first) since the whole
 * point is one count per band regardless of which band, if any, is currently selected.
 */
async function countForBand(f: Omit<WhereFilters, "followerBand">, band: keyof FeedBandCounts): Promise<number> {
  const where = await buildWhere({ ...f, followerBand: band });
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(where);
  return row?.count ?? 0;
}

export async function getFeedBandCounts(f: Omit<WhereFilters, "followerBand"> = {}): Promise<FeedBandCounts> {
  const [nano, micro, mid, macro] = await Promise.all([
    countForBand(f, "nano"),
    countForBand(f, "micro"),
    countForBand(f, "mid"),
    countForBand(f, "macro"),
  ]);
  return { nano, micro, mid, macro };
}

export interface SavedFilterRow {
  id: string;
  name: string;
  isSystem: boolean;
  criteria: Record<string, unknown>;
}

export async function getSavedFilters(): Promise<SavedFilterRow[]> {
  return db
    .select({
      id: tables.savedFilters.id,
      name: tables.savedFilters.name,
      isSystem: tables.savedFilters.isSystem,
      criteria: tables.savedFilters.criteria,
    })
    .from(tables.savedFilters);
}
