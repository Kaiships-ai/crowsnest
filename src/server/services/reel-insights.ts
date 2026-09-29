/**
 * Pure reel-insight shaping for the My reels tab: no database, no network. Rates are per
 * viewer (metric / reach) and are null, never 0, when either side is missing or reach is 0.
 */

import { median } from "./outlier-calc";

const HOUR_MS = 3_600_000;
/** Views over time covers the first 7 days after posting, matching the Instagram app's
 *  views-over-time view. ponytail: fixed window bounds the query and the payload (at most
 *  168 points); widen it or add a daily bucket past day 7 if a longer curve is wanted. */
export const REEL_CURVE_HOURS = 168;

export interface OwnReelSnapshot {
  capturedAt: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  reposts: number | null;
  followsFromPost: number | null;
  profileVisits: number | null;
  bioLinkTaps: number | null;
  avgWatchTimeMs: number | null;
  skipRate: number | null;
  fetchError: string | null;
}
export interface OwnReel {
  ownPostId: string;
  /** Graph media id. Auto-publish stores this as a plan's publishedOwnPostId. */
  externalId: string;
  permalink: string;
  caption: string | null;
  postedAt: string;
  thumbnailUrl: string | null;
  latest: OwnReelSnapshot | null;
}
export interface InsightItem {
  label: string;
  value: number | null;
  unit?: "seconds";
  /** Instagram does not report this metric for reels; rendered as such, never as a number. */
  notReported?: true;
}

/** Meta lists follows and profile_visits for FEED and STORY media only, so a reel never has them. */
const NOT_REPORTED_FOR_REELS = { value: null, notReported: true } as const;
export interface RateItem {
  label: string;
  value: number | null;
  estimated: boolean;
}
export interface ShapedReelInsights {
  measuredAt: string;
  summary: InsightItem[];
  interactions: InsightItem[];
  impact: RateItem[];
  actions: InsightItem[];
}

export interface ReelSnapshotPoint {
  ownPostId: string;
  postedAt: string;
  capturedAt: string;
  views: number | null;
}
export interface ViewsPoint {
  hour: number;
  views: number | null;
  typical: number | null;
}

export function perViewerRate(metric: number | null, reach: number | null): number | null {
  if (metric === null || reach === null || reach === 0) return null;
  return metric / reach;
}

export function shapeReelInsights(s: OwnReelSnapshot): ShapedReelInsights {
  return {
    measuredAt: s.capturedAt,
    summary: [
      { label: "Views", value: s.views },
      { label: "Viewers", value: s.reach },
      { label: "Average watch time", value: s.avgWatchTimeMs === null ? null : s.avgWatchTimeMs / 1000, unit: "seconds" },
      { label: "Follows", ...NOT_REPORTED_FOR_REELS },
    ],
    interactions: [
      { label: "Likes", value: s.likes },
      { label: "Comments", value: s.comments },
      { label: "Reposts", value: s.reposts },
      { label: "Shares", value: s.shares },
      { label: "Saves", value: s.saved },
    ],
    // The Instagram app's order of importance to reach. Skip rate is the API's own value,
    // flagged estimated because Meta marks the metric as in development.
    impact: [
      { label: "Skip rate", value: s.skipRate, estimated: true },
      { label: "Share rate", value: perViewerRate(s.shares, s.reach), estimated: false },
      { label: "Like rate", value: perViewerRate(s.likes, s.reach), estimated: false },
      { label: "Save rate", value: perViewerRate(s.saved, s.reach), estimated: false },
      { label: "Repost rate", value: perViewerRate(s.reposts, s.reach), estimated: false },
      { label: "Comment rate", value: perViewerRate(s.comments, s.reach), estimated: false },
    ],
    actions: [
      { label: "Follows", ...NOT_REPORTED_FOR_REELS },
      { label: "Profile visits", ...NOT_REPORTED_FOR_REELS },
      { label: "Bio link taps", value: s.bioLinkTaps },
    ],
  };
}

/** The reel named by ?reel=, or the newest when there is no ?reel=. Null when ?reel= names
 *  a reel not in own_posts yet (a just-published reel), so the page says so instead of
 *  showing another reel. Matches own_posts.id or the Graph media id: a calendar link
 *  carries whichever the plan stored (a hand mark stores the first, auto-publish the second). */
export function selectReel<T extends { ownPostId: string; externalId?: string }>(reels: T[], param: string | undefined): T | null {
  if (param === undefined) return reels[0] ?? null;
  return reels.find((r) => r.ownPostId === param || r.externalId === param) ?? null;
}

export function hoursSincePosted(postedAt: string, capturedAt: string): number {
  return Math.floor((Date.parse(capturedAt) - Date.parse(postedAt)) / HOUR_MS);
}

/**
 * The selected reel's views by whole hour since posting, next to the median of every OTHER
 * reel measured at that same hour. Only real snapshots become points; hours run 0 to the
 * selected reel's newest measured hour inside REEL_CURVE_HOURS, so at most 168 points.
 */
export function typicalViewsCurve(selectedId: string, history: ReelSnapshotPoint[]): ViewsPoint[] {
  const byReel = new Map<string, Map<number, { capturedAt: string; views: number }>>();
  for (const s of history) {
    if (s.views === null) continue;
    const hour = hoursSincePosted(s.postedAt, s.capturedAt);
    if (hour < 0 || hour >= REEL_CURVE_HOURS) continue;
    let buckets = byReel.get(s.ownPostId);
    if (!buckets) byReel.set(s.ownPostId, (buckets = new Map()));
    const prev = buckets.get(hour);
    if (!prev || s.capturedAt > prev.capturedAt) buckets.set(hour, { capturedAt: s.capturedAt, views: s.views });
  }
  const own = byReel.get(selectedId);
  if (!own || own.size === 0) return [];
  const maxHour = Math.max(...own.keys());
  const points: ViewsPoint[] = [];
  for (let hour = 0; hour <= maxHour; hour++) {
    const others: number[] = [];
    for (const [id, buckets] of byReel) {
      const b = id === selectedId ? undefined : buckets.get(hour);
      if (b) others.push(b.views);
    }
    const views = own.get(hour)?.views ?? null;
    const typical = others.length > 0 ? median(others) : null;
    if (views !== null || typical !== null) points.push({ hour, views, typical });
  }
  return points;
}
