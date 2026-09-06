import { inArray } from "drizzle-orm";

import { db, tables } from "@/server/db";
import { getOutlierFeed, type FeedItem } from "@/server/queries/feed";
import { getOwnPosts } from "@/server/queries/own-channel";

/**
 * Research read bundles for the monthly/weekly planning loop (spec: MCP monthly and
 * weekly content planning). Both bundles pair competitor OUTLIERS (scored on
 * `outlierScore`, views over a competitor's own baseline) with the user's OWN posts
 * (scored on `reachIndex`, reach over the user's own median). The two are different
 * units and both are returned side by side — never merged into one number — so the agent
 * can cross-reference by format, hook, and topic without pretending they are comparable.
 *
 * Neither query re-implements the feed SQL: they call `getOutlierFeed` and join each
 * returned item to its `video_analyses` row.
 */

/** One own post reduced to the fields the agent benchmarks against: its format, its
 *  reach index (null until enough measured posts exist), and when it went out. */
export interface OwnBenchmarkRow {
  format: string;
  reachIndex: number | null;
  postedAt: string;
}

export type ResearchOutlier = FeedItem & { analysis: typeof tables.videoAnalyses.$inferSelect | null };

async function ownBenchmark(): Promise<OwnBenchmarkRow[]> {
  const { items } = await getOwnPosts({ limit: 50 });
  return items.map((p) => ({ format: p.format, reachIndex: p.reachIndex, postedAt: p.postedAt }));
}

/** Attach each feed item's `video_analyses` row (or null) in one query, keyed by videoId. */
async function attachAnalyses(items: FeedItem[]): Promise<ResearchOutlier[]> {
  if (items.length === 0) return [];
  const rows = await db
    .select()
    .from(tables.videoAnalyses)
    .where(inArray(tables.videoAnalyses.videoId, items.map((i) => i.videoId)));
  const byId = new Map(rows.map((r) => [r.videoId, r]));
  return items.map((i) => ({ ...i, analysis: byId.get(i.videoId) ?? null }));
}

export interface ResearchSetFilters {
  minScore?: number;
  sinceDays?: number;
  query?: string;
  limit?: number;
}

/** A broad reading bundle: the top outliers (by score) with their analyses, plus the
 *  own-channel reachIndex benchmark. */
export async function getResearchSet(
  filters: ResearchSetFilters = {},
): Promise<{ outliers: ResearchOutlier[]; ownBenchmark: OwnBenchmarkRow[] }> {
  const { items } = await getOutlierFeed({
    sort: "score",
    limit: filters.limit ?? 24,
    offset: 0,
    minScore: filters.minScore,
    sinceDays: filters.sinceDays,
    query: filters.query,
  });
  return { outliers: await attachAnalyses(items), ownBenchmark: await ownBenchmark() };
}

/** A tight top-N shortlist. `rising` sorts by recency (surface this week's surges within
 *  a short `sinceDays` for the weekly refresh); otherwise by score. Only ranking the feed
 *  query can already back — no invented metric. */
export async function getOutlierPack(
  opts: { limit?: number; sinceDays?: number; rising?: boolean } = {},
): Promise<{ items: ResearchOutlier[]; ownBenchmark: OwnBenchmarkRow[] }> {
  const { items } = await getOutlierFeed({
    sort: opts.rising ? "recent" : "score",
    limit: opts.limit ?? 8,
    offset: 0,
    sinceDays: opts.sinceDays,
  });
  return { items: await attachAnalyses(items), ownBenchmark: await ownBenchmark() };
}
