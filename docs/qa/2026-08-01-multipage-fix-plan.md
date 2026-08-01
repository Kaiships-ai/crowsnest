# Multipage fix plan, 2026-08-01

Fixes for the four live-confirmed bugs from the per-page deep test plans
(video-detail, vault x2, settings). Each root cause is verified in code. No code
changed yet. Grouped so the four land in mostly separate files.

## 1. Video detail: prev/next and the index label ignore the active feed filter

Live symptom: from a feed filtered to 1 result, the detail page reads "1 of 42"
and "next" lands on a post outside the filter.

Root cause, two halves:
- The only click path into the detail page does not forward the feed's filter
  query. `src/components/feed/quick-preview-sheet.tsx:111` links to
  `/feed/${videoId}` with no query string, and the card's own links
  (`src/components/feed/outlier-card.tsx`) do the same. So the detail page loads
  with empty searchParams.
- The detail page builds prev/next from its own searchParams via
  `resolveFeedNav` (`src/app/(shell)/feed/[videoId]/page.tsx:64`), which calls
  `getOutlierFeed(buildFeedFilters(sp))`. `buildFeedFilters` (page.tsx:49) has
  its own param logic and does NOT use the shared `resolveFeedCriteria` from
  `src/lib/feed-filters.ts`, so an empty sp resolves to no filter, the full 42.

Fix (two coordinated parts):
- Forward the feed's active query string into the detail and remix hrefs. Thread
  the current feed searchParams (as a `?...` suffix) from `FeedGrid` /
  `FilterBar` down to `OutlierCard` and `QuickPreviewSheet`, and append it to the
  `/feed/[id]` and `/feed/[id]/remix` links. The feed already has the query in
  the URL, so read it there and pass a `hrefSuffix` prop.
- Make the detail page resolve filters the same way the feed does. Replace
  `buildFeedFilters` (page.tsx:49) with `resolveFeedCriteria` from
  `src/lib/feed-filters.ts` (the already-fixed shared logic), so a forwarded
  query resolves identically and a bare detail URL applies the same Balanced
  default the feed applies. Reuse `FILTER_PARAM_KEYS` for the `?...` suffix build
  so cosmetic params are not carried.

Test first:
- Unit-test the nav resolution: given a filtered searchParams object,
  `resolveFeedNav` (or the extracted filter build) returns items scoped to the
  filter, and the index label total matches the filtered count, not the library
  total. Given a bare searchParams, it applies Balanced.
- Browser confirm after: from a 1-result feed, open the card, label reads "1 of
  1", next is null.

Files: `feed/[videoId]/page.tsx`, `components/feed/quick-preview-sheet.tsx`,
`components/feed/outlier-card.tsx`, `components/feed/feed-grid.tsx`,
`src/lib/feed-filters.ts` (reuse only). Risk: medium, it threads a prop through
three components and swaps the detail page onto shared logic. Watch that the
back link and remix link keep working.

## 2. Vault: header says "Nothing saved yet" while other tabs have content

Live symptom: the Vault header reads "Nothing saved yet." on the Scripts (1),
Hooks (3), and Styles (3) tabs, because it only looks at saved posts.

Root cause: `src/app/(shell)/vault/page.tsx:88-94` derives the header line from
`savedPosts.length` alone. "Nothing saved yet." fires whenever saved posts is
empty, regardless of scripts, hooks, and styles.

Fix: the "Nothing saved yet." copy should describe the whole vault. Show it only
when saved posts AND scripts AND hooks AND styles are all empty. When saved posts
is 0 but other categories have content, show the saved-posts count plainly (for
example "0 saved posts") so the header does not claim the vault is empty. The
header line is about saved posts, so keep the count wording; only the
whole-vault-empty sentence is gated on everything being empty.

Test first: unit or render test on the header-copy derivation: (savedPosts 0,
scripts 1) yields the count line, not "Nothing saved yet."; (all 0) yields
"Nothing saved yet."

Files: `src/app/(shell)/vault/page.tsx`. Risk: low, one derivation.

## 3. Vault: empty-state "top outlier" link points at a null-scored recent post

Live symptom: the empty-state "Open the top outlier" link resolves to a
null-scored @nateherkai post from 4 days ago, not @kallaway's 10.1x post.

Root cause: `vault/page.tsx:83` uses `getTopOutliersToday(1)`.
`getTopOutliersToday` (`src/server/queries/dashboard.ts:106`) is scoped to the
last 7 days ("today's top") and its ORDER BY puts non-null scores first but still
returns a row even when every in-window post is null-scored. The real top outlier
is 23 days old, outside the window, so the link targets a recent unscored post.

Fix: the Vault empty state wants a real outlier to browse, not "today's top".
Either (a) query the highest-scored post all-time with a non-null score (a small
`getTopOutlierAllTime()` or a `sinceDays`-less variant that filters
`outlierScore IS NOT NULL`), or (b) if no scored post exists, fall back to
linking at `/feed` rather than a specific post. Prefer (a), and guard: only
render the deep link when the returned item has a non-null score, else link to
`/feed`.

Test first: unit-test the query returns the all-time top non-null-scored post
against the current DB (expect @kallaway's 10.1x id), and returns nothing/link-to-feed
when no scored post exists.

Files: `src/app/(shell)/vault/page.tsx`, `src/server/queries/dashboard.ts` (add
the all-time variant, do not change `getTopOutliersToday` which the Dashboard
still uses for its own 7-day row). Risk: low to medium, a new query plus a guard.

## 4. Settings: a sessionid-only Instagram login shows "No credentials configured"

Symptom (masked in this dev env because both IG_USERNAME and IG_PASSWORD are
set, real for a user who used the recommended sessionid flow): the Instagram
panel reads "No Instagram credentials configured" even though a live session
exists.

Root cause: `viewStateOf` in
`src/components/settings/instagram-section.tsx` checks
`if (!statusResult.status.credentialsConfigured) return "no_credentials"` before
`if (!statusResult.status.loggedIn) return "logged_out"`. A sessionid-only login
has `loggedIn` true but `credentialsConfigured` false (no username/password
stored), so it returns "no_credentials" and never reaches "connected".

Fix: check the live session first. A logged-in session is connected regardless of
whether username and password are also stored:

```
if (statusResult.status.loggedIn) return "connected";
if (!statusResult.status.credentialsConfigured) return "no_credentials";
return "logged_out";
```

Test first: unit-test `viewStateOf`: (loggedIn true, credentialsConfigured false)
returns "connected"; (loggedIn false, credentialsConfigured false) returns
"no_credentials"; (loggedIn false, credentialsConfigured true) returns
"logged_out". Keep the service-down and challenge branches unchanged.

Files: `src/components/settings/instagram-section.tsx`. Risk: low, one reorder,
covered by the new unit test.

## Sequencing and parallelization

Files barely overlap, so three of the four can run in parallel:
- Agent A: fix 1 (video-detail prev/next). Touches the feed card/grid/preview and
  the detail page.
- Agent B: fixes 2 and 3 (both in vault/page.tsx, plus a query in dashboard.ts).
- Agent C: fix 4 (settings instagram-section.tsx).

Only shared file risk: fix 1 reuses `src/lib/feed-filters.ts` read-only (no edit
needed there beyond possibly exporting a helper). Keep any feed-filters export
change in Agent A's scope so B and C never touch it.

Each fix is test-first, then `npx tsc --noEmit` and `npx vitest run` must stay
green. Then a whole-branch review, same as the feed round.
