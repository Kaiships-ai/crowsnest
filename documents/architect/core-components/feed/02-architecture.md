# feed: architecture

## Key files

- `src/app/(shell)/feed/page.tsx`: the feed page itself, an async server component. Resolves
  the slice from `searchParams`, decides whether to apply the default view, runs the two
  reads (the page of videos and the band counts) in parallel, and renders one of four empty
  states or the grid plus Load more.
- `src/lib/feed-filters.ts`: the pure `searchParams -> criteria` layer, imported by both the
  server page and the client filter bar so "a filter param is present" has one definition.
  Owns `FILTER_PARAM_KEYS`, `shouldApplyDefaultView`, `resolveFeedCriteria`, the `*OrAny`
  token parsers, and `filterQuerySuffix` (the query suffix a card forwards into detail/remix).
- `src/server/queries/feed.ts`: the DB layer. `getOutlierFeed` (items plus the true slice
  total), `getFeedBandCounts`, `getSavedFilters`, and the shared `feedItemColumns` /
  `toFeedItem` that derive `engagementRate` and the `deleted` flag once, so the card and the
  detail page never compute two different numbers.
- `src/components/feed/`: the client surface — `filter-bar.tsx`, `feed-grid.tsx`,
  `outlier-card.tsx` / `outlier-badge.tsx`, `feed-list-row.tsx`, `quick-preview-sheet.tsx`,
  `manage-saved-views-dialog.tsx`, `video-thumb.tsx`.
- `src/server/queries/preview-action.ts`: the lazy, id-keyed server read the quick preview
  sheet calls when a card is clicked, so the feed never loads transcripts for every card.
- `src/app/(shell)/feed/[videoId]/page.tsx` + `src/components/video/video-detail.tsx`: the
  video detail page. `resolve-feed-nav.ts` beside it resolves the prev/next neighbours and
  the "N of Total" label against the same feed order.
- Actions reachable from the component: `src/server/actions/saved-view-actions.ts` (create /
  rename / delete a view), `saved-post-actions.ts` (keep this post), `vault-actions.ts` (save
  to vault). `src/server/db/bootstrap.ts:16-17` seeds the two built-in views.

## Data flow

**Arrive.** `FeedPage` awaits `searchParams`, then reads the fleets, saved filters, and
channel list in parallel (`page.tsx:19`). `shouldApplyDefaultView(sp)` decides whether this
is a bare visit: true unless a `FILTER_PARAM_KEYS` param is set or `?all=1` is present, so
cosmetic params (density, view, sort, limit) still count as bare. On a bare visit the
minScore/minViews/sinceDays come off the seeded **High Conviction** row's criteria rather
than a literal, so reseeding `bootstrap.ts` moves the default without touching the page.
Otherwise `resolveFeedCriteria(sp)` maps the URL to criteria as written, honoring an explicit
`key=any` as "no condition".

**Read.** The resolved `FeedFilters` go to `getOutlierFeed` (a `videos ⋈ channels` select,
ordered by `buildOrderBy`, limited to 24) and `getFeedBandCounts` at once (`page.tsx:58`).
`buildWhere` (`feed.ts:152`) assembles the conditions; it deliberately does **not** exclude
soft-removed (`deleted_at`) posts — they stay in results and carry the `deleted` flag so the
card can mark them "No longer on Instagram". `total` is the real slice size before paging and
drives both the results count and `hasMore`. Band counts are computed one band at a time
under every *other* active filter (`countForBand`), which is why the three need not sum to
the total.

**Empty states.** The page distinguishes four cases (`page.tsx:70-81`): no channels tracked,
channels but none ever synced (no baseline yet), a search that matched nothing, and a filter
slice that came back empty — each with its own copy and recovery link, so a default-view
empty state escapes via `?all=1` rather than looping back through a bare `/feed`.

**Filter bar.** `filter-bar.tsx` holds no result state: each control calls
`router.replace(..., { scroll: false })` to rewrite the URL, and the server page re-reads.
The search box debounces (~350ms) before rewriting. Using any filter drops `limit`, so a
narrowed feed restarts at page one. Saved-view create/rename/delete are the bar's only server
writes, through `saved-view-actions.ts`, each followed by `router.refresh()`.

**Card to detail.** `feed-grid.tsx` builds each card's href suffix from
`filterQuerySuffix(searchParamsFromEntries(searchParams.entries()))` — the same builder
`resolve-feed-nav.ts` uses server-side — so the detail page's prev/next resolve against the
same filtered, ordered set the card was clicked from. Clicking a card instead of following
its link sets a single `previewId` in `FeedGrid`; the quick preview sheet fetches that id's
detail lazily via `getVideoPreviewAction`.

**Keep and save.** On the detail page, `save-post-button.tsx` reads its kept/not-kept state
from the page's server load (a prop, not local state) and toggles it through
`saved-post-actions.ts` (one `savedPosts` row per video, refused if already saved), then a
refresh flips the label. Save to vault writes `vaultItems` rows through `vault-actions.ts`,
gated on the video having an analysis.

## Decisions

- **The slice lives entirely in the URL, not in React state.** A filter change, a sort, a
  density toggle, and Load more are all `router.replace`/navigations, so a feed is a
  bookmarkable link and browser history is the slice history. `feed-filters.ts` is the single
  shared definition of what counts as a filter, so the page and the bar can never drift on it.
- **The default view is data, not a literal.** A bare `/feed` applies the seeded High
  Conviction saved filter; changing the seed moves the default. `?all=1` is the explicit
  escape and is deliberately kept out of `FILTER_PARAM_KEYS` so it never rides a detail link.
- **Derived numbers computed in one place.** `toFeedItem` owns the engagement formula
  `(likes + comments) / views` and the `deleted` flag; the same SQL formula gates the
  engagement filter (`feed.ts:202`), so the filter and the shown number never disagree, and a
  null count is excluded rather than counted as zero.
- **Soft-removed posts are kept, not hidden.** Excluding `deleted_at` posts once made a
  formerly-outlier post unopenable; the feed now keeps them flagged so the history the tool
  exists to hold is never silently dropped.
- **The quick preview fetch is lazy and id-keyed.** The sheet loads one video's detail only on
  open, keyed to the opened card, so scrolling the feed with the sheet closed costs nothing.
- **`?key=any` is an explicit token, not an absent key.** It lets "explicitly no condition"
  stay distinct from "never set", which is what keeps a cleared control from re-triggering the
  default view on the next read.

## Known gaps

Tracked in [backlog to enhance](05-backlog-to-enhance.md): the caption overlay contrast
(OBS-1) and a hardcoded "1 results" plural (OBS-2); the quick preview has no error branch on a
failed server read, so a rejected fetch sticks on its placeholder bars (FEED-Q3, B-16); the
detail route's `notFound()` returns HTTP 200 rather than 404 (B-14); and Save to Vault's
"Both" path can half-write and duplicate on retry (B-05). The default-view logic also carries
historical churn between "full library" and "High Conviction" defaults (FEED-Q1) — the code as
shipped applies High Conviction on a bare visit.
