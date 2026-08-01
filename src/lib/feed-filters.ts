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

// Same four bands `FOLLOWER_BAND_BOUNDS` (server/queries/feed.ts) has keys for. Kept
// here, not imported from there, so this module (used by the client-side filter-bar.tsx
// too) never pulls in `@/server/db`.
export const FOLLOWER_BANDS = ["nano", "micro", "mid", "macro"] as const;
export type FollowerBand = (typeof FOLLOWER_BANDS)[number];

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function num(v: string | string[] | undefined): number | undefined {
  const s = first(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whitelists the follower-band URL token against the four real bands, same shape as
 * `numOrAny` below: `"any"` (the explicit "show everything" token filter-bar.tsx's band
 * row writes) and any garbage value both resolve to `undefined`, "no condition" — never
 * a bare `first()` + type-assertion, which let `band=any` reach
 * `FOLLOWER_BAND_BOUNDS["any"]` (undefined) and throw when `buildWhere` destructured it
 * (finding C1, docs/qa branch review). `/feed?band=nope` is now equally harmless.
 */
export function bandOrAny(v: string | string[] | undefined): FollowerBand | undefined {
  const s = first(v);
  return s !== undefined && (FOLLOWER_BANDS as readonly string[]).includes(s) ? (s as FollowerBand) : undefined;
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
  // `""` counts as absent too (M6, branch review): a hand-typed `/feed?minScore=` has
  // no real value to resolve, so treating the bare key as "the user set a filter" would
  // read as intent while `numOrAny("")` above resolves the empty string to `undefined`
  // anyway (`num("")` short-circuits on `!s`) — Balanced should still apply.
  return FILTER_PARAM_KEYS.every((k) => sp[k] === undefined || sp[k] === "");
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

/**
 * What a chip's Select should show: the URL's own token if the URL has one, else what
 * the page actually filtered by (`applied`, from `resolveFeedCriteria`) — a bare `/feed`
 * visit applies "Balanced" server-side, so reading the URL alone would show "Any score"
 * while a minimum of 5 was hiding most of the library. `null` (the applied value's "no
 * condition" spelling) reads as `"any"`, same token the Select options use.
 *
 * Extracted from `filter-bar.tsx` (finding 3 / I3, branch review) so the fallback logic
 * is unit-testable without mounting the component.
 */
export function resolveChipValue(urlValue: string | null, appliedValue: number | null): string {
  if (urlValue !== null) return urlValue;
  return appliedValue !== null ? String(appliedValue) : "any";
}

/**
 * What "save this as a view" would persist for the three criteria-bearing chips, given
 * their already-resolved (`resolveChipValue`) display values. `"any"` is omitted rather
 * than saved as a value, the same way a system preset omits a key it doesn't constrain —
 * `Number("any")` is `NaN` and must never land in a saved view's criteria blob.
 *
 * Extracted from `filter-bar.tsx` (finding 3 / I3, branch review) alongside
 * `resolveChipValue` so both halves of the NaN-hazard fix are unit-tested together.
 */
export function currentViewCriteria(minScore: string, minViews: string, since: string): Record<string, unknown> {
  const criteria: Record<string, unknown> = {};
  if (minScore !== "any") criteria.minScore = Number(minScore);
  if (minViews !== "any") criteria.minViews = Number(minViews);
  if (since !== "any") criteria.sinceDays = Number(since);
  return criteria;
}
