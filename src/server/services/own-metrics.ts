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
 *
 * The minimum-sample-size rule is a different kind of thing from the units question
 * above, and does NOT get the same separate-by-design treatment. "How many measured
 * posts before a median is trustworthy" is a policy about statistics, not about what a
 * post measures, and channel-side scoring already has a named answer for it:
 * `scoreMinUsablePosts` in `src/server/settings/index.ts`, a setting a person can change
 * on the Settings page. This module used to hardcode its own copy (`MIN_USABLE = 5`)
 * that happened to match the setting's default and would silently stop matching the
 * moment anyone changed it. `minUsable` is now a parameter with the same default,
 * resolved from that same setting by every caller (see `src/server/queries/own-channel.ts`),
 * so the own-channel median and the channel-side scores move together.
 */

export interface OwnPostForCalc {
  ownPostId: string;
  reach: number | null;
  postedAt: string;
}

export interface OwnBaselineOptions {
  /** Trailing post count the median is computed over. Own-channel reach has no
   *  configurable baseline window, unlike channel scoring's `scoreBaselineWindow`, so
   *  this stays a plain constant. @default 20 */
  window?: number;
  /** Fewer usable (measured) posts than this and there is no median, full stop. Callers
   *  should pass `scoreMinUsablePosts` from `src/server/settings` here rather than rely
   *  on the default. The default exists only for callers that have not resolved
   *  settings yet (and for tests). @default 5 */
  minUsable?: number;
}

export function computeOwnMedianReach(posts: OwnPostForCalc[], opts: OwnBaselineOptions = {}): number | null {
  const window = opts.window ?? 20;
  const minUsable = opts.minUsable ?? 5;
  const usable = posts
    .filter((p) => p.reach !== null)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, window);
  if (usable.length < minUsable) return null;
  const m = median(usable.map((p) => p.reach as number));
  return m === 0 ? null : m;
}

/** Reach expressed as a multiple of the channel's own median, one decimal place. Null
 *  when either side is null — there is no "index against nothing". */
export function indexAgainstOwnMedian(reach: number | null, ownMedian: number | null): number | null {
  if (reach === null || ownMedian === null || ownMedian === 0) return null;
  return Math.round((reach / ownMedian) * 10) / 10;
}
