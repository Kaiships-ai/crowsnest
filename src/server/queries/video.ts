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
