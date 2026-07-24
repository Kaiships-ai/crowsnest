import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import type { VideoAnalysis } from "@/server/llm/schemas";
// Shared with remix.ts (Task 5) — see analyze.ts's export comment. Review finding L1:
// this file used to keep its own private copy of the same row -> VideoAnalysis
// mapping instead of importing the one already exported for exactly this reuse.
import { rowToAnalysis } from "@/server/services/analyze";
import { feedItemColumns, type FeedItem } from "./feed";

export interface VideoDetail {
  item: FeedItem;
  likeCount: number | null;
  commentCount: number | null;
  transcript: { text: string; source: string } | null;
  analysis: VideoAnalysis | null;
}

export async function getVideoDetail(id: string): Promise<VideoDetail | null> {
  const [row] = await db
    .select({ ...feedItemColumns, likeCount: tables.videos.likeCount, commentCount: tables.videos.commentCount })
    .from(tables.videos)
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(eq(tables.videos.id, id))
    .limit(1);

  if (!row) return null;

  const [transcriptRow] = await db
    .select({ text: tables.transcripts.text, source: tables.transcripts.source })
    .from(tables.transcripts)
    .where(eq(tables.transcripts.videoId, id))
    .limit(1);

  const [analysisRow] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, id)).limit(1);

  const { likeCount, commentCount, ...item } = row;

  return {
    item,
    likeCount,
    commentCount,
    transcript: transcriptRow ?? null,
    analysis: analysisRow ? rowToAnalysis(analysisRow) : null,
  };
}

const RECENTLY_VIEWED_KEY = "recently_viewed";
const RECENTLY_VIEWED_MAX = 8;

/**
 * Fire-and-forget visit tracking for the Dashboard's "Recently viewed" row (Task 1,
 * phase 4) — called (not awaited) from the Video Detail page on every load, so a slow
 * or failing write never delays rendering the actual video content. Stores
 * `app_settings.recently_viewed` as a JSON array of videoIds, most-recent-first,
 * deduped (re-viewing a video bumps it back to the front rather than adding a
 * duplicate), capped at 8 (queries/dashboard.ts's getRecentlyViewed only reads the
 * front 4 of those, leaving headroom for videos that get deleted in between).
 */
export async function recordRecentlyViewed(videoId: string): Promise<void> {
  try {
    const [row] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, RECENTLY_VIEWED_KEY)).limit(1);

    let ids: unknown = [];
    if (row) {
      try {
        ids = JSON.parse(row.value);
      } catch {
        ids = [];
      }
    }
    if (!Array.isArray(ids)) ids = [];

    const next = [videoId, ...(ids as string[]).filter((id) => id !== videoId)].slice(0, RECENTLY_VIEWED_MAX);
    const value = JSON.stringify(next);

    if (row) {
      await db.update(tables.appSettings).set({ value }).where(eq(tables.appSettings.key, RECENTLY_VIEWED_KEY));
    } else {
      await db.insert(tables.appSettings).values({ key: RECENTLY_VIEWED_KEY, value });
    }
  } catch {
    // Swallowed deliberately — see doc comment above. A tracking failure must never
    // surface to the Video Detail page or its caller.
  }
}
