# Video detail page deep test plan, 2026-08-01

Same method as `2026-08-01-feed-deep-test-plan.md`: read the code first, follow the
data, find candidates for silent bugs (a value that renders wrong without erroring,
or a mismatch between two numbers that both look right on their own), cite each one
by file:line, then turn the credible ones into read-only browser cases.

Entry point read: `src/app/(shell)/feed/[videoId]/page.tsx`, its component
`src/components/video/video-detail.tsx`, and everything that page awaits:
`getVideoDetail` and `recordRecentlyViewed` (`src/server/queries/video.ts`),
`getSimilarOutliers` (`src/server/services/similar.ts`), `getChannelMedianBasis`
(`src/server/queries/channels.ts`), `getSavedPostByVideoId`, `createSavedPostAction`,
and `deleteSavedPostAction` (`src/server/queries/saved-posts.ts`,
`src/server/actions/saved-post-actions.ts`), `analyzeVideoAction` and
`runFramePassAction` (`src/server/actions/analyze-actions.ts`), and the child
components (`metric-chips.tsx`, `median-baseline.tsx`, `layout-section.tsx`,
`video-player.tsx`, `carousel-viewer.tsx`, `save-post-button.tsx`).

The headline finding is not really inside this file at all. The "current feed
order" this page reconstructs for prev/next navigation is fed by a search params
object that, on every real click path in this app today, is always empty. That
makes prev/next quietly ignore whatever filter a user is actually browsing under.
Section A covers that in full, since it needed the most cross-file reading.
Sections B through F cover several more candidates, each with a real-or-expected
verdict, followed by items that need fixture data this plan cannot manufacture,
and a short list of things checked and found safe.

Everything below is read-only against `http://localhost:3000`. No settings
changed, no video downloaded, no save left in a new state, no sync or LLM call
triggered. Where a candidate genuinely needs a state change to observe (a
download, an edited scoring setting), it is marked "needs fixture" and gets a
code-reading verdict instead of a browser case.

## A. Prev/next navigation never sees the filter the user was actually browsing under

`resolveFeedNav` in `src/app/(shell)/feed/[videoId]/page.tsx:64-89` rebuilds "the
current feed order" from `searchParams` on the video detail route, using a local
`buildFeedFilters` (`page.tsx:49-62`) that maps `sp.minScore`, `sp.since`,
`sp.minViews`, and `sp.band` straight through with no fallback. The doc comment at
`page.tsx:31-47` frames a bare `/feed/[id]` visit (no params) as an edge case,
described there as a bookmark or an external link that has not been updated to
forward the filter, which should fall back to the feed's own default order,
sorted by score, unfiltered.

That framing does not match how the app actually links here. Every click path
from the feed grid into a post goes through a Quick Preview sheet, not a direct
link:

- `src/components/feed/feed-grid.tsx:19,41,58`: both grid (`OutlierCard`) and list
  (`FeedListRow`) view wire `onOpen` to `setPreviewId`, a local `useState`, not a
  navigation.
- `src/components/feed/quick-preview-sheet.tsx:111`: the sheet's own "Open full
  page" link reads `href={\`/feed/${detail.item.videoId}\`}`, no query string
  appended at all, regardless of whatever `minScore`, `since`, `band`, or `q` the
  feed page was actually filtered by when the sheet was opened.
- `src/components/video/video-detail.tsx:224`: the Similar Outliers row on the
  detail page itself navigates the same way, `router.push(\`/feed/${id}\`)`, no
  params, so chaining from one detail page into another also drops filter state.

There is no code path in this app, other than a hand typed URL, that ever reaches
`/feed/[videoId]` with a query string attached. `resolveFeedNav`'s `sp` is
therefore always `{}` in practice, `buildFeedFilters` always resolves to no
score, views, timeframe, or band condition, and prev/next always walks the full
unfiltered feed sorted by score (`sort: ... ?? "score"`, `page.tsx:58`, `limit:
FEED_ORDER_LIMIT` at 5000, `page.tsx:47,59`). This is the same failure family the
sibling feed plan documents, a bare URL visit silently substituting a different
result set than the user intended, except here it is not a one time landing
default, it happens on every single click into the detail page.

Worth noting the feed page itself no longer has this problem for its own
filtering: `src/lib/feed-filters.ts:59-97` (`isFeedEmpty` and
`resolveFeedCriteria`) is the fixed, shared mechanism `feed/page.tsx` now uses,
keyed on real filter params only, with cosmetic params excluded. `[videoId]/page.tsx`
does not import that module at all; it reimplements its own `first` and `num`
locally (`page.tsx:21-29`), which is how it ended up without the Balanced preset
fallback the feed page has.

Concretely: browsing `/feed` with the seeded "Balanced" default (minScore 5, 30
days, likely a handful of results depending on synced data, see the feed plan)
and opening any card shows a prev/next rail and an "N of Total" label computed
over the entire unfiltered library (likely 40 plus, whatever the full synced
count is), not over the few posts that were actually on screen. Clicking "next"
can land on a post that never appeared in the filtered feed the user was looking
at, with no indication that the ordering changed underneath them.

### TC-VD-A1: Index label reflects the full library, not the filtered feed
Steps:
1. Go to `/feed` (bare, seeded Balanced default applies per the feed plan). Note
   the total result count shown on the feed page and the handle and caption of
   the first card.
2. Click that card to open the Quick Preview sheet, then click "Open full page".
3. Read the URL bar and the "N of Total" label next to the back arrow.
Expected: the URL is `/feed/<id>` with no query string. The "Total" half of the
index label does not match the feed's filtered count from step 1; it should be
close to the full synced library size (check against `/channels`' total post
counts, or the "Any score" unfiltered feed count from the sibling feed plan).
If Total does match the filtered count exactly, this finding is wrong and needs
revising, since that would mean some mechanism forwards the filter that this
read did not find.

### TC-VD-A2: Next from a heavily filtered feed still goes somewhere
Steps:
1. From the state in TC-VD-A1 (a feed filtered down to few results), on the
   detail page click "next" (or press the right arrow key).
Expected: if the filtered feed had only one or two results, is the "next"
control disabled (`feedNav.nextHref` null), or does it navigate to a different
post? Per the code read it should navigate, because the order it computed was
never actually filtered. Record which post it lands on and confirm that post
was not one of the cards visible on the filtered `/feed` view from step 1.

### TC-VD-A3: Explicit filter params survive if hand typed, confirming the mechanism itself works
Steps:
1. Go directly to `/feed/<id>?minScore=5&since=30` for a known video id (typed by
   hand, not clicked through), where that video is known to clear a 5x, 30 day
   filter.
Expected: `indexLabel`'s Total should now be smaller, closer to what `/feed`
shows under an explicit `?minScore=5&since=30`. This isolates the bug to
"nothing forwards the params" rather than "the resolution logic itself is
broken." If this case also shows the full unfiltered total, the bug lives in
`buildFeedFilters` or `getOutlierFeed` instead of in the missing forwarding, and
the finding above needs revising accordingly.

## B. Client side state leaking across a videoId change (no key on per-video widgets)

Neither `VideoPlayer` nor `CarouselViewer` is given a key tied to the video id
when rendered from `video-detail.tsx` (`video-detail.tsx:370-376`):

```
{item.mediaType === "carousel" ? (
  <CarouselViewer items={detail.children} />
) : item.mediaType === "video" ? (
  <VideoPlayer videoId={item.videoId} videoAssetId={item.videoAssetId} thumbnailAssetId={item.thumbnailAssetId} />
) : ( ... )}
```

Because the page component tree at that position stays structurally identical
across a prev/next navigation (same component type, same slot), React reconciles
rather than remounts, so any local `useState` inside those components survives
the navigation unless something resets it. Two instances of this look like real
bugs, one is cosmetic and likely intended.

### B1. VideoPlayer's downloaded asset state can outlive the video it belongs to
`video-player.tsx:57,60`: `downloadedAssetId` is `useState<string | null>(null)`,
set only inside `download()` on a successful fetch, and `resolvedAssetId =
videoAssetId ?? downloadedAssetId` falls back to that state whenever the new
video's own `videoAssetId` prop is null. If a user downloads post A's video this
session, then navigates to post B (also `mediaType: "video"`, not yet
downloaded, `videoAssetId: null`), the same `VideoPlayer` instance is reused, its
`downloadedAssetId` state still holds A's asset id, and `resolvedAssetId`
resolves truthy for B. The component takes the `if (src)` branch
(`video-player.tsx:64-76`) and renders a playable `<video>`, entirely skipping
the "not downloaded yet" gate for B, while everything else on the page (caption,
score, transcript) correctly describes B. That is a real cross post content
mixup, not a display glitch: the video element would play A's file under B's
metadata, with no visual signal anything is wrong.

This needs a fixture state this read cannot manufacture without a write
(downloading a video persists `videos.videoAssetId`, which this plan is not
allowed to trigger as a side effect). Marked needs fixture. Code reading verdict:
likely real bug, high severity if confirmed, since it silently shows the wrong
video rather than a wrong number.

### TC-VD-B1: Check for the VideoPlayer state leak using only pre-existing data (needs fixture)
Steps:
1. Browse `/feed?minScore=0` or a similarly wide filter, looking only at cards
   for `mediaType: "video"` posts, and open a few via Quick Preview to see
   whether any already show a playable video without ever clicking Download in
   this session (meaning `videoAssetId` was already set by a prior sync or
   download).
2. If such a post (A) exists, find its immediate neighbor in the detail page's
   prev/next rail that is also `mediaType: "video"` but shows the "Video not
   downloaded yet" gate (B).
3. Navigate from A to B using the "next" or "prev" control (in-app client
   navigation, not a fresh page load, is the part that matters) and observe
   whether B's panel still shows the gate or unexpectedly renders a playable
   video.
Expected, if the fixture exists: B still shows the "not downloaded yet" gate
(state correctly reset), or it shows A's video (confirms the bug). If no such
adjacent A/B pair exists in the current dev data, this case cannot run; leave it
as needs fixture and rely on the code reading verdict above.

### B2. CarouselViewer's slide index can start a new carousel mid way through
`carousel-viewer.tsx:85,89`: `index` is `useState(0)`, clamped via
`Math.min(index, lastIndex)` rather than reset by an effect. If a user pages
through post A's carousel to slide 3 of 5, then navigates next to post B, also a
carousel, reusing the same component instance, `index` still reads 3. If B has
at least 4 slides, it opens on slide 4 (index 3) instead of slide 1, and the
"4 / N" counter matches that state without telling the user anything jumped. If
B has fewer slides, `Math.min` clamps to B's last slide instead of its first,
same effect. Lower severity than B1 (a wrong position inside a post, not a
wrong post entirely), but the same root cause and the same missing key.

### TC-VD-B2: Carousel position carries over between two carousel posts (needs fixture)
Steps:
1. Find two carousel posts adjacent in the prev/next rail (both
   `mediaType: "carousel"`, at least one with 3 or more slides).
2. Open the first, click "Next item" inside the carousel viewer twice to reach
   slide 3 (or whatever the item count allows).
3. Use the page's own "next" control (not the carousel's) to move to the second
   carousel post.
Expected: the new post's carousel viewer opens on slide 1 ("1 / N"). If it opens
on slide 3 (or clamped to its own last slide), that confirms the leak. Needs two
adjacent carousel posts in the current dev data; if the synced fixture set is
mostly single video or photo posts, mark inconclusive rather than pass.

### B3. Tabs selection persisting across posts: expected, not a bug
`Tabs defaultValue="transcript"` (`video-detail.tsx:448`) has the same
missing-key situation, so switching to "Hook and structure" on post A and
hitting next keeps that tab open on post B instead of resetting to Transcript.
Given the page's own stated design goal, reading twelve posts in a row is the
daily loop (`video-detail.tsx:265-268`), staying on the same tab while paging is
plausibly intended, unlike B1 and B2 where the leaked state points at the wrong
content rather than a UI preference. No test case here, noted for context only.

## C. A post's own outlier score is a stale, sync time snapshot; its baseline bar recomputes live on every page load

`videos.outlierScore` is written exactly twice in the codebase, both inside the
sync engine (`src/server/services/sync-engine.ts:757,776`), and nowhere else.
Nothing recomputes it when a scoring setting changes.

`getChannelMedianBasis` (`src/server/queries/channels.ts:281-313`), which backs
`MedianBaseline`'s bar, histogram, and "1.0x = X views" line, recomputes fully
live on every request using `getScoringOptions()` (the current `app_settings`
row), the same call the sibling feed plan's `getMedianViews` doc comment
(`channels.ts:84-96`) describes fixing for exactly this reason: a displayed
baseline that disagrees with the baseline the scores were divided by is a bad
kind of wrong number, because both numbers look right on their own screen. That
fix covers the Channels page's median column. It does not cover
`videos.outlierScore` itself, which `MedianBaseline` (`median-baseline.tsx:74`,
`beatBaseline = score !== null && score >= 1`) renders as the large hero number
directly above the live `basis.median` bar.

If a scoring setting (baseline method, window, or minimum usable posts) is
changed in Settings after a video was last synced, the hero number and the
bar and histogram directly below it on the same screen would silently disagree:
one persisted from the last sync, one computed against the setting as it reads
right now, with nothing on the page distinguishing "as scored at sync time" from
"as measured right now." This is the same failure class the code already fixed
once elsewhere in this codebase, just not on this screen.

Changing a scoring setting is a state change this plan is not allowed to make.
Marked needs fixture, code reading verdict: likely real bug if the app has ever
had a scoring setting changed after an initial sync, otherwise dormant until
that happens. Not independently testable read-only; flagged for the record
rather than given a browser case.

## D. Median baseline bar draws a fabricated zero width fill for a null own-score, when the channel median itself is fine

`scoreVideosAgainstBaseline` (`src/server/services/outlier-calc.ts:144-149`) sets
a video's own score to null under two independent conditions: `baseline ===
null` (channel wide, every post in the channel gets null) or `v.viewCount ===
null` (this one post has no view count yet, for example freshly synced with
stats not pulled). These are independent: a channel can have a perfectly good
median from its other posts while one specific post's own `outlierScore` is null
because its view count has not landed yet.

`MedianBaseline` handles a null `basis.median` (not enough usable posts) with an
honest sentence (`median-baseline.tsx:84-94`), but it has no equivalent guard for
"basis.median is fine, but this post's own score is null." In that case the hero
number correctly shows a dash (`formatMultiplier(null)`, `format.ts:46-49`), but
the bar underneath does not: `median-baseline.tsx:105` computes `width:
${(score !== null ? scalePosition(score) : 0) * 100}%`, so a null score renders
as a 0 percent width fill, visually indistinguishable from a post that truly
scored at the very bottom of the 0.2x to 12x scale, the same "0 versus dash"
pattern flagged in the brief. Everything else in this section (the histogram
bars, the sample size copy) reads real data; only this one fill width fabricates
a value for a null input.

Needs a specific fixture: a post whose own `viewCount` or `outlierScore` is null
while its channel already clears `scoreMinUsablePosts` from other posts. Marked
needs fixture, code reading verdict: real bug, low to moderate severity (a
visual misrepresentation, not a wrong number rendered as text anywhere).

### TC-VD-D1: Look for a null score post on an otherwise scored channel (needs fixture)
Steps:
1. On `/channels`, find a channel whose median or outlier column is populated
   (has cleared the usable posts floor).
2. On `/feed?minScore=0` or wider, look for a post from that same channel with
   no outlier badge, a dash where a multiplier would be (per the feed plan, this
   is how a null scored post renders on a card).
3. Open that post's detail page and look at the median baseline bar under the
   hero score.
Expected, if such a post exists: the hero shows a dash, and the fill bar
directly below it should also read as "no data," not a bar drawn all the way to
the left edge. If the fill sits at the far left indistinguishable from a real
0.2x score, that confirms the finding. If no channel in the current dev data
has this combination (a null scored post alongside an otherwise usable
channel), mark needs fixture with no browser run possible, and rely on the code
reading verdict.

## E. "Similar outliers" has no outlier threshold of its own

`getSimilarOutliers` (`src/server/services/similar.ts:62-97`) ranks candidates
purely by tag overlap with the source video's analysis (`scoreSimilarity`, hook
type match worth 3, shared structure, format, and style tags worth 1 each), tie
broken by `outlierScore` descending, and requires only that a candidate has an
analysis row and is not soft deleted. There is no minimum score filter anywhere
in this query, unlike the feed's own default framing (Balanced: 5x, or Channels'
`2` via `OUTLIERS_30D_MIN_SCORE`, see the sibling feed plan's section C). A post
that scored well under 1x, below its own channel's baseline, can appear in a
"Similar outliers" row purely because it shares a hook type and two format tags
with the video being viewed, under a heading that specifically says "outliers."
This reads as a naming or framing mismatch rather than a data correctness bug:
the section is honestly a "similar analyzed posts" ranking, not a "similar
outlier posts" ranking, and nothing in the query claims otherwise once it is
read, but the heading text does.

### TC-VD-E1: A similar outlier with a sub-1x score
Steps:
1. Open the detail page for any analyzed video that has at least one entry in
   its "Similar outliers" row.
2. Read the outlier badge or score on each card in that row (compare against
   what counts as beating baseline from section C: `score >= 1`).
Expected note (informative, not a hard pass or fail on the current small
fixture set): if any card in the row shows a score under 1x, or a dash
(unscored), that confirms the row is not actually filtered to outliers despite
the heading. On a small dataset with few analyzed videos this may not be
reachable, since there may not be enough analyzed posts to expose a low scoring
one in the top five similarity matches; if every card in the row happens to be
1x or better, treat this as inconclusive rather than a pass, and rely on the
code read (no threshold exists in the query) as the standing verdict.

## F. Not found video: correct content, wrong HTTP status, a known and documented gap

`page.tsx:106-118` documents this directly: calling `notFound()` from both
`generateMetadata` and the page body renders the correct not-found content, but
the HTTP status code stays 200 in both `next dev` and a production build, a gap
the comment says was investigated and left unfixed within this task's scope.
This is not a silent bug in the sense of nobody knowing about it; it is
self-reported. Still worth a read-only confirmation pass, since the comment's
claim is falsifiable and the plan brief specifically calls it out.

### TC-VD-F1: A bad videoId renders not-found content
Steps:
1. Go to `/feed/does-not-exist-12345` (any id string not present in the videos
   table).
Expected: the page renders Next's not-found content (no crash, no stale or
blank shell), matching what `notFound()` produces elsewhere in the app (for
example `/channels/does-not-exist`, the same pattern the comment compares
itself against).

### TC-VD-F2: Confirm the status code gap via the network panel
Steps:
1. With the browser's network panel open (or an equivalent request inspector),
   reload `/feed/does-not-exist-12345`.
2. Read the status code of the top-level document request.
Expected per the code comment: 200, not 404, despite the not-found body. If the
status is 404, the comment is stale (perhaps fixed since it was written) and
this finding should be downgraded to "resolved, comment needs updating" rather
than a live gap.

## G. FEED_ORDER_LIMIT and the "post falls outside the resolved slice" fallback

`FEED_ORDER_LIMIT = 5000` (`page.tsx:47`) is the row cap `resolveFeedNav`
fetches to compute adjacency. Past that many tracked posts, a post can fall
outside the slice and `resolveFeedNav` returns `{ prevHref: null, nextHref:
null, indexLabel: null }` (`page.tsx:76-81`) rather than a fabricated position,
which is the correct, documented choice per the comment at `page.tsx:39-46`.
Not reachable on the current one person, single Mac fixture (a few dozen to low
hundreds of posts at most), so this is a design note confirmed correct by
reading, not a candidate that needs a browser pass. Left here for the record,
matching how the sibling plan carries forward non-exercisable findings rather
than dropping them.

## Checked and found safe (no test case needed)

A few areas from the brief read clean on inspection, noted briefly so this pass
shows its work rather than silently skipping them:

- `MetricChips` (`metric-chips.tsx:17-29`): engagement rate is null guarded on
  `viewCount`, `likeCount`, and `commentCount` all independently, rendering a
  dash rather than a fabricated `0%` when any input is missing or `viewCount` is
  zero. Matches the "never a fabricated 0" convention used elsewhere in this
  codebase's number formatting.
- `copyTranscript`, `copyLink`, and `createPrompt` (`video-detail.tsx:285-321`):
  all three wrap `navigator.clipboard.writeText` in a try/catch with an explicit
  error toast on rejection, so a clipboard failure (denied permission, insecure
  context) surfaces to the user instead of failing silently. `copyTranscript`
  also guards `if (!detail.transcript) return;` before touching `.text`, so it
  cannot throw on a video with no transcript yet.
- `SavePostButton`'s "Keep this post" action (`save-post-button.tsx:49-64`): a
  double submit (for example two open tabs) is not a silent no-op,
  `createSavedPostAction` checks for an existing row first and returns a
  distinct `SAVED_POST_ALREADY_SAVED` error the button surfaces via toast,
  rather than creating a duplicate row or failing quietly.
- `AnalysisGate` (`video-detail.tsx:67-127`): the four state gate (no transcript
  and no provider, no transcript but transcribable, transcript but no key, or
  ready to analyze) reads as a complete, mutually exclusive set with no fifth
  unhandled combination, matching the doc comment's own enumeration.

## Summary

Nine numbered bug candidates came out of this read. One (section A, prev/next
ignoring the active filter on every real click path) is fully confirmed by
static reading of every navigation entry point into this route and needs no
fixture to verify, covered by TC-VD-A1 through TC-VD-A3. Four more (B1 the
VideoPlayer state leak, B2 the CarouselViewer state leak, C stale score versus
live baseline, D the fabricated zero-width fill) are credible on the same
evidence standard but need dev-DB states or a settings write this plan is not
allowed to create, so each carries a code reading verdict and, where possible, a
best-effort browser case marked needs fixture. One (E, similar outliers has no
threshold) is a framing or naming issue rather than a correctness bug, with a
browser case that may come back inconclusive on a small dataset. Two (F, the
200 status gap, and G, the 5000 row cap) are already self-documented in the
code and get confirmation-only or record-only treatment. Total: nine bug
candidates, eight browser test cases (TC-VD-A1, TC-VD-A2, TC-VD-A3, TC-VD-B1,
TC-VD-B2, TC-VD-D1, TC-VD-E1, TC-VD-F1, TC-VD-F2, nine cases in all; C and G are
carried forward without a case since neither is independently exercisable
read-only).

No app code was changed, no browser was opened, and nothing was committed while
writing this plan.

## Verification, code + DB, 2026-08-01

Read-only pass against the running code and `data/crowsnest.db` (sqlite3, SELECT
only). No browser opened, no app code edited, no writes to the DB, nothing
committed. Where a candidate is a pure code-logic claim (React reconciliation,
a missing guard, an unconditional query), the verdict is CONFIRMED once the
logic is unambiguous by reading, the same standard section A itself uses. Where
the claim needs live data, a SQL query against the same predicate the code
uses is quoted. Where only a running renderer or network panel can settle it,
it is marked NEEDS BROWSER.

Current fixture size: 42 rows in `videos` (`SELECT count(*) FROM videos;`),
none soft deleted. `app_settings` holds `score_baseline_method=median`,
`score_baseline_window=last12Posts`, `score_min_usable_posts=5`,
`score_min_views_floor=0`, and a `saved_filters` row named "Balanced" with
criteria `{"minScore":5,"sinceDays":30}`.

### Section A: prev/next ignores the active filter

**Verdict: CONFIRMED.**

Every navigation entry point reads as claimed:
`src/components/feed/feed-grid.tsx:19,41,58` wires both card variants to
`setPreviewId` (local state), never a `Link` or `router.push` with a query
string. `src/components/feed/quick-preview-sheet.tsx:111` builds
`href={\`/feed/${detail.item.videoId}\`}` with nothing appended.
`src/components/video/video-detail.tsx:224` calls
`router.push(\`/feed/${id}\`)`, same shape. `resolveFeedNav`
(`page.tsx:64-89`) and `buildFeedFilters` (`page.tsx:49-62`) only ever see
`searchParams`, so with no code path ever attaching one, `sp` is `{}` and
`buildFeedFilters` resolves every condition to `undefined`.

DB evidence for TC-VD-A1 and TC-VD-A2: the Balanced default
(`minScore>=5 AND posted_at within 30 days`) matches exactly one row today:

```
SELECT id, outlier_score, posted_at FROM videos
WHERE outlier_score >= 5 AND posted_at >= datetime('now','-30 days')
  AND deleted_at IS NULL;
-- a0ed7179-1b66-4f2e-90c9-03e81429f9fc | 10.1 | 2026-07-09T17:41:24Z
```

`resolveFeedNav`'s own default order (`sort: "score"`, `buildOrderBy` in
`src/server/queries/feed.ts:200-211`, sorted by `outlier_score IS NULL` then
`outlier_score DESC`) puts that same video at position 1 of 42:

```
SELECT ROW_NUMBER() OVER (ORDER BY (outlier_score IS NULL), outlier_score DESC) pos, id
FROM videos ORDER BY pos LIMIT 2;
-- 1 | a0ed7179-...  (the Balanced match)
-- 2 | 6c3442d5-...  (score 2.3, not in the Balanced result set)
```

So TC-VD-A1's expected outcome is exactly what the data produces: opening the
one Balanced card would show `indexLabel` "1 of 42", not "1 of 1", and
TC-VD-A2's "next" would land on `6c3442d5-b290-4c36-9203-559b7a28789d`, a post
that never cleared the 5x/30-day filter. TC-VD-A3 is also CONFIRMED by
reading: `buildFeedFilters` maps `sp.minScore`/`sp.since` through to
`getOutlierFeed` the same way `resolveFeedCriteria`
(`src/lib/feed-filters.ts:92-103`) does for the feed page itself, so a hand
typed `?minScore=5&since=30` on `/feed/<id>` resolves correctly; the bug is
specifically the missing forwarding, not broken resolution logic. Rendering
the actual numbers on screen is unexercised here (no browser), but every
number the browser would show is already pinned down by the query above.

### Section B: client state leaking across a videoId change

**B1 (VideoPlayer's downloaded asset state), verdict: CONFIRMED.**
`src/components/video/video-player.tsx:57` declares
`downloadedAssetId = useState<string | null>(null)`, set only inside
`download()` (line 83, `setDownloadedAssetId(result.assetId)`).
`video-detail.tsx:371-376` renders `<VideoPlayer videoId={item.videoId} ... />`
with no `key` prop, and the surrounding tree is structurally identical
between two `mediaType: "video"` posts, so React reconciles rather than
remounts on a prev/next navigation, per React's own component-identity rules,
nothing app-specific to verify live. `resolvedAssetId = videoAssetId ??
downloadedAssetId` (line 60) will therefore read a stale `downloadedAssetId`
for the new video whenever its own `videoAssetId` prop is null. This is a
code-logic bug, not a data-dependent one: it is not reachable from
pre-existing DB state alone, because `downloadedAssetId` only ever gets set
by an in-session, user-clicked `download()` call, which this read-only pass
is not allowed to trigger (a write to `videos.videoAssetId`). DB fixture
check: positions 1 and 2 of the default feed order are both `mediaType:
"video"` (`a0ed7179...`, `video_asset_id` already set from a prior sync, and
`6c3442d5...`, `video_asset_id` null), but that pair does not exercise the
bug, since `a0ed7179`'s asset comes from the `videoAssetId` prop, never from
`download()`, so `downloadedAssetId` stays null and the gate on `6c3442d5`
would correctly show. TC-VD-B1 as written needs an actual Download click to
reproduce, which is out of scope for this pass; leaving the numbered finding
CONFIRMED on code, the test case itself NEEDS BROWSER (and a write this task
cannot perform).

**B2 (CarouselViewer's slide index), verdict: CONFIRMED**, same reasoning:
`src/components/video/carousel-viewer.tsx:85` is `useState(0)`, clamped by
`Math.min(index, lastIndex)` (line 89) rather than reset, and
`video-detail.tsx:369-370` renders `<CarouselViewer items={detail.children} />`
with no key, same missing-remount issue as B1. Unlike B1, this one needs no
write to reproduce: paging a carousel is pure client state. TC-VD-B2 fixture
exists in current data, six carousel posts sit back to back in the default
feed order:

```
SELECT ROW_NUMBER() OVER (ORDER BY (outlier_score IS NULL), outlier_score DESC) pos, id
FROM videos WHERE media_type='carousel' ORDER BY pos;
-- position 35: 1d9c715c-1044-4419-aa23-c32762491c7a (7 slides)
-- position 36: 02c86bcc-bcb3-4018-9776-1313e3298f2a (7 slides)
-- position 37: 008b3e16-92b0-426d-b61f-800ec866c1a1 (7 slides)
-- position 38: 59506aba-a775-435e-b7db-225e719794c7 (7 slides)
-- position 39: 0760ca18-e70f-4a30-9f48-ad9c211fc147 (7 slides)
-- position 40: 824b6bc1-6ea6-4bfc-9a6a-f7497ff6f213 (8 slides)
```

(slide counts from `SELECT video_id, count(*) FROM video_children GROUP BY
video_id;`). Any consecutive pair here, for example open
`1d9c715c-1044-4419-aa23-c32762491c7a`, advance to slide 3, click the page's
"next" to `02c86bcc-bcb3-4018-9776-1313e3298f2a`, gives a live, read-only
run of TC-VD-B2 with no fixture gap. NEEDS BROWSER only for the visual
confirmation; the code path itself is CONFIRMED. Note the tie order among
equal (null) `outlier_score` rows is whatever SQLite happens to return since
`buildOrderBy` has no explicit third sort key, so this exact position
numbering is a snapshot, not a guarantee, though the adjacency itself
(six carousels grouped together) held on every run during this check.

**B3 (Tabs selection persisting), verdict: not a bug candidate**, as the plan
itself already states, no verdict needed. Confirmed by reading that
`Tabs defaultValue="transcript"` (`video-detail.tsx:448`) has the same
missing-key situation as B1/B2, carried here only for completeness.

### Section C: stale outlierScore vs live baseline

**Verdict: NOT REPRODUCED against current data; the code mechanism itself is
real and dormant.**

`grep -rn "outlierScore" src/server` confirms the only two writers of
`videos.outlier_score` are `src/server/services/sync-engine.ts:757` and
`:776`, both inside the sync engine, matching the citation exactly.
`getChannelMedianBasis` (`src/server/queries/channels.ts:281-316`) does
recompute live from `getScoringOptions()` on every call, also as claimed.
Whether the two currently disagree is answerable from data: recomputing
every channel's baseline under the current `app_settings` row
(`method=median`, `window=last12Posts`, `minUsable=5`) and comparing to the
stored `outlier_score` for all 42 rows found zero mismatches, every stored
score matches what a live recompute produces right now. That means this
install has not changed a scoring setting since its last sync, so the drift
the finding describes is not currently observable, exactly the caveat the
plan's own writeup already carries ("dormant until that happens"). The bug
is real (nothing recomputes `outlier_score` when a setting changes, and nothing
on the page marks it as sync-time), it just is not showing wrong numbers on
this dataset today.

### Section D: fabricated zero-width fill for a null own-score

**Verdict: CONFIRMED, and a live fixture exists.**

`src/server/services/outlier-calc.ts:144-149` sets a video's score to null on
`baseline === null` or `v.viewCount === null`, independently, as claimed.
`median-baseline.tsx:105` computes
`width: ${(score !== null ? scalePosition(score) : 0) * 100}%`, so a null
score is indistinguishable from a real 0.2x-scale post, a plain reading of
the ternary, not something that could render differently live. The
fixture the plan says it could not manufacture already exists in this DB:
recomputing each channel's live baseline and cross-referencing against posts
with a null `outlier_score` turns up channel `@kallaway`, whose live baseline
(224403.5) clears `score_min_usable_posts=5`, with two posts that have both
`view_count` and `outlier_score` null:

```
-- videos 9b31c636-3110-4f2a-b275-6a12d542b881 and
-- 3d287b3b-20d1-4e2e-a3b0-2e8b23d722fd, channel @kallaway,
-- view_count NULL, outlier_score NULL, channel baseline 224403.5 (usable)
```

Opening either post's detail page is the exact TC-VD-D1 setup with no state
change needed: the hero shows a dash (`formatMultiplier(null)`,
`src/lib/format.ts:46-49`), and per the ternary above the bar underneath would
sit at the left edge indistinguishable from a genuine 0.2x post. Marked
NEEDS BROWSER only to see the pixels; the underlying arithmetic is already
CONFIRMED by code plus this data.

### Section E: "Similar outliers" has no threshold

**Verdict: CONFIRMED, and reachable in current data (not inconclusive).**

`src/server/services/similar.ts:62-97` confirmed as described: no minimum
score anywhere in the query, ranked by `scoreSimilarity` then
`outlierScore` descending, only requirement is an analysis row and
`deletedAt IS NULL`. Only three videos have an analysis row today
(`SELECT count(*) FROM video_analyses;` = 3):
`a68a0361...` (score 1.1), `ed0022ae...` (`outlier_score` NULL), and
`a0ed7179...` (score 10.1). Since each of the three excludes only itself and
the other two both qualify (both have an analysis row and neither is
deleted), opening the detail page for either `a68a0361...` or `a0ed7179...`
puts `ed0022ae...` in the "Similar outliers" row, a candidate with a NULL
`outlier_score`, rendered as a dash by the same `formatMultiplier`
(`src/lib/format.ts:46-49`) TC-VD-E1 itself points at, under a heading that
says "outliers." This is not the "may be inconclusive on a small dataset"
case the plan hedges on; the current three-row fixture already produces it.
NEEDS BROWSER only to see the badge rendered, the query result itself already
settles the finding.

### Section F: not-found status code

**F1 and F2, verdict: NEEDS BROWSER.** `page.tsx:106-118` reads exactly as
quoted, a self-documented comment describing content-correct,
status-incorrect behavior for both `generateMetadata` and the page body
calling `notFound()`. `SELECT id FROM videos WHERE id='does-not-exist-12345';`
returns no row, so the route's `!detail` branch is guaranteed to fire, but
whether the rendered content and the actual HTTP status match the comment's
claim is a rendering and network-panel question this read-only, no-browser
pass cannot settle. Nothing in the code read contradicts the comment; no
reason found to downgrade it to stale.

### Section G: FEED_ORDER_LIMIT and the out-of-slice fallback

**Verdict: NOT REPRODUCED, confirmed correct and confirmed unreachable.**
`FEED_ORDER_LIMIT = 5000` at `page.tsx:47` and the `{ prevHref: null,
nextHref: null, indexLabel: null }` fallback at `page.tsx:76-81` read exactly
as described. `SELECT count(*) FROM videos;` returns 42, far under the
5000-row cap, so this path is not reachable on the current fixture, matching
the plan's own "design note confirmed correct by reading" framing. No browser
case needed or possible.

### Summary

Counts: 6 CONFIRMED (Section A as a whole plus TC-VD-A1/A2/A3, B1, B2, D, E),
2 NOT REPRODUCED (C against current data, G by design and by row count),
4 NEEDS BROWSER for pixel-level confirmation only (TC-VD-B1 additionally
needs a write this task cannot perform, TC-VD-B2 and TC-VD-D1 are read-only
executable with the ids above, F1/F2 need a live request).

No app code was changed, `data/crowsnest.db` was only read (SELECT), no
browser was opened, and nothing was committed while writing this
verification.

## Browser verification

Read-only pass against the running app at `http://localhost:3000`, using the
same fixture ids the code-reading verification above already pinned down. No
Download click, no saves, no settings writes.

**Finding A (prev/next drops the active filter): SEEN.**
Went to `/feed` bare, confirmed 1 result (`a0ed7179...`, 10.1x, @kallaway).
Opened the card, clicked "Open full page", landed on
`/feed/a0ed7179-1b66-4f2e-90c9-03e81429f9fc`. The index label read "1 of 42",
not "1 of 1" as it would if the filter had carried through. Pressed the next
control once and landed on `/feed/6c3442d5-b290-4c36-9203-559b7a28789d`,
index now "2 of 42", a post scored 2.3x, below the 5x+ filter and not part of
the original 1-result set. Matches the predicted ids from the code-reading
pass exactly (`a0ed7179` at position 1, `6c3442d5` at position 2). Screenshot:
`finding-A-next.png`.

**Finding B2 (carousel slide-index leak): NOT SEEN.**
Opened `/feed/1d9c715c-1044-4419-aa23-c32762491c7a` (position 35, 7 slides),
advanced its carousel to slide 3 ("3 / 7") via the "Next item" control, then
used the page's own next control to move to
`/feed/02c86bcc-bcb3-4018-9776-1313e3298f2a` (position 36, also 7 slides).
The new post opened on "1 / 7", not the carried-over "3 / 7". Repeated the
same steps three times (twice via the arrow-key shortcut, once via an
explicit click on the "next" button) and got a clean reset to slide 1 every
time.

This contradicts the code-reading verdict above, which called B2 CONFIRMED
on the grounds that `CarouselViewer` (`carousel-viewer.tsx:85,89`) has no key
prop and its `index` state is clamped rather than reset. That reasoning holds
for React reconciliation within a stable component tree, but `/feed/[id]` is
a dynamic route segment rendered by a Next.js App Router page, and pages
remount on a dynamic-segment change rather than reconciling in place, which
resets all local state under them regardless of key props. The missing-key
issue in the code is real, but the route boundary appears to mask it in
practice for prev/next navigation. B1 (VideoPlayer's downloaded-asset state)
likely has the same route-remount mitigation, though that one still needs an
actual Download click to check, which stays out of scope here.
