export interface VideoForCalc {
  id: string;
  viewCount: number | null;
  postedAt: string;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Drops the top and bottom TRIM_FRACTION of the sorted values, then averages what's
 * left. 10% each side is the conventional default for a trimmed mean — it is not
 * measured from this product's data and is not specified anywhere in the product docs,
 * so it is written down here as a choice, not a fact, for whoever touches this next.
 * Below 5 values the trim would leave nothing (or flip the ordering), so it falls back
 * to a plain mean rather than producing a division-by-zero or a misleading result from
 * one or two surviving values.
 */
const TRIM_FRACTION = 0.1;
export function trimmedMean(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const cut = Math.floor(s.length * TRIM_FRACTION);
  const kept = cut > 0 && s.length - 2 * cut > 0 ? s.slice(cut, s.length - cut) : s;
  return mean(kept);
}

/** Settings key: scoreBaselineMethod. Which statistic defines "normal" for a channel. */
export type BaselineMethod = "median" | "mean" | "trimmedMean";

/**
 * How far back a baseline looks. Deliberately generic (not the three named settings
 * options) so this module stays a pure calculator with no knowledge of app_settings —
 * `src/server/settings` is what translates "last 12 posts" / "last 30 days" /
 * "all history" into one of these.
 */
export type WindowSpec = { kind: "posts"; count: number } | { kind: "days"; count: number } | { kind: "all" };

export interface BaselineOptions {
  /** @default "median" */
  method?: BaselineMethod;
  /** @default { kind: "posts", count: 20 } — the app's behaviour before settings existed. */
  window?: WindowSpec;
  /** Fewer usable posts than this and there is no baseline, full stop. This is the rule
   *  that stops a three-post channel producing a 40x. @default 5 */
  minUsable?: number;
  /** Posts with fewer views than this are dropped before the baseline is computed, as
   *  though they were never posted — they neither drag the baseline down nor count
   *  toward minUsable. 0 means no floor. @default 0 */
  minViewsFloor?: number;
  /** Reference point for a "days" window. Injectable for tests. @default new Date() */
  now?: Date;
}

const DEFAULT_OPTIONS: Required<BaselineOptions> = {
  method: "median",
  window: { kind: "posts", count: 20 },
  minUsable: 5,
  minViewsFloor: 0,
  now: new Date(0), // overwritten per-call below; never actually read with this value
};

function resolveOptions(opts: BaselineOptions): Required<BaselineOptions> {
  return {
    method: opts.method ?? DEFAULT_OPTIONS.method,
    window: opts.window ?? DEFAULT_OPTIONS.window,
    minUsable: opts.minUsable ?? DEFAULT_OPTIONS.minUsable,
    minViewsFloor: opts.minViewsFloor ?? DEFAULT_OPTIONS.minViewsFloor,
    now: opts.now ?? new Date(),
  };
}

function statFor(method: BaselineMethod, values: number[]): number {
  if (method === "mean") return mean(values);
  if (method === "trimmedMean") return trimmedMean(values);
  return median(values);
}

/**
 * The channel's baseline: whatever "normal" means for it under the given settings.
 * Null below `minUsable` usable posts, or when the computed statistic is exactly 0 — a
 * score computed against a zero baseline is a division by zero dressed as a number.
 */
export function computeChannelBaseline(videos: VideoForCalc[], opts: BaselineOptions = {}): number | null {
  const { method, window, minUsable, minViewsFloor, now } = resolveOptions(opts);

  let usable = videos
    .filter((v) => v.viewCount !== null && v.viewCount >= minViewsFloor)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt));

  if (window.kind === "posts") {
    usable = usable.slice(0, window.count);
  } else if (window.kind === "days") {
    const cutoff = new Date(now.getTime() - window.count * 86_400_000).toISOString();
    usable = usable.filter((v) => v.postedAt >= cutoff);
  }
  // window.kind === "all": no trimming.

  if (usable.length < minUsable) return null;

  const stat = statFor(method, usable.map((v) => v.viewCount as number));
  return stat === 0 ? null : stat;
}

/** Every video's view count divided by the channel baseline, one decimal. Null when the
 *  channel has no baseline, or the video itself has no view count. */
export function scoreVideosAgainstBaseline(videos: VideoForCalc[], opts: BaselineOptions = {}): Map<string, number | null> {
  const baseline = computeChannelBaseline(videos, opts);
  const out = new Map<string, number | null>();
  for (const v of videos) {
    out.set(v.id, baseline === null || v.viewCount === null ? null : Math.round((v.viewCount / baseline) * 10) / 10);
  }
  return out;
}
