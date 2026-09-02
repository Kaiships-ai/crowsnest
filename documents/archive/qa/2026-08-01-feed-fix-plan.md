# Feed filter fix plan, 2026-08-01

Fixes for the findings in `2026-08-01-feed-deep-test-plan.md`. Each root cause is
verified in the code, not inferred from the test run. No code is changed yet.
This is the plan to approve before implementation.

The four findings collapse into three code fixes plus one product decision.
Findings 1 and 2 share a mechanism and are fixed together.

## Shared mechanism behind findings 1 and 2

`src/app/(shell)/feed/page.tsx:35` decides whether to apply the seeded
"Balanced" preset (minScore 5, sinceDays 30) with:

```
const isEmpty = Object.keys(sp).length === 0;
```

Two consequences fall out of "any URL key at all counts as user intent":

- Finding 1 (cosmetic controls drop the filter): `density`, `view`, `sort`, and
  `limit` are not filters, but each puts a key in the URL, so `isEmpty` goes
  false and the score/timeframe filter silently reverts to none. Confirmed live:
  `/feed?density=compact` jumps from 1 result to 42.
- Finding 2 (no reachable "show everything"): `filter-bar.tsx:150-151` clears a
  select by deleting its param. From a bare `/feed`, choosing "Any score"
  deletes the absent `minScore`, leaves an empty query string, and `isEmpty`
  is true again, so Balanced reapplies on the next render. The chip snaps back
  to "5x+". The only escape today is to also leave a stray non-filter param in
  the URL, which no user would think to do.

The filter set is already named once, in `filter-bar.tsx:86`:
`FILTER_PARAM_KEYS = ["fleet", "platform", "minScore", "minViews", "since", "band", "q"]`.

### Fix 1a: base isEmpty on filter params only

Change `page.tsx` so the Balanced preset applies only when no filter param is
present, not when no param at all is present.

```
const FILTER_PARAM_KEYS = ["fleet", "platform", "minScore", "minViews", "since", "band", "q"];
const isEmpty = FILTER_PARAM_KEYS.every((k) => sp[k] === undefined);
```

Export `FILTER_PARAM_KEYS` from one module and import it in both `page.tsx` and
`filter-bar.tsx` so the list cannot drift. After this, a density or view toggle
keeps the Balanced default.

### Fix 1b: make "unfiltered" representable so "Any score" sticks

Deleting the param cannot be distinguished from a bare visit. Give the cleared
state an explicit URL token instead of an absence.

- `filter-bar.tsx` `set(key, "any")`: write `key=any` in the URL rather than
  deleting the key, for the score, views, timeframe, and follower selects. Keep
  the search box deleting `q` when emptied (a blank search is genuinely absent,
  and "any" is a legal search term per the existing comment at line 134).
- `page.tsx` parsing: treat the literal `any` as "filter explicitly off" (value
  undefined at the query layer) rather than `num("any")` which is `NaN`. Add an
  `numOrAny` helper: returns `undefined` for `"any"`, else `num(v)`.
- `feed.ts` already treats `undefined` as "no condition" (`if (f.minScore !== undefined)`
  at line 158), so no query change is needed.

Result: choosing "Any score" writes `/feed?minScore=any`, which is a filter
param, so `isEmpty` is false, Balanced does not reapply, and the query runs with
no score condition (NULL-scored posts included). The state sticks in the URL and
survives reload.

### Test first (findings 1 and 2)

Add a test file for the feed filter resolution, testing the pure
`searchParams -> FeedFilters` mapping (extract that mapping into a testable
function if it is not already one):

- bare `{}` resolves to Balanced (minScore 5, sinceDays 30).
- `{ density: "compact" }` still resolves to Balanced (finding 1).
- `{ minScore: "any" }` resolves to minScore undefined, and isEmpty false
  (finding 2).
- `{ minScore: "2" }` resolves to minScore 2, Balanced not applied.

Browser reproduction after the fix: `/feed?density=compact` shows 1 result;
clicking "Any score" from bare `/feed` shows 42 and the URL becomes
`/feed?minScore=any`.

Risk: low. The mapping is small and the change is additive (a coarser predicate
becomes a precise one; deletion becomes an explicit token). Watch that saved
filters and the "Clear filters" path still resolve to a bare URL that correctly
re-triggers Balanced.

## Finding 3: timeframe chip misstates the applied filter

`src/components/feed/filter-bar.tsx:184`:

```
const since = searchParams.get("since") ?? (applied.sinceDays !== null ? String(applied.sinceDays) : "30");
```

The `minScore` line just above (182) falls back to `"any"` when the applied
value is null. The `since` line falls back to `"30"` instead, so with no
timeframe filter actually applied the chip still shows "Last 30d".

### Fix 3

Change the fallback to match the score line:

```
const since = searchParams.get("since") ?? (applied.sinceDays !== null ? String(applied.sinceDays) : "any");
```

### Test first (finding 3)

Component or unit test on the chip resolution: given
`applied.sinceDays = null` and no `since` param, the timeframe select shows
"Any timeframe", not "Last 30d". Given `applied.sinceDays = 30`, it shows
"Last 30d".

Risk: very low, one line, symmetrical with the existing minScore behavior.

## Finding 4: Feed and Channels use different cutoffs for "outlier"

Not a code bug, a product decision. `channels.ts:59` counts "Outliers (30d)" at
score >= 2, while the Feed's Balanced default shows score >= 5. Both are labeled
with the word "outlier" and neither page states its cutoff, so @kallaway reads
as 1 on Feed and 2 on Channels for the same window.

Two coherent resolutions, pick one:

- Option A (align the numbers): define "outlier" as one threshold in a shared
  constant (2x is the scoring definition of an outlier; 5x is a curation
  default). Keep the feed's 5x as an explicitly labeled "high conviction"
  default rather than calling it the outlier count. The Channels column stays
  at the shared outlier threshold.
- Option B (label the numbers): leave both cutoffs, but surface each on its page
  (a tooltip or sublabel: "Outliers (2x+, 30d)" on Channels, and the Feed chip
  already says "5x+"). Cheapest, no logic change.

Recommendation: Option B now (labeling removes the confusion with no behavior
change), and treat Option A as a separate scoring-model decision. This one does
not block findings 1 to 3 and should ship on its own.

## Sequencing

1. Fixes 1a and 1b together (coupled), with the mapping test. This is the
   highest-value change: it restores a working "show everything" and stops
   cosmetic controls from silently changing what the user sees.
2. Fix 3 (one line, own test). Independent, can land in the same or a separate
   change.
3. Finding 4: decide Option A vs B with the product owner. Label-only (B) is a
   small follow-up.

## Out of scope for this plan

- The NULL vs zero score behavior (`gte(outlierScore, 0)` excludes NULL) is
  correct: an unscored post is not a zero-score post, and unscored posts should
  not rank as outliers. Fix 1b makes the genuinely unfiltered view reachable,
  which is the real gap.
- Sort tiebreaker and Load-more reshuffle (deep-test section E) need fixture
  data with score ties and more than 24 results. Left as a documented gap until
  that fixture exists.
- The Settings "about 10 posts" copy vs the code's 5-post gate is a copy fix
  tracked in the deep-test carryover notes, not part of the filter logic.
