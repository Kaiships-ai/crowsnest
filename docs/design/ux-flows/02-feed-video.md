# Feed and video flows

Scope: group C (the outlier feed: browsing, filtering, saved presets, quick preview, and the
empty, loading and unscorable states) and group D (the video page: detail, playback, analysis
including the new visual frame pass, pattern similarity, the Vault, and copy as prompt). Ten
flows, C1 to C4 and D1 to D6. Everything under "Screen", "Actions" and "System" describes the
code as it exists in this repo today unless a line says the behaviour is proposed. Proposed
behaviour appears only where the settled decision on visual analysis requires it, and it is
labelled.

Two conventions. First, real UI strings in this repo contain em dashes; the repo doc rule
forbids them in markdown, so quoted copy here renders those as a plain hyphen. The string in
the code is the authority. Second, the outlier badge renders with a multiplication sign
(`formatMultiplier` gives "10.1x" with the real glyph); prose here writes "10.1x".

Current data state that these flows were checked against: 8 videos, all from `@kallaway`
(442,447 followers), all 8 have a thumbnail asset, 0 have a downloaded video asset, top
outlier score 10.1x, 1 transcript row, 1 video_analyses row, 6 vault items, 2 saved filters.
A second channel `@hormozi` is tracked with 0 posts and a null follower count.

---

### C1. Browse outliers, filter and sort

**Entry.** Sidebar link to `/feed`, the command menu (Cmd+K), the Dashboard, a "Clear filters"
link from the filtered-empty state, or a "Load more" link that reloads `/feed` with a larger
`limit`. Every filter lives in the URL query string, so a bookmarked or pasted URL restores
the exact view.

**Screen.** Top to bottom:

1. Topbar (`components/layout/topbar.tsx`) renders the h1 "Outlier Feed" from `ROUTE_TITLES`,
   plus the Cmd+K search button. The page itself deliberately starts at h2 or plain text.
2. `FilterBar` (`components/feed/filter-bar.tsx`), sticky at the top of the scroll area with a
   background blur. Left to right: Fleet select ("All channels" plus one row per fleet),
   Platform toggle group (All, IG, TikTok, YT Shorts), Minimum outlier score select (Any score,
   2x+, 5x+, 10x+, 20x+), Minimum views select (Any views, 10K+, 100K+, 500K+, 1M+), Timeframe
   select (Last 7d, 14d, 30d, 60d, 90d), Follower band select (Any followers, Nano under 10K,
   Micro 10K to 100K, Mid 100K to 1M, Macro 1M+), and a "Saved views" dropdown button. Pushed
   to the right edge: Sort select (Highest score, Most recent, Most views) and a layout toggle
   group (grid icon, list icon).
3. A results count line, plain text, "N results", where N is the total matching rows, not the
   number rendered.
4. The grid or the list. Grid is CSS `auto-fill` at `minmax(240px, 1fr)`, so column count
   follows window width. Each cell is an `OutlierCard` in `full` variant. List is a bordered,
   divided stack of `FeedListRow`.
5. A centered "Load more" link, only when `items.length < total`.

`OutlierCard` internals, since Kai will want to mark these up: a 9:16 thumbnail block with a
faint diagonal hatch, a large translucent play glyph, then `VideoThumb` painting the real
image over it; `PlatformChip` top left; `OutlierBadge` top right; the duration stamp bottom
right (`formatDuration`, M:SS, empty string when duration is null so the stamp disappears); an
optional `overlayBadge` bottom left used by Channel Detail. Below the thumbnail: a channel row
linking to `/channels/[id]` with avatar, handle, and follower count ("442.4K followers"); the
caption clamped to two lines; then a footer metrics line with an eye icon, compact view count,
a middot, and relative time. A bordered action row closes the card: a bookmark icon button
whose tooltip reads "Save to Vault - opens the video" and which is a link to `/feed/[videoId]`,
a "Remix" link to `/feed/[videoId]/remix`, and an overflow menu with "Copy link" and "View on
Instagram".

`FeedListRow` is denser: 40px thumbnail button, a fixed 16-unit badge column, the caption as a
truncating single line (or an em dash when the caption is null), a 40-unit channel link, a
right-aligned view count, a right-aligned relative time.

`OutlierBadge` heat tiers come from `lib/heat.ts`: null or below 2x renders a quiet outlined
chip showing an em dash; 2x to 5x is a faint amber outline; 5x to 10x is a stronger amber; 10x
to 20x is a solid amber fill; 20x and up is an orange to red gradient with a glow. Today the
highest real score is 10.1x, so tier 4 has never rendered against real data.

**Actions.**

- Change any select or toggle: `FilterBar.set(key, value)` writes the param and calls
  `router.replace(pathname + "?" + params, { scroll: false })`. Choosing the "all" or "any"
  option deletes the param rather than writing a sentinel. Every change except the layout
  toggle also deletes `limit`, so pagination resets to the first 24.
- Toggle grid or list: writes `view=list` or `view=grid` and preserves `limit`. Read on the
  client by `FeedGrid` from `useSearchParams`, so it does not need a server round trip beyond
  the replace.
- Sort: writes `sort=score|recent|views`. Default when absent is `score`.
- Click a card thumbnail, or press Enter or Space on it: opens the quick preview sheet (C3).
  The card body below the thumbnail is a second mouse target for the same action and
  deliberately has no tab stop, so keyboard users get exactly one stop per card.
- Click the channel row: navigates to Channel Detail.
- Click the bookmark icon: navigates to `/feed/[videoId]`. It does not save anything; the
  tooltip says so.
- Click "Remix": navigates to `/feed/[videoId]/remix`.
- Overflow, "Copy link": `navigator.clipboard.writeText(item.url)`, then a success toast "Link
  copied" or an error toast "Couldn't copy to clipboard, check browser permissions."
- Overflow, "View on Instagram": opens `item.url` in a new tab with `noopener noreferrer`. The
  label uses `platformLabel(platform)`, so it reads TikTok or YouTube Shorts for those.
- "Load more": a plain `Link` to the same route with `limit` increased by 24, `scroll={false}`.

**System.** `app/(shell)/feed/page.tsx` is an async server component. It awaits `searchParams`,
then runs `getFleets()`, `getSavedFilters()` and `getChannelsList()` in parallel. It builds a
`FeedFilters` object and calls `getOutlierFeed(filters)` in `server/queries/feed.ts`, which
runs two queries in parallel against `videos` inner joined to `channels`: the page of rows
using `feedItemColumns`, and a `count(*)` for the total. `buildWhere` always adds
`isNull(videos.deletedAt)`, so a post Instagram has removed can never appear here; that guard
is not optional for callers. `followerBand` maps through `FOLLOWER_BAND_BOUNDS` (nano
[0, 10000), micro [10000, 100000), mid [100000, 1000000), macro [1000000, null]) into a
`followerCount >= min` plus `followerCount < max` pair on the channels table. A `fleetId`
first reads `fleet_channels` and then constrains `videos.channelId` with an `IN` list, or with
a literal always-false condition when the fleet has no members. Sorting: `score` orders by
`outlierScore IS NULL` then `outlierScore desc`; `views` by `viewCount desc`; `recent` by
`postedAt desc`. Pagination is `limit` with `offset` hardcoded to 0, so "Load more" re-runs the
whole query with a bigger window rather than fetching a page.

**Failure.** There is no `error.tsx` anywhere under `src/app`. A throw in `getOutlierFeed`, a
locked SQLite file, or a corrupt `criteria` JSON blob therefore hits Next's default error
handling: the dev overlay locally, a bare generic error page in production. No product level
message, no retry affordance, no way back to a working filter set. A thumbnail whose asset row
exists but whose file is missing shows `VideoThumb`'s explicit "Unavailable" treatment (a red
tinted box with an image-off icon), deliberately distinct from "not downloaded yet". A
clipboard rejection surfaces as an error toast. A non-numeric `minScore` in a hand-edited URL
is dropped by `num()` and the filter is simply not applied, silently.

**Empty.** Covered in full in C4. Briefly: no channels at all gives an invitation to add one;
channels present but zero matches gives "No outliers match these filters" plus "Clear
filters".

**Open question.** On a bare `/feed` the page silently applies the Balanced preset
(`minScore: 5`, `sinceDays: 30`), but the filter bar reads its values from the URL only, so the
score select displays "Any score" while the server is filtering at 5x. The timeframe select
happens to display "Last 30d" because its own fallback is "30", which coincidentally matches.
So the default view lies about one of its own filters, and worse, it hides every video whose
`outlierScore` is null (a `>= 5` comparison drops nulls), which is exactly the small-channel
case Kai cares about. Options: write the Balanced params into the URL on first load so the bar
tells the truth, drop the implicit default entirely, or keep the default but make the score
filter null-inclusive. Needs a decision.

---

### C2. Saved filter presets, including "reproducible outliers"

**Entry.** The "Saved views" dropdown button in the `FilterBar`, available on every `/feed`
view.

**Screen.** A dropdown menu. Inside a single menu group: the label "Saved views", a separator,
then one menu item per row in `saved_filters`. When there are none, the text "No saved views
yet" in muted grey. Today the list is exactly two items, "Balanced" and "High Conviction", both
system rows inserted by `server/db/bootstrap.ts`. There is no active-state checkmark, no
description of what a preset does, no delete or rename, and no "Save current filters as..."
entry.

**Actions.**

- Click a preset: `applyPreset(preset)` walks `PRESET_CRITERIA_KEYS` (`minScore`, `minViews`,
  `sinceDays`), maps each to its param name (`sinceDays` becomes `since`), sets the param when
  the criteria value is a number and deletes it when it is not, deletes `limit`, then
  `router.replace`. Params the preset does not mention (`platform`, `fleet`, `band`, `sort`,
  `view`) are left exactly as they were.
- There is no other action. Presets cannot be created, edited, reordered, or deleted from
  anywhere in the product.

**System.** `getSavedFilters()` in `server/queries/feed.ts` does an unfiltered select of `id`,
`name`, `isSystem`, `criteria` from `saved_filters`. The table is
`{ id, name, criteria (JSON), is_system }`. The only writer in the entire codebase is
`bootstrapSystemFilters()` in `server/db/bootstrap.ts`, run via `npm run db:bootstrap`, which
inserts two rows idempotently keyed on name plus `is_system`: Balanced
`{ minScore: 5, sinceDays: 30 }` and High Conviction
`{ minScore: 10, sinceDays: 14, minViews: 500000 }`. `feed/page.tsx` separately looks up the
Balanced row by name and uses its criteria as the implicit default for a bare `/feed`.

**The new "reproducible outliers" preset.** Intent: nano plus micro follower bands, score 5x
and up, last 30 days. Three things block it today, all of them real code, not guesses.

1. `FeedFilters.followerBand` is a single value of the union `"nano" | "micro" | "mid" |
   "macro"`. Two bands at once cannot be expressed. Since nano is [0, 10000) and micro is
   [10000, 100000) and they are adjacent, the cheapest correct fix is one extra band whose
   bound is `[0, 100000)`. Naming it is a product decision, not a code one. A more general fix
   is making `followerBand` an array and OR-ing the bound pairs, which also unlocks
   combinations like nano plus macro that nobody has asked for.
2. `applyPreset` only understands `minScore`, `minViews` and `sinceDays`. A preset carrying a
   `followerBand` key would be read from the database, rendered in the menu, clicked, and then
   silently apply only the score and date parts. The follower band would vanish with no error.
   `PRESET_CRITERIA_KEYS` and `CRITERIA_TO_PARAM` both need the new key, and `band` needs to
   join the params `applyPreset` explicitly clears when a preset omits it.
3. There is no writer for a third preset. `SYSTEM_FILTERS` in `bootstrap.ts` needs the row,
   and every existing install needs `db:bootstrap` re-run (it is idempotent, so this is safe).

Proposed criteria row, once the band problem above is settled:
`{ name: "Reproducible outliers", criteria: { followerBand: "nano-micro", minScore: 5,
sinceDays: 30 }, isSystem: true }`.

**Failure.** A `criteria` blob whose values are the wrong type is not an error: `applyPreset`
tests `typeof value === "number"` and deletes the param when the test fails, so a preset with
`{ minScore: "5" }` quietly clears the score filter instead of setting it. A criteria key the
code does not know about is ignored with no warning anywhere, which is exactly failure mode 2
above. If `db:bootstrap` has never been run, the dropdown shows "No saved views yet" and, more
seriously, `feed/page.tsx` finds no Balanced row so a bare `/feed` applies no filters at all,
which is a different default view from a bootstrapped install.

**Empty.** "No saved views yet" inside the dropdown. The dropdown button itself is always
present, so the empty state is only reachable by opening it.

**Open question.** On the real library this preset returns zero results today. The only channel
with posts is `@kallaway` at 442,447 followers, which is mid, and `@hormozi` has a null
follower count so it is excluded from every band filter by SQL null semantics regardless. So
the first time Kai clicks "Reproducible outliers" he will see the filtered-empty state. Does
that state need to say something specific, along the lines of "no nano or micro channels are
tracked yet, add some", or is the generic message acceptable? Second question: should a preset
be a full replacement of the filter state (clear everything it does not set) or a partial
overlay (today's behaviour)? Partial overlay means a leftover `band=macro` survives applying
"Reproducible outliers", which would be actively wrong for this preset.

---

### C3. Quick preview from the grid

**Entry.** Clicking a card thumbnail in grid view, pressing Enter or Space while the thumbnail
has focus, clicking the card body below the thumbnail, or clicking either the thumbnail button
or the caption button in a list row. All of them call `setPreviewId(videoId)` in `FeedGrid`.

**Screen.** A right-hand `Sheet`, full width on small screens and capped at 440px above the
`sm` breakpoint. The feed stays mounted and unscrolled behind it. Header: the title "Quick
preview". Body, scrollable, top to bottom:

1. A 9:16 thumbnail block, same construction as the card (play glyph underneath, `VideoThumb`
   over it), with `PlatformChip` top left and a large `OutlierBadge` top right.
2. The channel handle in bold, then the caption clamped to two lines.
3. A single metrics row: eye icon and views, heart icon and likes, speech bubble icon and
   comments, then relative time.
4. A "Transcript" heading with the transcript text clamped to four lines, or the fallback line
   "No transcript yet - transcription arrives with the phase-2A sync engine".
5. Pinned at the bottom of the flow: two equal-width buttons, "Open full page" (outline,
   links to `/feed/[videoId]`) and "Remix" (filled, links to `/feed/[videoId]/remix`).

There is no player in the sheet, no analyze button, no vault action, no copy action, and no
next or previous navigation between cards.

**Actions.**

- Open: sets `previewId`, which opens the sheet and triggers the fetch.
- Close: the sheet's own dismiss (backdrop click or Escape) calls `onClose`, which sets
  `previewId` back to null.
- "Open full page" and "Remix": ordinary navigations, which unmount the feed.

**System.** `QuickPreviewSheet` runs an effect on `id`, calling the
`getVideoPreviewAction(id)` server action (`server/queries/preview-action.ts`), a thin wrapper
around `getVideoDetail(id)`. The effect uses a `cancelled` flag so a fast reopen on a different
card cannot land stale data. State is a single `{ id, detail }` object, and `loading` and
`notFound` are derived by comparing `result.id` to the current `id` rather than tracked
separately. Nothing is prefetched: the grid never loads transcript or analysis data for cards
nobody opened. Note that `getVideoDetail` is the full detail query, so the sheet pays for the
carousel children query and the analysis row lookup even though it renders neither.

**Failure.** A null return (the row is gone, most likely because the video was deleted between
render and click) shows the single line "This video couldn't be found." with no retry. A throw
inside the server action is not caught anywhere in this component: the promise rejects, the
`.then` never runs, and the sheet stays on its skeletons forever with no error and no timeout.
That is the worst failure in this flow. A thumbnail asset whose file is missing shows the
"Unavailable" treatment, same as the card.

**Empty.** While loading: three skeletons, a 9:16 block plus two short text bars. A video with
no transcript shows the fallback line above. A video with a null caption renders an empty
paragraph, no placeholder.

**Open question.** The transcript fallback copy is now false. It promises transcription "with
the phase-2A sync engine", but sync never transcribes; transcription happens on demand inside
Analyze. The full detail page already says the correct thing. Should the sheet get a live
"Transcribe and analyze" action of its own, or just corrected copy that points at the full
page? Related: the sheet has no way to reach the analysis, which is arguably the whole point
of a preview.

---

### C4. Empty state, loading state, and too few posts to score

**Entry.** Not a flow the user chooses. These are the three states `/feed` falls into when the
data is not there yet.

**Screen.**

*Loading.* `app/(shell)/feed/loading.tsx` renders during the server component's await. A
skeleton bar where the filter bar goes, a small skeleton where the results count goes, and
eight skeleton cards in the same grid geometry as the real one, each with a 9:16 block, a
badge-shaped pill top right, a round avatar bar, and two text bars. No spinner anywhere: the
layout itself does the communicating.

*No channels at all.* Centered, 24 units of vertical padding: the muted line "No outliers yet -
track a channel to get started" and a filled "Add your first channel" button linking to
`/channels`. This branch is chosen by `allChannels.length === 0`, so it is about tracked
channels, not about videos.

*Channels present, zero matches.* Centered: "No outliers match these filters" and an outline
"Clear filters" button linking to bare `/feed`. Note that bare `/feed` re-applies the implicit
Balanced default, so "Clear filters" does not actually clear everything.

*Too few posts to score.* There is no dedicated screen for this. A channel with fewer than 5
usable posts produces a null `outlierScore` on every one of its videos. Those videos render
with the tier 0 badge, an outlined chip containing an em dash, and nothing anywhere explains
why. Worse, they are invisible in the default view: the implicit `minScore: 5` compiles to
`outlierScore >= 5`, and null fails that comparison, so the entire channel disappears from a
bare `/feed` with no message. Sorting by score pushes nulls to the end when they do survive
the filter.

**Actions.** "Add your first channel" navigates to `/channels`. "Clear filters" navigates to
`/feed`. In the unscorable case there is no action at all, because there is nothing in the UI
to act on.

**System.** Scoring lives in `server/services/outlier-calc.ts` and runs at the end of a sync
(`sync-engine.ts` calls `scoreVideos(calc, SCORE_WINDOW)` and writes each result to
`videos.outlierScore`). `computeChannelMedian` filters to posts with a non-null `viewCount`,
sorts by `postedAt` descending, takes the most recent 20, and returns null when fewer than 5
remain (`MIN_USABLE = 5`) or when the median itself is 0. `scoreVideos` then maps every video
of that channel to null. So the threshold is 5 usable posts inside the 20 post window, and a
channel of exactly 4 posts is permanently unscorable until it posts a fifth. The feed's two
empty branches come from `feed/page.tsx`: `trueEmpty = allChannels.length === 0` and
`filteredZero = !trueEmpty && total === 0`.

**Failure.** The loading skeleton has no timeout: a hung query leaves eight skeleton cards on
screen indefinitely. With no `error.tsx`, a query failure escapes to Next's default error page
rather than to any of these states, so "something went wrong" and "nothing matched" are
visually unrelated experiences. A channel whose posts all have null view counts falls into the
unscorable case for a different reason than "too few posts", and the UI cannot tell the two
apart.

**Empty.** This flow is the empty state. The nesting to be aware of: loading beats no-channels
beats no-matches beats the grid, and unscorable is not a branch at all, it is a property of
individual rows that leaks into the other branches.

**Open question.** Three decisions here. First, does an unscorable video deserve visible copy,
for example a badge tooltip reading "not enough posts to score yet, 3 of 5", and should that
number be surfaced on the card or only on Channel Detail? Second, should the default view stop
hiding null-score videos, given that a freshly added nano channel is exactly the thing Kai is
hunting and it is currently invisible for its first four posts? Third, `@hormozi` is tracked
with zero posts and a null follower count; a channel like that contributes nothing to the feed
and is invisible from it, so the feed gives no signal that a tracked channel has never synced.

---

### D1. Video detail, metrics and transcript

**Entry.** The bookmark icon or the caption area of a card, "Open full page" in the quick
preview sheet, a card in the "Similar outliers" strip on another video's page, the Dashboard's
recently-viewed row, or a direct URL. Route is `/feed/[videoId]`.

**Screen.** Topbar h1 reads "Video Detail". The page is capped at 1120px and centered.

If the post has been removed from Instagram, a destructive Alert sits above everything: title
"No longer on Instagram", body explaining that the row is kept because its transcript,
analysis and remix work still matter, and that the media shown is the last copy downloaded.

Below that, two columns.

Left column, fixed 380px, scrollable:

1. A 9:16 media block. Carousel posts get `CarouselViewer`; video posts get `VideoPlayer` (D2);
   photo posts get a centered image icon with `VideoThumb` over it. A large `OutlierBadge`
   floats top right of the block regardless of type.
2. `MetricChips`: four stacked rows, views, likes, comments, and an engagement percentage
   computed as `(likes + comments) / views * 100` to one decimal. When views is null or zero,
   or either count is null, the engagement row reads an em dash followed by "engagement".
3. A channel link with avatar and handle.
4. A row with `PlatformChip` and the relative post time.
5. A "View on Instagram" external link with an arrow icon.
6. Pinned to the bottom of the column: "Save to Vault" (D5), "Create Prompt" (D6), and an
   overflow menu with "Copy link", "Copy transcript" (disabled with no transcript) and "Copy as
   prompt".

Right column, flexible: a three-tab strip.

- "Transcript" (default): the full transcript text in a scroll area, whitespace preserved, or
  the line "No transcript yet - open Hook & Structure or Why it worked and click Transcribe &
  Analyze".
- "Hook & Structure": with an analysis, a wrap of badges (the `hookType` as an outline badge,
  then every format tag, then every style tag as secondary badges), followed by an ordered list
  of structure segments, each a left-bordered row with a "0:00-0:03" time range and a label
  plus a one-sentence note. Without an analysis, a card containing the `AnalysisGate` (D3).
- "Why it worked": with an analysis, a card containing the `whyItWorked` paragraph. Without
  one, the same `AnalysisGate`.

Below both columns, full width: the "Similar outliers" strip (D4). Sticky at the very bottom:
a right-aligned bar with the primary link "Remix this video".

**Actions.** Tab switching (client only, no refetch). "Copy link" and "Copy transcript" write
to the clipboard and toast. Scroll the transcript. Click the channel. Open the post on
Instagram. Everything else belongs to D2 through D6.

**System.** `feed/[videoId]/page.tsx` awaits params, then calls `getVideoDetail(videoId)`
wrapped in React `cache()` so `generateMetadata` and the page body share one round trip. That
query joins `videos` to `channels`, then separately reads the `transcripts` row, the
`video_analyses` row, and the ordered `video_children` rows. `notFound()` fires when the row is
missing. In parallel the page runs `getSimilarOutliers(videoId)` and
`availableTranscriptProviders()`, and derives `canTranscribe` from whether any provider reports
available. `hasLlmKey()` is read from the environment. `recordRecentlyViewed(videoId)` is
called without await and writes a deduped, most-recent-first list of at most 8 ids into
`app_settings.recently_viewed`; its errors are swallowed and logged at debug.

Unlike the feed, this query does not exclude soft-deleted rows, on purpose: a removed post is
still reachable by id and the `deletedAt` flag drives the Alert.

**Failure.** A missing video renders correct not-found content but the HTTP status stays 200.
This is documented in the route file as a known gap; the author confirmed the cause is an
interaction between `generateMetadata` and `notFound()` in this Next version, not a missing
call, and chose not to chase it. There is no `not-found.tsx`, so the default Next 404 page
renders outside the app shell, with no sidebar and no way back. A database failure has no error
boundary, same as the feed. A transcript row with empty text renders as an empty scroll area
rather than as the "no transcript" line, because the check is on the row existing, not on the
text being non-empty.

**Empty.** No transcript, no analysis is the normal state for a freshly synced video: the
Transcript tab shows its pointer line, both analysis tabs show the gate, Save to Vault is
disabled with a tooltip, Similar outliers shows "Analyze more videos to see patterns", and
`MetricChips` shows em dashes for any null count. Create Prompt still works and still produces
a full document.

**Open question.** The page has no visible affordance for re-running an analysis. Once a
`video_analyses` row exists it is permanent, because `getOrCreateAnalysis` returns the cached
row first and there is no delete path. That matters most right now: the one analysis that
exists was produced from a transcript alone, with fabricated style tags, and there is no way
to replace it from the UI.

---

### D2. Watch the video

**Entry.** Opening `/feed/[videoId]` for a post whose `mediaType` is `"video"`. Playback is
never available from the feed or the quick preview sheet.

**Screen.** `VideoPlayer` renders one of four states inside the 9:16 block.

1. The file is present: a real `<video>` element, `controls`, `preload="metadata"`,
   `playsInline`, `object-contain` on a black background, with the thumbnail asset as the
   poster.
2. Not downloaded, idle: a dark panel with a play glyph, the line "Video not downloaded yet",
   and an outline "Download video" button. This is framed as normal, not as an error, because
   it is the state of every video nobody has opened.
3. Downloading: a spinning loader and "Downloading video...". No percentage, deliberately, as
   the sidecar round trip reports no progress.
4. Failed: the idle panel again, plus the real error message from the action in destructive red
   with `role="alert"`, and the download button still there to retry.

For a carousel post, `CarouselViewer` shows one slide at a time with prev and next buttons,
left and right arrow key support, and an "n / total" counter bottom right. A video slide with
no downloaded file shows the label "Video not downloaded yet" over its thumbnail and no button,
because no per-child download action exists.

**Actions.** Click "Download video", which calls `downloadVideoAction(videoId)`. On success the
component stores the returned asset id locally so the player appears immediately, and also
calls `router.refresh()` so the server-rendered parts of the page pick up the persisted
`videoAssetId`. Then the native video controls: play, pause, scrub, volume, fullscreen,
picture in picture, all browser-provided. On a carousel: prev, next, arrow keys.

**System.** `server/actions/media-actions.ts`. The action reads the video row, returns the
existing asset id if there already is one, and refuses a photo post with "This post is a photo,
there is no video to download." Otherwise it logs `video.download.requested`, calls
`igClient.resolveMedia(externalId)` to get a *fresh* signed media URL (the URL captured at sync
time is dead within hours, which is why this is a real authenticated round trip on the click),
then `ensureAsset(freshUrl, "video")` to download and content-address the bytes, then updates
`videos.videoAssetId` and `lastRefreshedAt`, then logs `video.download.finished`.

Serving is `app/api/media/[assetId]/route.ts`, Node runtime, not edge. It looks up the asset
row, resolves and validates the path against the media root, stats the file, and streams it
with `createReadStream` rather than buffering. It honours `Range`: a satisfiable range gets a
206 with `Content-Range` and only that slice read off disk; an unsatisfiable range gets a 416
with `bytes */size`; a malformed or absent range serves the whole file as 200. `Accept-Ranges:
bytes` is always set. `ETag` is the asset sha256 and `If-None-Match` is compared weakly per RFC
9110, so a repeat visit gets a 304. `Cache-Control` is one year immutable, safe because the URL
is content-addressed. Scrubbing in the player is what exercises the 206 path.

**Failure.** Every failure of the media route is a bare 404 with no detail, whether the id is
malformed, the row is absent, the path escapes the media root, or the file is gone. The reason
is deliberate: the client should not be able to probe which. The server logs
`media.path_rejected`, `media.file_missing` or `media.not_a_file` accordingly, and logs
`media.size_mismatch` as a warning when the row's byte count disagrees with the file on disk,
which means a partial download was recorded as complete. Nothing is ever synthesised: no
placeholder image, no zero-byte body. On the action side: a post stored as a video that
Instagram now resolves as a carousel gets "This post is a carousel, its video is in one of the
slides, which can't be downloaded on its own yet."; resolved as a photo gets a message telling
the user to re-sync the channel. An `IgError` surfaces its `userMessage`; anything else
surfaces its raw `Error.message`, which may well be a developer-facing string. `execFileP`
imposes a 120 second default timeout on the shell-out helpers, though `ensureAsset`'s own
timeout behaviour was not read for this document and is an unknown here.

**Empty.** State 2 above is the empty state and it is the common one: all 8 videos in the
library are in it right now. Zero videos have ever been downloaded, which means state 1 has
never rendered against real data.

**Open question.** Nothing ever deletes a downloaded video. With on-demand download and no
eviction, `data/media` grows without bound and there is no size indicator or cleanup anywhere
in the product. Also: should Analyze downloading a file (D3) count as a user-visible download,
so that clicking Analyze silently turns the player from state 2 into state 1? That is what the
new design implies, and it is arguably good, but it means bytes land on disk from a button that
does not say "download".

---

### D3. Analyze the video, with visual frame analysis

**Entry.** Opening the "Hook & Structure" or "Why it worked" tab on a video with no analysis
row. Both tabs render the same `AnalysisGate`, so whichever the user lands on first can start
the run.

**Screen.** `AnalysisGate` picks one of four presentations, in this order:

1. No transcript and no way to make one (`canTranscribe` false, meaning neither whisper.cpp nor
   Groq is usable): an Alert titled "No transcript available yet", body suggesting
   `brew install yt-dlp whisper-cpp` plus a GGML model download, or a `GROQ_API_KEY` in
   Settings. No button, because no click could accomplish anything.
2. No transcript but transcription is possible: an active button reading "Transcribe & Analyze",
   which shows "Transcribing..." while pending. This button is live even with no Anthropic key,
   because the transcribe half is fully local.
3. A transcript exists but there is no Claude key: an Alert titled "Add your Claude API key".
4. Otherwise: a button reading "Analyze this video", showing "Analyzing..." while pending.

On success: a toast "Analysis complete" and `router.refresh()`, after which both tabs render
real content. On failure: an error toast carrying the mapped message, and the gate stays.

**Actions.** Exactly one: click the button. There is no cancel, no progress detail, no way to
re-run, and no way to analyze from the feed or the quick preview sheet.

**System, as it works today.** `analyzeVideoAction(videoId)` wraps
`getOrCreateAnalysis(videoId)`. That function returns the cached `video_analyses` row if there
is one, without touching the transcript or any model. Otherwise it reads the `transcripts` row,
and if there is none it calls `getOrCreateTranscript(videoId)`, which requires a locally
downloaded video asset and throws `VideoNotDownloadedError` when `videos.videoAssetId` is null.
There is deliberately no remote-URL fallback, so nobody can get an empty transcript from an
expired CDN link. With a transcript in hand it resolves an `LlmClient` via `getLlm()` (which
throws `NoApiKeyError` when unkeyed) and calls `generateParsed` with `ANALYZE_SYSTEM` and
`buildAnalyzeUser`, whose user turn is caption, duration, views, outlier multiplier, and the
full transcript. The result is validated against `VideoAnalysisSchema` and inserted into
`video_analyses` with the resolved model name.

Which client runs depends on the environment. `isCompatMode()` is true when
`ANTHROPIC_BASE_URL` is set, which is the 9router case; that `CompatLlmClient` always streams
(local routers mistranslate the non-streaming Anthropic wire format) and implements structured
output as prompt-engineered JSON: schema in the system prompt, fence-stripped `JSON.parse`, zod
validation, one retry, then `LlmParseError`. The native client uses `messages.parse()` with
`zodOutputFormat`, also with one retry on a null `parsed_output`.

**Two problems with today's behaviour, both confirmed in code.**

First, the analysis has never seen a frame. `ANALYZE_SYSTEM` explicitly tells the model to
ground everything in the transcript and never invent visuals, and then in the same breath asks
for `styleTags` describing "editing/visual style" with examples "fast-cut", "on-screen-text",
"single-shot", "b-roll". None of those are derivable from a transcript. The prompt is asking the
model to invent exactly the thing it forbids inventing. Every style tag in the database today
is a guess, and those same tags feed similarity (D4), the Vault style template (D5) and the
prompt export (D6), so the fabrication propagates.

Second, on this machine Analyze cannot succeed on any video at all. Zero videos have a
downloaded file, so `getOrCreateTranscript` throws `VideoNotDownloadedError` on all 8. That
error is not handled in `analyze-actions.ts`: `errorMessage` maps `NoApiKeyError` and
`NoTranscriptProviderError` and sends everything else to `llmErrorMessage`, which falls through
to `err.message` for a non-SDK error. So the toast reads the raw developer string "video
<uuid> has no downloaded video asset yet - sync must download it before it can be transcribed",
which names sync as the fix even though sync deliberately never downloads videos. The message
is both ugly and wrong.

**System, proposed.** Analyze becomes a four-step pipeline with visible stages, per the settled
decision:

1. Ensure the local file. Reuse the `downloadVideoAction` path (resolve a fresh signed URL,
   `ensureAsset`, persist `videoAssetId`) when `videoAssetId` is null. This also removes the
   `VideoNotDownloadedError` dead end above, since the file now exists by construction. Stage
   label: "Downloading video".
2. Extract frames. Run the watch skill's `scripts/watch.py` against the local file path with
   `--no-whisper`, into a temp working directory. The script probes with ffprobe, picks a
   frame budget by duration (60 seconds or less targets 40 frames, 30 seconds or less targets
   at least 12, the cap is the detail tier's, `balanced` is scene-aware with a cap of 100),
   runs scene detection at threshold 0.20 and falls back to uniform sampling when a clip
   yields fewer than 8 distinct shots (which is the common case for a talking-head reel), then
   dedups near-identical frames by mean per-pixel difference on 16x16 grayscale thumbnails.
   Frames come out at 512px wide by default. `--no-whisper` is what keeps the script from
   trying its own transcription; Crowsnest already has the transcript locally. Stage label:
   "Extracting frames".
3. Vision analysis. Send the frames plus the existing local transcript to Claude Code through a
   headless subprocess, and ask for real on-screen text, caption placement, cut rhythm, framing
   and b-roll pattern. Note that no such subprocess helper exists in the codebase today:
   `server/lib/exec.ts` has `execFileP` and `detectBinary` for yt-dlp, ffmpeg and whisper-cli,
   and `LlmClient` only speaks HTTP to an Anthropic-compatible endpoint. This is new code, not
   a rewiring. Stage label: "Reading frames".
4. Persist. The `video_analyses` table has no columns for any of the new fields; `onScreenText`,
   `captionPlacement`, `cutRhythm`, `framing` and `bRollPattern` need either new columns or a
   single JSON `visual` blob, plus a migration. `VideoAnalysisSchema` and `rowToAnalysis` both
   need to carry them, and `ANALYZE_SYSTEM` needs rewriting so `styleTags` are derived from
   frames rather than guessed.

Routing follows the settled decision: text tasks go to the free local proxy, vision and heavy
tasks go to Claude Code headless, and Claude Code is also the fallback when the proxy fails.
So step 3 always uses Claude Code, and a proxy failure in any text step falls back to it too.

**Failure.**

- No transcript provider: `NoTranscriptProviderError` is mapped to "Couldn't create a transcript"
  followed by the per-provider reason list, which is genuinely useful text.
- No Anthropic key: "Add ANTHROPIC_API_KEY in Settings to enable analysis."
- Auth, rate limit, connection and generic API errors are mapped by `llmErrorMessage` to
  "API key invalid or revoked, check Settings", "Rate limited, retry in a moment", "Network
  error reaching Claude", and a status-and-type string respectively.
- Structured output that never validates: `LlmParseError`, whose message reaches the toast as
  a fairly technical sentence about schema validation. On the 9router path this is the likeliest
  failure, since free routed models spend a large share of the 8192 token budget on thinking
  blocks before the answer.
- Not downloaded: today a raw developer message, see above. Under the proposed design this
  failure moves to step 1 and should surface as a download failure with the same messages D2
  already produces.
- New failure modes the proposed design introduces, none of which have handling yet: ffmpeg or
  ffprobe not installed, the extraction script exiting non-zero, a temp directory that cannot
  be written, the Claude Code binary not being on PATH, the headless subprocess hanging past a
  timeout, and a frame payload too large for one request.

**Empty.** Before any run the two analysis tabs are gates, not empty content. During a run the
button is disabled and its label changes, which is the only progress signal that exists; the
proposed four-step pipeline is long enough (download plus extract plus vision, likely tens of
seconds) that a single unchanging "Analyzing..." label is not enough. An analysis that returns
zero structure segments renders the line "No structure segments returned." under the badges.

**Open question.** Several, and this is the flow with the most unresolved design.

- Does Analyze re-run? Today it cannot. Given that every existing analysis was made blind, at
  minimum a one-time re-analyze is needed, and probably a permanent "Re-analyze" action.
- Is the visual pass always on, or an option? Always-on makes Analyze slow and makes it download
  files, which changes what the button means. An option adds a decision the user has to make
  before they know what it buys them.
- Where do the new visual fields render? "Hook & Structure" is already dense. On-screen text
  per beat would fit naturally inside the structure segment rows; caption placement, cut rhythm,
  framing and b-roll pattern read more like a fourth tab or a "Visual template" panel.
- Do frames get kept? Keeping them means the frames can be re-read without re-extracting and
  shown to the user as evidence for a claim about the video. Discarding them keeps the media
  directory smaller. Nothing about frame storage has been decided.
- What is the timeout, and what does the UI do when it fires mid-way? A partial result (frames
  extracted, vision failed) has nowhere to live in the current single-row schema.

---

### D4. More like this (pattern similarity)

**Entry.** Scrolling down the video detail page. The strip is always rendered, below the two
columns and above the sticky remix bar. It is not a click-through and there is no separate
route.

**Screen.** A bordered, full-width section with the h2 "Similar outliers", then a horizontally
scrolling row of up to five compact `OutlierCard`s, each 40 units wide. Compact cards drop the
caption and the whole action footer, so each is thumbnail, badge, channel row, then views and
relative time. With nothing to show, a single muted line: "Analyze more videos to see patterns".

**Actions.** Click a card thumbnail or body: `router.push("/feed/" + id)`, a full navigation to
that video's detail page rather than a preview sheet. Click a card's channel row: navigate to
Channel Detail. Scroll the row horizontally. There is no "see all", no way to change the count,
and no explanation of why a given card is considered similar.

**System.** `getSimilarOutliers(videoId, limit = 5)` in `server/services/similar.ts`, called
from the page's parallel fetch. It reads the source video's `video_analyses` row and returns an
empty array immediately if there is none. Otherwise it selects every other analyzed video,
joined to `videos` and `channels`, excluding the source and excluding soft-deleted rows (the
same guard the feed applies). Each candidate is scored by `scoreSimilarity`: an exact
`hookType` match is worth 3, and each distinct shared structure-segment label, format tag and
style tag is worth 1 each, compared only within its own category so a format tag can never
match a style tag. Both sides are deduped, so a repeated tag is still worth 1. Ties break on
`outlierScore` descending. The top 5 are returned as plain `FeedItem`s; the score itself is
dropped and never shown.

Note the shape of the candidate query: it selects every analyzed video in the library with no
limit and scores them in JavaScript. That is fine at 8 videos and worth remembering at 8,000.

**Failure.** No error path exists. A throw inside `getSimilarOutliers` takes down the whole
page render, because the page awaits it in the same `Promise.all` as the transcript provider
check, with no catch and no error boundary. Since the similar strip is a secondary feature,
that is a disproportionate blast radius.

**Empty.** "Analyze more videos to see patterns" covers three genuinely different situations
with one sentence: the source video has no analysis, the source has one but no other video
does, or others do but every similarity score came out at zero. The third case is arguably not
empty at all: the code does not filter on score, so five zero-score cards would render as if
they were matches. Right now exactly one analysis exists in the whole database, so this strip
is empty on every single video, including the analyzed one.

**Open question.** Should a zero-score candidate be shown? Today it would be, silently, as a
"similar" video with nothing in common. And should the card say why it matched, for example a
small chip reading "same hook" or "3 shared tags"? Without it the user has no way to judge
whether the recommendation is any good, which matters more once visual tags from D3 start
feeding the same scoring function.

---

### D5. Save a hook or style to the Vault

**Entry.** The "Save to Vault" button in the left column of the video detail page. The bookmark
icon on a feed card also leads here, but only by navigating to the detail page; its tooltip
says "Save to Vault - opens the video" so the indirection is at least honest.

**Screen.** Before an analysis exists, the button is rendered disabled but still focusable, with
a tooltip reading "Analyze this video first to save hook/style templates". After an analysis
exists it opens a dialog, capped at 90 percent viewport height and scrollable:

- Title "Save to Vault", description "Prefilled from this video's analysis - edit before
  saving."
- A three-way toggle group: Hook, Style, Both. Default Hook.
- A bordered block per selected type. The hook block has Hook title, Hook template (a 3-row
  textarea) and comma-separated tags. The style block has the same three fields.
- Footer: a single "Save" button, showing "Saving..." while pending.

Prefill is derived from the analysis. The hook title is the `hookType` slug title-cased plus
the word "Hook", for example "curiosity-gap" becomes "Curiosity Gap Hook". The hook template is
the first structure segment's note followed by " - for {topic}", or a generic fallback naming
the hook type. Hook tags are the hook type. The style title joins the structure labels with
hyphens plus " Style", the style template joins the labels with arrows and then appends the
style tags, and the style tags are the analysis style tags verbatim.

**Actions.** Toggle Hook, Style or Both. Edit any field. Click Save. Dismiss the dialog. There
is no delete from here (deletion lives on the Vault page) and no way to save to an existing
item.

**System.** `createVaultItemAction` in `server/actions/vault-actions.ts` inserts into
`vault_items` (`id`, `type`, `sourceVideoId`, `title`, `templateText`, `tags` as JSON,
`createdAt`). With "Both" selected the dialog fires two inserts in a single `Promise.all`. On
success it toasts, closes, and calls `router.refresh()`. Tags are parsed by splitting on
commas, trimming, and dropping empties.

**Failure.** If either insert fails, the first failure's message is toasted and the dialog stays
open. With "Both", the two inserts are not a transaction, so one can succeed while the other
fails; the user sees only the error, and a duplicate save attempt then creates a second copy of
the item that already succeeded. Empty title or empty template text is not validated anywhere,
client or server, so an empty vault item can be created. Tags are never normalised or
deduplicated.

**Empty.** No analysis means the disabled button and its tooltip, which is the real empty state
and the one every video is in right now except one. An analysis with no structure segments
produces the style title "Style Template" and the template text "Describe the structure and
editing style.", which is an honest placeholder rather than a fabricated summary.

**Open question.** The style template is built entirely out of style tags that the model
invented without seeing the video (D3). Six vault items already exist. Do those get flagged,
regenerated, or left alone once real visual analysis lands? Second question: the settled north
star is taking a viral video's hook, script and layout and regenerating it in Kai's own style,
but the Vault today stores only a hook template and a style template. Layout, meaning caption
placement, framing and cut rhythm, has nowhere to be saved. Should the Vault gain a third type,
or should the style item absorb the visual fields?

---

### D6. Copy as prompt

**Entry.** Two controls on the video detail page, both calling the same handler: the "Create
Prompt" button with a wand icon in the left column action row, and the "Copy as prompt" item in
that row's overflow menu. Available regardless of analysis state; the export degrades instead
of refusing.

**Screen.** No screen of its own. The only visible result is a toast: "Prompt copied - paste
into any LLM" on success, or an error message. The document goes straight to the clipboard and
is never previewed, so the user cannot see what they are about to paste before they paste it.

**Actions.** One click. There is no preview, no edit, no download to a file, and no choice of
which sections to include.

**System.** `buildVideoPromptAction` wraps `buildVideoPrompt` in `server/services/export.ts`.
That function reads the video joined to its channel, the `video_analyses` row, the
`transcripts` row, the niche profile from `app_settings.niche_profile` (defaulting to the string
"general short-form content"), and the top 5 similar outliers via `getSimilarOutliers`. It then
assembles a fixed markdown document whose section order never varies:

1. An h1 with the caption, or "(untitled video)".
2. "Topic framing": the caption, then "Niche: ...".
3. "Hook strategy": the hook type joined to the first structure segment's note.
4. "Structure beats": a numbered list of segments with second ranges and notes.
5. "Style notes": "Format: ..." and "Style: ..." from the tag arrays.
6. "Research facts": the "why it worked" paragraph, then a bulleted list of similar tracked
   outliers with handle, multiplier and caption.
7. "Source metrics": channel, views, outlier multiplier, duration, posted date.
8. "Transcript": the full text, or "No transcript available.".
9. A footer pointing at Remix Studio.

Every analysis-dependent section degrades to "Analysis pending." or a more specific variant
rather than disappearing, so the document's shape is stable whether or not the video has been
analyzed. The same file also exposes `buildScriptPrompt`, the equivalent for a saved script,
which prefers Vault templates over analysis-derived text where both exist.

**Failure.** A missing video gives "Video not found." Any thrown error is stringified straight
into the toast with no mapping, so a database error would surface as a developer message. A
clipboard rejection gives "Couldn't copy to clipboard, check browser permissions.", and the
generated document is then lost entirely, because it was never stored or displayed anywhere.
That is the sharpest failure in this flow: the work is done, the user gets nothing, and the
only recovery is to click again and hope.

**Empty.** On an unanalyzed video with no transcript, which describes 7 of the 8 videos in the
library, the copied document is still eight sections long but four of them say "Analysis
pending." and the transcript section says "No transcript available.". It remains useful,
because "Source metrics" and "Topic framing" carry the caption, the channel, the view count and
the 10.1x multiplier, but the user gets no warning that most of the value is missing.

**Open question.** Should the button warn, or offer to analyze first, when the document would
come out mostly empty? And once visual analysis lands, the document needs new sections for
on-screen text, caption placement, cut rhythm, framing and b-roll pattern, because those are
precisely the "layout" half of the north star and pasting a prompt without them regenerates the
script but not the look. Also unresolved: whether a preview step is wanted, given that a
silent clipboard write is unverifiable from the user's side.
