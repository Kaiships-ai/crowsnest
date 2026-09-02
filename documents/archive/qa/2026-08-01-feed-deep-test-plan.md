# Feed page deep test plan, 2026-08-01

Follow-up to `2026-08-01-smoke-test-plan-stepwise.md` TC-Feed-1, which passed
on the surface but hid a real question: why does a bare `/feed` visit show 1
result out of about 42 synced posts. Root cause, confirmed by reading the
code, not guessed:

- A param-less `/feed` visit is not unfiltered. `isEmpty` in
  `src/app/(shell)/feed/page.tsx:35` fires on zero URL params and silently
  substitutes the seeded system preset "Balanced"
  (`src/server/db/bootstrap.ts:16`): `minScore: 5, sinceDays: 30`.
- `src/server/queries/feed.ts:158` turns that into
  `gte(tables.videos.outlierScore, 5)`. SQL `NULL >= 5` is never true, so a
  post with no score yet is dropped the same as a post that scored 2x.
- A channel needs `scoreMinUsablePosts` (5, `src/server/settings/index.ts:144`)
  posts with usable view counts before it gets any real score
  (`src/server/services/outlier-calc.ts:120`). Only @kallaway (8 posts)
  clears that bar. @nateherkai and @kaiships.ai post scores are all NULL and
  get filtered out regardless of view count, which is why the Channels table
  showed dashes for their median views in the earlier smoke run.
- Of @kallaway's 8 scored posts, one clears 5x within the 30 day window. That
  is the "1 result."

This plan tests that chain plus 11 other candidates for silent bugs found
during the same code read, all in `src/app/(shell)/feed/page.tsx`,
`src/server/queries/feed.ts`, `src/server/queries/channels.ts`,
`src/components/feed/filter-bar.tsx`, and `src/server/settings/index.ts`.

Every case is read-only against `http://localhost:3000`. No sync trigger, no
LLM spend, no write. Cases that need a state a fresh dev server will not have
(a fifth tracked channel, a channel with exactly 5 usable posts) are marked
"needs fixture" and get a code-reading verdict instead of a browser run.

## A. Default filter (the reported symptom)

### TC-FD-A1: Bare /feed is not actually unfiltered
Steps:
1. Go to `/feed` with no query string.
Expected: filter bar reads "5x+" and "Last 30d", not "Any score" / "Any
timeframe". The applied filter is visible in the chips even though the URL
carries no params.

### TC-FD-A2: Any single param drops the Balanced preset entirely
Steps:
1. Go to `/feed?view=list` (a param unrelated to scoring).
Expected: per `isEmpty = Object.keys(sp).length === 0`, adding `view=list`
alone makes `isEmpty` false, so `minScore` and `sinceDays` fall back to
`num(sp.minScore)` / `num(sp.sinceDays)` with no value present, i.e. no
score or timeframe filter at all. Result count should jump from 1 to the
full synced set (about 42), and the filter bar should read "Any score" /
"Any timeframe" while the URL still shows nothing about score. If the count
does not jump, the fallback default is not what the code implies and the
finding needs revising.

### TC-FD-A3: Explicit ?minScore=5&sinceDays=30 matches the bare-URL result
Steps:
1. Go to `/feed?minScore=5&sinceDays=30`.
Expected: same single result as TC-FD-A1, proving the Balanced preset really
is `{5, 30}` and not some other seeded value.

### TC-FD-A4: Clearing filters from the zero-result state returns to Balanced, not to Any
Steps:
1. Go to `/feed?minScore=20` (zero results, per the prior smoke run).
2. Click "Clear filters".
Expected note both outcomes as informative, not a hard pass/fail: does
"Clear filters" reset to the Balanced preset (1 result) or to Any score
(about 42 results)? The prior smoke run (TC-Feed-6) observed Clear
search/filters landing on Any score. If Clear filters also lands on Any
score rather than Balanced, that is a UX inconsistency worth flagging:
the zero-param URL and the "cleared" URL show different result sets for what
a user would call the same "no filter" state.

## B. Score computed as NULL vs scored-low (the SQL NULL trap)

### TC-FD-B1: A channel below the usable-posts floor never appears at any score threshold
Steps:
1. Go to `/feed?minScore=0` (lowest selectable score, per the filter bar
   showing 2x/5x/10x/20x as the floor options plus "Any score").
2. Read the result list and note which channels appear.
Expected: if "Any score" and "2x+" both exist as distinct filter bar options
but @nateherkai and @kaiships.ai posts never appear at either setting, that
confirms NULL-scored posts are excluded even from the loosest score filter,
not merely low-ranked. Compare against `/feed?minScore=0` explicitly to see
whether "Any score" is implemented as "score >= 0" (which still excludes
NULL) or as "no score filter at all" (which would include them). This is the
single highest-value check in this plan: it tells us whether "Any score"
actually means any score.

### TC-FD-B2: Any score view shows unscored posts distinctly, or not at all
Steps:
1. From the "Any score" state (TC-FD-B1), open a card from @nateherkai or
   @kaiships.ai if one is visible.
Expected: either (a) no such card is visible, confirming B1's NULL-exclusion
finding, in which case this is a silent bug: a user picking the loosest
possible filter still cannot find posts from 2 of their 3 tracked channels
with no explanation why, or (b) the card is visible and shows some "not yet
scored" affordance rather than a fabricated score.

## C. Feed vs Channels threshold parity

### TC-FD-C1: Feed's 5x default and the Channels "Outliers (30d)" column use different thresholds
Steps:
1. Go to `/feed` (bare, 1 result, @kallaway's 10.1x post).
2. Go to `/channels` and read the "Outliers (30d)" count for @kallaway.
Expected: `src/server/queries/channels.ts` hardcodes
`OUTLIERS_30D_MIN_SCORE = 2`, independent of the feed's 5x default. The
smoke run recorded @kallaway's Outliers (30d) as 2. If Feed's bare view
shows 1 post but Channels says @kallaway has 2 outliers in the same 30 day
window, that is a real, user-visible inconsistency: the same word
"outlier" means two different score cutoffs on two different pages with no
label telling the user which cutoff applies where.

## D. Settings wiring

### TC-FD-D1: Feed defaults section in Settings does not affect the feed
Steps:
1. Go to `/settings#feed-defaults`, read the current value shown for default
   minimum score / follower band, without changing anything.
2. Go to `/feed` (bare).
Expected note: per the code read, `feedDefaultMinScore` and
`feedDefaultFollowerBand` in `src/server/settings/index.ts:51-56` are marked
`WIRED: false`. This case is a read-only confirmation that the Settings UI
displays a value that has no effect: the number shown in Settings should not
match what actually renders on Feed unless the hardcoded Balanced preset
(5, 30d) happens to coincide with it. Do not change the setting (that would
be a write / side effect); only compare the displayed value against observed
Feed behavior from section A.

## E. Sort stability and pagination

### TC-FD-E1: Sort by score is stable across repeated loads
Steps:
1. Go to `/feed?minScore=0&sort=score` twice in a row (two separate goto
   calls), record card order both times.
Expected: with only 1-2 scored posts in the fixture data this case is likely
inconclusive (not enough ties to expose instability), so treat a pass here
as "no evidence of a bug," not "confirmed no bug." Flag as needs-fixture:
this needs a dataset with two or more posts sharing the same outlier score
to actually exercise `src/server/queries/feed.ts:186-198`'s missing
secondary tiebreaker.

### TC-FD-E2: Load more does not reshuffle already-rendered cards
Steps:
1. Go to `/feed?minScore=0` (the widest available set, likely still small in
   this fixture).
2. If a "Load more" control is present, click it once and diff the card
   order before and after.
Expected: needs-fixture if the current result count fits on one page (no
Load more control rendered at all). If present: existing cards keep their
order and position after Load more, since `page.tsx:87` re-fetches from
offset 0 with a larger limit rather than paging forward, which is safe only
if sort order is stable (ties back to E1).

## F. isEmpty / URL param interaction

### TC-FD-F1: Toggling density alone silently drops the score filter
Steps:
1. From bare `/feed` (1 result), click "Compact density".
Expected: URL gains a density-related param, `isEmpty` goes false, and per
the code the score/timeframe filter silently reverts to none. Result count
should jump to the full set. This is the same mechanism as TC-FD-A2 but
triggered by a UI control a user would not expect to touch filtering at
all: switching card density looks purely cosmetic.

### TC-FD-F2: Toggling density back does not restore the Balanced filter
Steps:
1. From the state after TC-FD-F1, click "Comfortable density" to toggle
   back.
Expected: since density is now a URL param either way, `isEmpty` stays
false and the result count should remain the full set, not snap back to 1.
If it does snap back to 1, the isEmpty logic is more nuanced than the code
read suggested and the earlier finding needs revising.

## G. Search interaction with the default filter

### TC-FD-G1: Searching from the bare state also silently clears the score filter
Steps:
1. From bare `/feed` (1 result), type a broad term matching many posts (for
   example "ChatGPT", visible in the one known caption) and press Enter.
Expected: `q=` is a URL param, so per the isEmpty logic the score/timeframe
filter should also drop here, same mechanism as F1. Confirm whether search
results are scoped by the Balanced preset or not: does the match count look
like it is drawn from 1 candidate post or from the full ~42.

### TC-FD-G2: Search debounce race against back navigation
Steps:
1. On `/feed`, type a search term (do not press Enter), then immediately
   press the browser Back button before the 350ms debounce fires.
Expected: needs a tight timing window that browser automation may not
reproduce reliably. Best-effort check: after Back, confirm the URL and
result set reflect the pre-search state, not a half-written search param
from the debounced write firing after navigation. Mark inconclusive if
timing cannot be controlled precisely enough to trust either outcome.

## H. Follower band boundaries

### TC-FD-H1: Follower band buttons reflect real per-band counts
Steps:
1. On `/feed` (any filter state), read the counts next to Nano / Micro /
   Mid / Macro in the filter bar.
2. Cross check against `/channels`: @kallaway 443.5K followers (Macro is
   defined as 1M+, so expect Mid: 100K-1M), @nateherkai 282.4K (Mid),
   @kaiships.ai 5 followers (Nano).
Expected: earlier smoke run recorded Mid 100K-1M as 1 and all others 0,
which only accounts for @kallaway. Confirm whether the follower-band counts
reflect post counts or channel counts, and whether @nateherkai's 282.4K
(also Mid band) is represented. If Mid shows 1 and not 2, that is consistent
with the NULL-score exclusion from section B leaking into a UI element
(band counts) that a user would expect to reflect all tracked channels
regardless of score.

## Non-browser findings carried over for the record

These came out of the same code read but are not independently exercisable
through the UI without new fixture data. Listed here so they are not lost,
not scored pass/fail:

- `src/server/services/outlier-calc.ts:120` boundary: exactly `minUsable`
  (5) usable posts is accepted. Needs a channel fixture with 4, 5, and 6
  usable posts to test the boundary directly.
- Settings > Scoring copy says "about 10" posts for a meaningful median,
  while the actual gate in code is 5. These two numbers live in different
  files (`channel-table.tsx` copy vs `outlier-calc.ts` / `settings/index.ts`
  logic) and nothing keeps them in sync.
- `src/server/queries/feed.ts:169-187`: the fleet-membership subquery for
  `getOutlierFeed` and `getFeedBandCounts` runs twice per request with no
  shared snapshot. Only observable under concurrent fleet edits mid-request,
  not reproducible with a single-user manual smoke pass.

## Results, run against localhost:3000 on 2026-08-01

### A. Default filter
- TC-FD-A1 PASS. Bare `/feed` shows "5x+" and "Last 30d" chips, 1 result.
- TC-FD-A2 PASS (confirms the bug). `/feed?view=list` shows "Any score" and
  jumps to 42 results, but the Timeframe chip still reads "Last 30d." See
  the new finding below: the chip is wrong, not the count.
- TC-FD-A3 PASS. `/feed?minScore=5&since=30` reproduces the bare-URL result
  exactly (1 result), confirming Balanced is minScore 5, since 30. Note
  the real query param is `since`, not `sinceDays` (that is the criteria
  key name, `sinceDays` never appears in a URL).
- TC-FD-A4: not an inconsistency. "Clear filters" always navigates to a
  truly bare `/feed`, which correctly re-triggers Balanced (1 result). Any
  earlier appearance of a mismatch in this session was a leftover `view=`
  param from a prior step, not a Clear filters bug.

New finding, TC-FD-A5, most severe: `filter-bar.tsx:184` shows the
Timeframe select defaulting to "30" whenever the URL has no `since` param,
even when the server-applied filter genuinely has no timeframe constraint.
The displayed chip does not reflect the query that ran. A user reading
"Last 30d" after landing on `?view=list` would reasonably but wrongly
conclude the 42 results are date bounded.

New finding, TC-FD-A6, most severe, supersedes the original B1/B2 plan:
there is no way to click through the UI to escape the default 1-result
view. From bare `/feed`, opening the score combobox and clicking "Any
score" calls `set("minScore", "any")`, which deletes the (absent) param and
calls `router.replace` with an empty query string. `Object.keys(sp).length
=== 0` is still true on an empty query string, so `isEmpty` stays true and
Balanced silently reapplies on the very next render. Verified live: URL
stays `/feed`, result count stays at 1, screenshot confirms the chip
snaps back to "5x+." The only way out is to first touch an unrelated
control (density, list view) that happens to leave a stray param in the
URL. That is not something a user exploring "Any score" would think to do.

### B. NULL score vs scored-low
- TC-FD-B1, revised: `minScore=0` returns 8 results, all from @kallaway
  only. `?since=9999` with no `minScore` param at all (the only way to
  truly remove the filter) returns all 42, across all 3 channels. So
  `gte(outlierScore, 0)` and "no score filter" are not equivalent, exactly
  per the NULL-trap prediction, and the UI's "Any score" option is meant to
  produce the second case but, per A6, usually cannot reach it.
- TC-FD-B2 PASS: unscored posts render with a plain dash character for
  score, views, and engagement, not a fabricated number. Confirmed by
  screenshot. This part of the rendering is safe.

### C. Feed vs Channels threshold parity
- TC-FD-C1 confirmed. Channels shows @kallaway with 2 "Outliers (30d)"
  (hardcoded `OUTLIERS_30D_MIN_SCORE = 2` in `channels.ts:59`). Feed's own
  default view, labeled "Outlier Feed," shows only 1, because its default
  is 5x. Same word, two silently different cutoffs, no page explains either
  number to the user.

### D. Settings wiring
- TC-FD-D1: not a silent bug. The Feed defaults section in Settings
  explicitly says: "Not read yet. A bare visit to the feed opens on the
  Balanced preset, a minimum score of 5 over 30 days, not on this number."
  Honestly labeled, does not need a test case flag.

### E. Sort stability and pagination
- Not run: needs-fixture as planned. Current dataset does not have enough
  same-score ties or a result count past the 24-item default limit under
  score sort to exercise this safely. Left as a documented gap.

### F. isEmpty / URL param interaction
- TC-FD-F1 confirmed. Clicking "Compact density" from bare `/feed` (purely
  cosmetic control) adds `?density=compact` and the result count jumps
  from 1 to 42. No visual cue ties a density toggle to filtering.
- TC-FD-F2 PASS. Toggling back to "Comfortable density" keeps
  `?density=comfortable` in the URL and the count stays at 42. It does not
  snap back to Balanced, confirming the one-way nature of the isEmpty trap.

### G. Search interaction
- TC-FD-G1 confirmed. Searching "ChatGPT" from bare `/feed` adds `?q=`,
  drops the score filter the same way, and returns 5 results (matches
  across all channels) instead of a 5x and 30 day scoped search.
- TC-FD-G2: not run. Debounce versus back navigation timing is not
  reliably controllable through browser automation, left as a manual only
  check.

### H. Follower band boundaries
- TC-FD-H1: not an independent bug. Under the genuinely unfiltered
  `since=9999` view, band counts correctly show Nano 9 (@kaiships.ai) and
  Mid 33 (@kallaway 10 plus @nateherkai 23), matching real channel follower
  counts. The earlier "only Mid: 1" reading under the default view was the
  same NULL-score exclusion from section B propagating downstream, not a
  separate bug in the band-count logic itself.

## Verdict

One symptom, one shared root cause, three distinct manifestations, plus one
unrelated but real inconsistency.

1. `isEmpty` in `page.tsx:35` treats any URL param at all, not any filter
   param, as proof the user has expressed intent. A cosmetic control
   (density) or an unrelated action (search) silently discards the score
   and timeframe filter as a side effect.
2. The reverse trap is worse: deliberately clearing the score filter via
   the UI's own "Any score" control fails silently, because deleting the
   last param collapses the URL back to the same empty state that
   triggers the preset in the first place. There is no working "show me
   everything" button reachable from the default landing page.
3. The Timeframe chip's client-side display fallback (30) is decoupled
   from the server-side filter it claims to represent, so the chip can
   misstate what is actually filtering the results.
4. Independent of all of the above: Feed and Channels use different,
   unlabeled score cutoffs, 5x versus 2x, for the same word, "outlier."

Everything here is read-only. No fix applied, no data written, no sync or
generation triggered during this test pass.
