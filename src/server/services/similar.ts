import { eq, ne } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { feedItemColumns, type FeedItem } from "@/server/queries/feed";

/** The tag shape scoreSimilarity compares — derived from a video_analyses row. */
export interface TagSet {
  hookType: string;
  structureLabels: string[];
  formatTags: string[];
  styleTags: string[];
}

/** Counts distinct values shared between two lists (each list deduped first, so a
 * repeated label/tag on either side is still only worth 1). */
function sharedCount(a: string[], b: string[]): number {
  const bSet = new Set(b);
  const shared = new Set(a.filter((value) => bSet.has(value)));
  return shared.size;
}

/**
 * hookType exact match = 3; each distinct shared structure label = 1; each distinct
 * shared format tag = 1; each distinct shared style tag = 1 (format and style are
 * compared within their own category only — a formatTag never matches a styleTag).
 * Empty tag sets on either side simply contribute 0 to their term.
 */
export function scoreSimilarity(a: TagSet, b: TagSet): number {
  let score = 0;
  if (a.hookType !== "" && a.hookType === b.hookType) score += 3;
  score += sharedCount(a.structureLabels, b.structureLabels);
  score += sharedCount(a.formatTags, b.formatTags);
  score += sharedCount(a.styleTags, b.styleTags);
  return score;
}

interface AnalysisTagRow {
  hookType: string | null;
  structureSegments: { label: string }[] | null;
  formatTags: string[] | null;
  styleTags: string[] | null;
}

function rowToTagSet(row: AnalysisTagRow): TagSet {
  return {
    hookType: row.hookType ?? "",
    structureLabels: (row.structureSegments ?? []).map((segment) => segment.label),
    formatTags: row.formatTags ?? [],
    styleTags: row.styleTags ?? [],
  };
}

const DEFAULT_LIMIT = 5;

/**
 * "Similar outliers" (Task 3, our take on Sandcastles' "More Like This") — ranks
 * tracked videos that themselves have an analysis by tag overlap with the given
 * video's own analysis, ties broken by outlierScore desc, excluding the source video.
 * Returns `[]` when the source video has no analysis yet (nothing to compare against)
 * or when no *other* analyzed videos exist — either way the caller shows the same
 * "analyze more videos" empty state.
 */
export async function getSimilarOutliers(videoId: string, limit = DEFAULT_LIMIT): Promise<FeedItem[]> {
  const [sourceRow] = await db
    .select()
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, videoId))
    .limit(1);
  if (!sourceRow) return [];
  const sourceTagSet = rowToTagSet(sourceRow);

  const candidates = await db
    .select({
      ...feedItemColumns,
      hookType: tables.videoAnalyses.hookType,
      structureSegments: tables.videoAnalyses.structureSegments,
      formatTags: tables.videoAnalyses.formatTags,
      styleTags: tables.videoAnalyses.styleTags,
    })
    .from(tables.videoAnalyses)
    .innerJoin(tables.videos, eq(tables.videoAnalyses.videoId, tables.videos.id))
    .innerJoin(tables.channels, eq(tables.videos.channelId, tables.channels.id))
    .where(ne(tables.videoAnalyses.videoId, videoId));

  return candidates
    .map((row) => {
      const { hookType, structureSegments, formatTags, styleTags, ...item } = row;
      const score = scoreSimilarity(sourceTagSet, rowToTagSet({ hookType, structureSegments, formatTags, styleTags }));
      return { item, score };
    })
    .sort((a, b) =>
      b.score !== a.score ? b.score - a.score : (b.item.outlierScore ?? -Infinity) - (a.item.outlierScore ?? -Infinity)
    )
    .slice(0, limit)
    .map((scored) => scored.item);
}
