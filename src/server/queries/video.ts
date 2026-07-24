import { eq } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { feedItemColumns, type FeedItem } from "./feed";

export interface VideoDetail {
  item: FeedItem;
  likeCount: number | null;
  commentCount: number | null;
  transcript: { text: string; source: string } | null;
  hasAnalysis: boolean;
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

  const [analysisRow] = await db
    .select({ videoId: tables.videoAnalyses.videoId })
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, id))
    .limit(1);

  const { likeCount, commentCount, ...item } = row;

  return {
    item,
    likeCount,
    commentCount,
    transcript: transcriptRow ?? null,
    hasAnalysis: Boolean(analysisRow),
  };
}
