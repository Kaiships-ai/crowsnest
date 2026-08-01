/**
 * Shared between `feed/page.tsx` (server-side resolution) and `filter-bar.tsx` (client
 * controls), so the definition of "a filter param is present" cannot drift between the
 * two. See docs/qa/2026-08-01-feed-fix-plan.md, "Shared mechanism behind findings 1 and
 * 2" — before this existed, `filter-bar.tsx` had its own copy and `page.tsx` used a
 * coarser `Object.keys(sp).length === 0` check that also tripped on non-filter params
 * like `density`, `view`, `sort`, and `limit`.
 */
export const FILTER_PARAM_KEYS = ["fleet", "platform", "minScore", "minViews", "since", "band", "q"] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function num(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Like `num`, but treats the literal string "any" as "filter explicitly off" (undefined)
 * rather than `Number("any")`, which is `NaN`. `filter-bar.tsx`'s score/views/timeframe/
 * follower-band selects write `key=any` to the URL when the user picks the "show
 * everything" option — that token has to resolve to "no condition", not get coerced to
 * NaN and then dropped by the `Number.isFinite` check below (which would work by
 * accident today, but only because NaN is not finite; parsing it explicitly documents
 * the intent instead of relying on that side effect).
 */
export function numOrAny(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (s === "any") return undefined;
  return num(v);
}

function criteriaNum(criteria: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = criteria?.[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * "Balanced" only applies on a truly bare `/feed` visit — once the URL carries any
 * *filter* param, the user's exact intent (including "no minScore") is respected as-is.
 * Cosmetic params (`density`, `view`, `sort`, `limit`) don't count: a density toggle
 * alone must not silently revert the score/timeframe filter back to none (finding 1).
 */
export function isFeedEmpty(sp: SearchParams): boolean {
  return FILTER_PARAM_KEYS.every((k) => sp[k] === undefined);
}

export interface ResolvedFeedCriteria {
  isEmpty: boolean;
  minScore: number | undefined;
  minViews: number | undefined;
  sinceDays: number | undefined;
}

/**
 * The pure `searchParams -> criteria` mapping `feed/page.tsx` renders from. Split out so
 * it can be unit tested without a request, a database, or React — the surrounding page
 * component isn't (it awaits `searchParams` and calls DB-backed query functions).
 *
 * `balancedCriteria` is the "Balanced" saved filter's `criteria` blob (or undefined if it
 * doesn't exist yet), applied only when `isEmpty` is true.
 */
export function resolveFeedCriteria(
  sp: SearchParams,
  balancedCriteria: Record<string, unknown> | undefined
): ResolvedFeedCriteria {
  const isEmpty = isFeedEmpty(sp);
  return {
    isEmpty,
    minScore: isEmpty ? criteriaNum(balancedCriteria, "minScore") : numOrAny(sp.minScore),
    minViews: isEmpty ? criteriaNum(balancedCriteria, "minViews") : numOrAny(sp.minViews),
    sinceDays: isEmpty ? criteriaNum(balancedCriteria, "sinceDays") : numOrAny(sp.since),
  };
}
