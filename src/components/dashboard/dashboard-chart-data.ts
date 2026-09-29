import type { ChannelRow } from "@/server/queries/channels";
import type { FeedItem } from "@/server/queries/feed";

/**
 * Pure, no-I/O shaping for the dashboard's P1 charts (v1-scope.md P1 list): the
 * producer donut, the reach-vs-score scatter, the 28-day timeline, the score ranking
 * list, and the coverage list. Every function here takes data the page already fetched
 * through `getOutlierFeed`/`getChannelsList` — no query of its own here, and nothing
 * imported from `src/server` beyond the two result types. Colocated with the
 * components that render it because it's rendering-layer shaping, not a data contract
 * another screen shares.
 *
 * "Beat its channel" is score >= 1 everywhere in this file, matching
 * `median-baseline.tsx`'s `beatBaseline` and `outlier-badge.tsx`'s hero variant — the
 * one binary amber reading used throughout the app — not the 2x/5x/10x heat-tier ramp
 * `lib/heat.ts` uses for the feed's badge pills, which is a different, unrelated scale
 * for a different UI element.
 */
export const BEATS_BASELINE_MIN_SCORE = 1;

function beatsBaseline(score: number | null): boolean {
  return score !== null && score >= BEATS_BASELINE_MIN_SCORE;
}

// ---------------------------------------------------------------------------
// Producer donut — "who produces the posts that beat their channel"
// ---------------------------------------------------------------------------

export interface ProducerSlice {
  channelId: string;
  handle: string;
  count: number;
  /** 0-100, rounded. Share of `outlierTotal`, not of `postTotal`. */
  pct: number;
}

export interface ProducerDonut {
  slices: ProducerSlice[];
  /** Posts with score >= 1 — the denominator `pct` is a share of. */
  outlierTotal: number;
  /** Every post considered (live + removed) — the number the caption compares against,
   *  so "4 of 8" reads honestly even though the donut itself only plots the 4. */
  postTotal: number;
}

/** The donut's palette is four neutral surfaces (producer-donut.tsx), so at most four
 *  slices can draw without a color repeating. Producers past the top few fold into one
 *  "Other" slice rather than reusing a swatch. */
export const PRODUCER_DONUT_MAX_SLICES = 4;

export function buildProducerDonut(items: FeedItem[]): ProducerDonut {
  const tally = new Map<string, { handle: string; count: number }>();
  for (const item of items) {
    if (!beatsBaseline(item.outlierScore)) continue;
    const row = tally.get(item.channel.id) ?? { handle: item.channel.handle, count: 0 };
    row.count += 1;
    tally.set(item.channel.id, row);
  }
  const outlierTotal = [...tally.values()].reduce((sum, row) => sum + row.count, 0);
  const sorted = [...tally.entries()]
    .map(([channelId, row]) => ({
      channelId,
      handle: row.handle,
      count: row.count,
      pct: outlierTotal > 0 ? Math.round((row.count / outlierTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  let slices = sorted;
  if (sorted.length > PRODUCER_DONUT_MAX_SLICES) {
    const head = sorted.slice(0, PRODUCER_DONUT_MAX_SLICES - 1);
    const tail = sorted.slice(PRODUCER_DONUT_MAX_SLICES - 1);
    const count = tail.reduce((sum, row) => sum + row.count, 0);
    // The empty channelId is what marks this slice as not a channel — the legend
    // renders it as plain text instead of a link to /channels/.
    head.push({
      channelId: "",
      handle: "Other",
      count,
      pct: outlierTotal > 0 ? Math.round((count / outlierTotal) * 100) : 0,
    });
    slices = head;
  }

  return { slices, outlierTotal, postTotal: items.length };
}

// ---------------------------------------------------------------------------
// Reach vs score scatter
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  videoId: string;
  handle: string;
  viewCount: number;
  score: number;
  beat: boolean;
}

/**
 * A scatter point needs both dimensions. A null score (unscored channel) or a null or
 * zero view count has nothing to plot on one axis — those are counted in `omitted` and
 * dropped, never plotted at a made-up origin.
 */
export function buildScatterPoints(items: FeedItem[]): { points: ScatterPoint[]; omitted: number } {
  const points: ScatterPoint[] = [];
  let omitted = 0;
  for (const item of items) {
    if (item.outlierScore === null || item.viewCount === null || item.viewCount <= 0) {
      omitted += 1;
      continue;
    }
    points.push({
      videoId: item.videoId,
      handle: item.channel.handle,
      viewCount: item.viewCount,
      score: item.outlierScore,
      beat: beatsBaseline(item.outlierScore),
    });
  }
  return { points, omitted };
}

const VIEW_SCALE_MIN = 1_000;
const VIEW_SCALE_MAX = 10_000_000;

/** Where a view count sits on a fixed 1K-10M log scale, as a 0..1 fraction, clamped at
 *  both ends — the same clamp-not-overflow shape as `scalePosition` in
 *  `median-baseline.tsx`. A display scale, not a claim about any real bound on view
 *  counts. */
export function viewScalePosition(views: number): number {
  const clamped = Math.min(Math.max(views, VIEW_SCALE_MIN), VIEW_SCALE_MAX);
  return Math.log(clamped / VIEW_SCALE_MIN) / Math.log(VIEW_SCALE_MAX / VIEW_SCALE_MIN);
}

// ---------------------------------------------------------------------------
// 28-day rolling timeline
// ---------------------------------------------------------------------------

export const TIMELINE_WINDOW_DAYS = 28;

export interface TimelineDay {
  /** 0 = oldest day in the window, TIMELINE_WINDOW_DAYS - 1 = today. */
  index: number;
  /** The best (highest) score among posts posted that calendar day, or null for a day
   *  with no post at all. */
  bestScore: number | null;
  beat: boolean;
}

/**
 * One bucket per day for the trailing `TIMELINE_WINDOW_DAYS`, oldest first. A day with
 * more than one post takes its best score. v1-scope.md's cut ruling on this chart
 * ("a day's bucket has no single score") is why the per-day COLOR ramp was cut, not a
 * reason for height to stop reflecting magnitude — `bestScore` still drives bar height
 * here, `beat` still says whether that day cleared 1x, and the component renders every
 * bar in one hue regardless of which, per the ruling.
 */
export function buildOutlierTimeline(
  items: FeedItem[],
  now: number = Date.now()
): { days: TimelineDay[]; hitDays: number } {
  const days: TimelineDay[] = Array.from({ length: TIMELINE_WINDOW_DAYS }, (_, index) => ({
    index,
    bestScore: null,
    beat: false,
  }));

  for (const item of items) {
    if (item.outlierScore === null) continue;
    const postedMs = new Date(item.postedAt).getTime();
    const daysAgo = Math.floor((now - postedMs) / 86_400_000);
    if (daysAgo < 0 || daysAgo >= TIMELINE_WINDOW_DAYS) continue;
    const day = days[TIMELINE_WINDOW_DAYS - 1 - daysAgo];
    if (day.bestScore === null || item.outlierScore > day.bestScore) day.bestScore = item.outlierScore;
  }

  for (const day of days) day.beat = beatsBaseline(day.bestScore);
  const hitDays = days.filter((d) => d.beat).length;
  return { days, hitDays };
}

// ---------------------------------------------------------------------------
// Score ranking list
// ---------------------------------------------------------------------------

export interface RankingRow {
  videoId: string;
  score: number;
  caption: string | null;
  handle: string;
  platform: string;
  deleted: boolean;
}

/**
 * Every scored post, highest first, in the slim shape the ranking list actually renders.
 * The list is a client component, so passing full FeedItems serialized the whole library
 * into the RSC payload on every dashboard visit — this projects the six fields the row
 * uses, computed server-side, so only those cross the wire.
 *
 * An unscored post (its channel hasn't cleared `scoreMinUsablePosts`) can't be ranked, so
 * it's counted in `unranked` and excluded rather than sorted in at a fabricated last
 * place. `getOutlierFeed({ sort: "score" })` already orders nulls last, so this is a
 * filter over already-sorted input, not a re-sort.
 */
export function rankingRows(items: FeedItem[]): { rows: RankingRow[]; unranked: number } {
  const rows: RankingRow[] = [];
  for (const item of items) {
    if (item.outlierScore === null) continue;
    rows.push({
      videoId: item.videoId,
      score: item.outlierScore,
      // The row shows one truncated line; capping here keeps a whole library of long
      // captions out of the dashboard's RSC payload.
      caption: item.caption?.slice(0, 140) ?? null,
      handle: item.channel.handle,
      platform: item.channel.platform,
      deleted: item.deleted,
    });
  }
  return { rows, unranked: items.length - rows.length };
}

// ---------------------------------------------------------------------------
// Coverage list
// ---------------------------------------------------------------------------

export interface CoverageRow {
  channelId: string;
  handle: string;
  neverSynced: boolean;
  /** Live (non-removed) post count — matches `ChannelDetail.stats.videoCount`'s own
   *  live-only convention in `queries/channels.ts`, so this number can't quietly mean
   *  something different from what the Channels screen already says for the same
   *  channel. */
  liveCount: number;
}

export function buildCoverage(channels: ChannelRow[], items: FeedItem[]): CoverageRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.deleted) continue;
    counts.set(item.channel.id, (counts.get(item.channel.id) ?? 0) + 1);
  }
  return channels.map((channel) => ({
    channelId: channel.id,
    handle: channel.handle,
    neverSynced: channel.lastSyncedAt === null,
    liveCount: counts.get(channel.id) ?? 0,
  }));
}
