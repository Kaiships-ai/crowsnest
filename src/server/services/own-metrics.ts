import { median } from "./outlier-calc";

/**
 * Own-channel median reach (V1 data contracts §7a).
 *
 * Deliberately a separate function from the channel-side baseline math
 * (`computeChannelBaseline` in `./outlier-calc.ts`), not a reuse with a swapped field
 * name. That one takes view counts off `videos`; an own post's reach is unique accounts
 * reached, a different quantity from a view count, and sharing one function across two
 * incompatible units is exactly how the two end up in one column and get compared as if
 * they meant the same thing.
 */

export interface OwnPostForCalc {
  ownPostId: string;
  reach: number | null;
  postedAt: string;
}

/** Same trailing-window shape `outlier-calc.ts` uses for a channel's own baseline:
 *  newest `window` posts with a measured reach, null below `MIN_USABLE`, null when the
 *  median itself is zero. This is always a plain median, not the configurable
 *  mean/trimmed-mean baseline — own-channel reach has no such setting. */
const MIN_USABLE = 5;

export function computeOwnMedianReach(posts: OwnPostForCalc[], window = 20): number | null {
  const usable = posts
    .filter((p) => p.reach !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, window);
  if (usable.length < MIN_USABLE) return null;
  const m = median(usable.map((p) => p.reach as number));
  return m === 0 ? null : m;
}

/** Reach expressed as a multiple of the channel's own median, one decimal place. Null
 *  when either side is null — there is no "index against nothing". */
export function indexAgainstOwnMedian(reach: number | null, ownMedian: number | null): number | null {
  if (reach === null || ownMedian === null || ownMedian === 0) return null;
  return Math.round((reach / ownMedian) * 10) / 10;
}
