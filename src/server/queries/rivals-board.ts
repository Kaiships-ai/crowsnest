import { and, desc, eq, isNull } from "drizzle-orm";

import { OUTLIERS_30D_MIN_SCORE } from "@/lib/outlier-constants";
import { db, tables } from "@/server/db";
import type { RivalTag } from "@/server/schemas";
import { getChannelsList, type ChannelRow } from "./channels";
import { feedItemColumns, getOutlierFeed, toFeedItem, type FeedItem } from "./feed";

const OUTLIERS_PER_CHANNEL = 3;
const EVIDENCE_LIMIT = 24;

export interface RivalChannel extends ChannelRow {
  outliers: FeedItem[];
}

export interface RivalEvidence {
  post: FeedItem;
  analysis: {
    tag: RivalTag | null;
    hookType: string | null;
    formatTags: string[];
    styleTags: string[];
    whyItWorked: string | null;
    summary: string | null;
    createdAt: string;
  };
}

export interface RivalsBoard {
  channels: RivalChannel[];
  evidence: RivalEvidence[];
}

export async function getRivalsBoard(): Promise<RivalsBoard> {
  const rivals = (await getChannelsList()).filter((c) => !c.isOwn).sort((a, b) => a.handle.localeCompare(b.handle));
  const channels = await Promise.all(
    rivals.map(async (c) => ({
      ...c,
      outliers: (await getOutlierFeed({ channelId: c.id, sinceDays: 30, minScore: OUTLIERS_30D_MIN_SCORE, sort: "score", limit: OUTLIERS_PER_CHANNEL, offset: 0 })).items,
    })),
  );
  const rows = await db
    .select({ ...feedItemColumns, analysis: tables.videoAnalyses })
    .from(tables.videoAnalyses)
    .innerJoin(tables.videos, eq(tables.videos.id, tables.videoAnalyses.videoId))
    .innerJoin(tables.channels, eq(tables.channels.id, tables.videos.channelId))
    .where(and(eq(tables.channels.isOwn, false), isNull(tables.channels.deletedAt)))
    .orderBy(desc(tables.videoAnalyses.createdAt))
    .limit(EVIDENCE_LIMIT);
  return {
    channels,
    evidence: rows.map(({ analysis, ...row }) => ({
      post: toFeedItem(row),
      analysis: {
        tag: analysis.tag,
        hookType: analysis.hookType,
        formatTags: analysis.formatTags ?? [],
        styleTags: analysis.styleTags ?? [],
        whyItWorked: analysis.whyItWorked,
        summary: analysis.summary,
        createdAt: analysis.createdAt,
      },
    })),
  };
}
