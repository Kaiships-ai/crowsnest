/**
 * Pure reel-insight shaping for the My reels tab: no database, no network. Rates are per
 * viewer (metric / reach) and are null, never 0, when either side is missing or reach is 0.
 */

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
}
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
      { label: "Follows", value: s.followsFromPost },
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
      { label: "Follows", value: s.followsFromPost },
      { label: "Profile visits", value: s.profileVisits },
      { label: "Bio link taps", value: s.bioLinkTaps },
    ],
  };
}

/** The reel named by ?reel= when it exists, else the newest, else null. */
export function selectReel<T extends { ownPostId: string }>(reels: T[], param: string | undefined): T | null {
  return reels.find((r) => r.ownPostId === param) ?? reels[0] ?? null;
}
