import { desc, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { getMedianViews } from "./channels";
import { feedItemColumns, toFeedItem, type FeedItem, type FeedItemRow } from "./feed";

/**
 * Saved posts — the Vault's flat list (V1 data contracts, Vault). Reads the
 * `saved_posts` table (added by this contract) joined live against `videos` /
 * `channels`, never a copy of a post's numbers at save time.
 */

export type SavedPostSort = "recent" | "score" | "analyzed";

export interface SavedPostRow {
  id: string;
  savedAt: string;
  /** "Why kept". Null renders as a dash — never defaulted to an empty string. */
  note: string | null;
  item: FeedItem;
  /** This channel's baseline, read live via getMedianViews. Null until the channel
   *  has enough posts to have one — never a zero standing in for "no baseline yet". */
  channelMedian: number | null;
  /** True when video_analyses has a row for this post. Backs the "analysed first"
   *  sort and lets the Vault mark a card as studied vs. merely saved. */
  analyzed: boolean;
  /** True when the source video's own deletedAt is set — Instagram no longer shows
   *  it. The saved row is kept (the point of a bookmark is that it survives), and the
   *  Vault has to say so rather than presenting it as a live post. */
  videoDeleted: boolean;
}

// FeedItemRow, not FeedItem: this is the raw pre-`toFeedItem` shape (feedItemColumns
// still carries deletedAt as a raw timestamp at this point) — getSavedPosts below runs
// it through toFeedItem and reads videoDeleted off the same raw deletedAt.
type SavedPostJoinRow = FeedItemRow & {
  savedPostId: string;
  savedAt: string;
  note: string | null;
};

async function getJoinedSavedPosts(): Promise<SavedPostJoinRow[]> {
  const rows = await db
    .select({
      savedPostId: tables.savedPosts.id,
      savedAt: tables.savedPosts.createdAt,
      note: tables.savedPosts.note,
      ...feedItemColumns,
    })
    .from(tables.savedPosts)
    .innerJoin(tables.videos, eq(tables.savedPosts.videoId, tables.videos.id))
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id));

  return rows;
}

function sortRows(rows: SavedPostRow[], sort: SavedPostSort): SavedPostRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "score":
      // Nulls last, same convention feed.ts's buildOrderBy uses for the identical case.
      sorted.sort((a, b) => {
        if (a.item.outlierScore === null && b.item.outlierScore === null) return 0;
        if (a.item.outlierScore === null) return 1;
        if (b.item.outlierScore === null) return -1;
        return b.item.outlierScore - a.item.outlierScore;
      });
      return sorted;
    case "analyzed":
      // Analysed posts first; ties broken by most-recently-saved, so the ordering is
      // still a real ordering rather than an arbitrary group.
      sorted.sort((a, b) => {
        if (a.analyzed !== b.analyzed) return a.analyzed ? -1 : 1;
        return b.savedAt.localeCompare(a.savedAt);
      });
      return sorted;
    case "recent":
    default:
      sorted.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      return sorted;
  }
}

/** The Vault's flat list. `sort` defaults to "recent" (most-recently-saved first). */
export async function getSavedPosts(sort: SavedPostSort = "recent"): Promise<SavedPostRow[]> {
  const rows = await getJoinedSavedPosts();
  if (rows.length === 0) return [];

  const videoIds = rows.map((r) => r.videoId);
  const channelIds = Array.from(new Set(rows.map((r) => r.channel.id)));

  const [analysisRows, medianByChannel] = await Promise.all([
    db.select({ videoId: tables.videoAnalyses.videoId }).from(tables.videoAnalyses).where(inArray(tables.videoAnalyses.videoId, videoIds)),
    Promise.all(channelIds.map(async (id) => [id, await getMedianViews(id)] as const)),
  ]);

  const analyzedSet = new Set(analysisRows.map((a) => a.videoId));
  const medianMap = new Map(medianByChannel);

  const items: SavedPostRow[] = rows.map((row) => {
    const { savedPostId, savedAt, note, ...rest } = row;
    return {
      id: savedPostId,
      savedAt,
      note,
      item: toFeedItem(rest),
      channelMedian: medianMap.get(row.channel.id) ?? null,
      analyzed: analyzedSet.has(row.videoId),
      videoDeleted: rest.deletedAt !== null,
    };
  });

  return sortRows(items, sort);
}

/** Backs the detail screen's Save button: which saved_posts row (if any) already
 *  points at this video, so the button can render "Saved" and offer to remove. */
export async function getSavedPostByVideoId(videoId: string): Promise<{ id: string; note: string | null; createdAt: string } | null> {
  const [row] = await db
    .select({ id: tables.savedPosts.id, note: tables.savedPosts.note, createdAt: tables.savedPosts.createdAt })
    .from(tables.savedPosts)
    .where(eq(tables.savedPosts.videoId, videoId))
    .orderBy(desc(tables.savedPosts.createdAt))
    .limit(1);
  return row ?? null;
}

/** True when this video has a saved_posts row. Cheaper than getSavedPostByVideoId for
 *  callers that only need the toggle state, not the row itself. */
export async function isVideoSaved(videoId: string): Promise<boolean> {
  const row = await getSavedPostByVideoId(videoId);
  return row !== null;
}
