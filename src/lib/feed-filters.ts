/**
 * Shared between `feed/page.tsx` (server-side resolution) and `filter-bar.tsx` (client
 * controls), so the definition of "a filter param is present" cannot drift between the
 * two. See docs/qa/2026-08-01-feed-fix-plan.md, "Shared mechanism behind findings 1 and
 * 2" — before this existed, `filter-bar.tsx` had its own copy and `page.tsx` used a
 * coarser `Object.keys(sp).length === 0` check that also tripped on non-filter params
 * like `density`, `view`, `sort`, and `limit`.
 */
export const FILTER_PARAM_KEYS = ["fleet", "platform", "minScore", "minViews", "since", "band", "q"] as const;

/**
 * `sort` picks an order, not a slice — it must never join `FILTER_PARAM_KEYS`
 * (`isFeedEmpty` reads that list to decide whether Balanced applies; if `sort` counted
 * as a filter, `/feed?sort=recent` would stop being "bare" and Balanced would silently
 * stop applying, the exact bug fixed by `docs/qa/2026-08-01-feed-fix-plan.md` finding 1).
 * But a link that forwards the active feed state still needs to carry it: without it,
 * a detail page reached from a `sort=recent`-ordered feed resolved prev/next in score
 * order instead (whole-branch review, finding I1). Kept as its own list so
 * `filterQuerySuffix` can append it to the suffix without touching what counts as
 * "a filter" anywhere else.
 */
export const ORDER_PARAM_KEYS = ["sort"] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

// Same bands `FOLLOWER_BAND_BOUNDS` (server/queries/feed.ts) has keys for. Kept
// here, not imported from there, so this module (used by the client-side filter-bar.tsx
// too) never pulls in `@/server/db`. "micro" (10K-100K) was removed per the feed
// cleanup batch. Channels in that range now match no band chip; they still show under
// "Any followers", the same way a null-follower channel already does.
export const FOLLOWER_BANDS = ["nano", "mid", "macro"] as const;
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

/**
 * The `?...` suffix (or `""`) for links that should carry the active feed filter (and
 * order) forward — into `/feed/[id]` and `/feed/[id]/remix` from a card or the
 * quick-preview sheet, and into the detail page's own back/prev/next hrefs — without
 * carrying purely cosmetic params (`density`, `view`, `limit`) along too. Built from
 * `FILTER_PARAM_KEYS` plus `ORDER_PARAM_KEYS` so `feed-grid.tsx` (client, reading
 * `useSearchParams()`) and `feed/[videoId]/resolve-feed-nav.ts` (server, reading an
 * awaited `searchParams`) produce the identical suffix from the identical param list —
 * see the video-detail nav bug this fixes (docs/qa/2026-08-01-multipage-fix-plan.md,
 * finding 1): the only click path into the detail page wasn't forwarding the feed's
 * filter at all. `sort` (an `ORDER_PARAM_KEYS` member, not a `FILTER_PARAM_KEYS` one)
 * rides along too — a `sort=recent` feed's prev/next should walk that same order, not
 * silently reorder by score (whole-branch review, finding I1).
 */
export function filterQuerySuffix(sp: SearchParams): string {
  const qs = new URLSearchParams();
  for (const key of [...FILTER_PARAM_KEYS, ...ORDER_PARAM_KEYS]) {
    const v = first(sp[key]);
    if (v) qs.set(key, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Converts a `URLSearchParams` (or Next's `ReadonlyURLSearchParams`, which has the
 * same `.entries()` shape) into the plain-object `SearchParams` this module's helpers
 * expect, keeping the FIRST value of a repeated key — matching `first()`'s `v[0]`
 * semantics, which is what a Next.js server component sees for a repeated query
 * param. `Object.fromEntries(usp.entries())` gets this backwards (last value wins),
 * which let `feed-grid.tsx` build a card's hrefSuffix from a different value than the
 * one the server-rendered page had actually filtered by on a hand-typed
 * `/feed?minScore=5&minScore=9` (whole-branch review, finding M4).
 */
export function searchParamsFromEntries(entries: Iterable<[string, string]>): SearchParams {
  const sp: SearchParams = {};
  for (const [key, value] of entries) {
    if (!(key in sp)) sp[key] = value;
  }
  return sp;
}

/**
 * True when the URL carries no *filter* param at all — a bare `/feed` visit, which now
 * shows the full unfiltered library (no auto-applied default). Cosmetic params
 * (`density`, `view`, `sort`, `limit`) don't count as filters, so a density toggle alone
 * still reads as bare. Kept as a named predicate so "bare visit" has one definition.
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
 * A bare `/feed` visit now resolves to no criteria at all (the full raw library). The
 * "Balanced" saved filter stays user-selectable, it just no longer auto-applies on a bare
 * visit, so there is no default blob to thread in here anymore.
 */
export function resolveFeedCriteria(sp: SearchParams): ResolvedFeedCriteria {
  return {
    isEmpty: isFeedEmpty(sp),
    minScore: numOrAny(sp.minScore),
    minViews: numOrAny(sp.minViews),
    sinceDays: numOrAny(sp.since),
  };
}

/**
 * What a chip's Select should show: the URL's own token if the URL has one, else what
 * the page actually filtered by (`applied`, from `resolveFeedCriteria`). With the Balanced
 * auto-apply gone, `applied` mirrors the URL on a bare visit, so both fall to `"any"`
 * there — but the fallback is kept because it's the correct general rule and cheap. `null`
 * (the applied value's "no condition" spelling) reads as `"any"`, same token the Select
 * options use.
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
