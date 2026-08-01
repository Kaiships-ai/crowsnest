# Channels page deep test plan, 2026-08-01

Read-only code audit of `src/app/(shell)/channels/page.tsx`,
`src/app/(shell)/channels/[channelId]/page.tsx`, the components under
`src/components/channels/`, and `src/server/queries/channels.ts`, modeled on
`docs/qa/2026-08-01-feed-deep-test-plan.md`. Two things already known and
already fixed are intentionally excluded from the findings below: the
median-views dash below `score_min_usable_posts` (5) is correct behavior, and
the "Outliers (30d)" column's 2x cutoff now has a tooltip explaining it
against Feed's separate 5x default. This plan hunts for other silent bugs.

Seven real candidates came out of the same read, all with file:line. Every
test case below is read-only against `http://localhost:3000`. No channel is
added or removed; the Add channel dialog is opened and closed, never
submitted. Cases needing state the current fixture (3 channels: @kallaway
with about 46 posts with views, @nateherkai and @kaiships.ai with posts but
zero of them carrying a view count, plus a possible @hormozi with zero posts)
does not have are marked "needs fixture" with a code-reading verdict instead
of a browser step.

## Bug candidates found by reading the code

1. **The channel detail page shows a sample size it never actually uses.**
   `getChannelMedianBasis` (`channels.ts:281-316`) is called at
   `[channelId]/page.tsx:60` and returns `sampleSize`, the real count of posts
   the baseline was computed over after trimming to the configured
   `scoreBaselineWindow` (default `last12Posts`, `settings/index.ts:141-143`).
   But the page never reads that number for display. Instead it computes a
   second, different count at line 67: `Math.min(detail.videos.filter(v =>
   v.viewCount !== null).length, 20)`, a hardcoded cap of 20 that has nothing
   to do with the actual window (12 posts by default, or 30 days, or all
   history depending on the setting). That wrong number is what the "Median
   views" sub-caption (line 90), the progress bar width (line 122), and its
   caption (lines 126-128) all show. A channel with more measured posts than
   the real window size will show a sample count that is too high and does
   not match what actually fed the median.

2. **Two call sites hardcode the outlier cutoff instead of importing
   `OUTLIERS_30D_MIN_SCORE`.** `[channelId]/page.tsx:53` (`outliersOnly`) and
   `outlier-history-chart.tsx:60` (`outlierCoords`) both write the literal
   `2` rather than importing the constant from `src/lib/outlier-constants.ts`
   the way `channel-table.tsx:23,42` already does. Same class of drift risk
   the M4 branch review fixed for the table header; these two spots were
   missed. Both happen to equal 2 today, so there is no visible symptom yet,
   only a landmine for the next person who changes the constant.

3. **The "Outliers Only" tab and the "Outliers, 30d" stat tile above it
   disagree about what "outlier" means, on the same screen.** The stat tile
   (`[channelId]/page.tsx:98`) reads `detail.stats.outliers30d`, which comes
   from `countOutliers30d` (`channels.ts:104-118`): scored 2x or higher,
   posted in the last 30 days, live posts only (`isNull(deletedAt)`). The
   "Outliers Only" tab (line 156) renders `outliersOnly` (line 53), which is
   `detail.videos.filter(v => v.outlierScore !== null && v.outlierScore >=
   2)`, no time window at all, and `detail.videos` includes removed
   (`deleted: true`) posts (`getChannelDetail`'s doc comment,
   `channels.ts:41-45`). So the tab can show more items than the stat tile
   claims exist, including posts Instagram has since taken down, with no
   label saying the tab is unwindowed. This is worse than the already-known
   Feed vs Channels parity gap because both numbers sit on the same page.

4. **A deleted or made-up fleet id in `?fleet=` renders exactly like a real,
   empty fleet, and the rail highlights nothing.** `channels/page.tsx:17-19`
   only calls `getChannelsList(fleetId)` when `fleetId` is truthy, and
   `getChannelsList` (`channels.ts:150-161`) for the fleet-scoped path does
   an inner join through `fleetChannels`; a `fleetId` matching zero rows
   returns `[]`, not `null`. Line 20's `const channels = scopedChannels ??
   allChannels` never falls back, because `[]` is not nullish. The page then
   renders "No channels in this fleet yet" (`channel-table.tsx:148`), which
   is indistinguishable from visiting a real, legitimately empty fleet.
   Meanwhile `FleetRail` (`fleet-rail.tsx:36-45`) only highlights "All
   channels" when `!activeFleet`, and only highlights a real fleet row when
   its id matches; a garbage id matches neither, so no row in the rail is
   highlighted at all. Nothing on the page tells the user the fleet id in
   the URL does not exist.

5. **`getChannelsList` has no `ORDER BY` in either code path**
   (`channels.ts:150-161`). The unscoped branch is a plain `select()` off
   `channels`; the fleet-scoped branch is a join through `fleetChannels`.
   Neither specifies a sort column, so row order is whatever SQLite happens
   to return, not a defined business sort (not alphabetical, not by
   followers, not by last synced). There is also no sort control anywhere in
   the Channels UI, unlike Feed's `sort=score/recent/views`. Dedupe itself is
   safe: `fleetChannels` has a composite primary key on `(fleetId,
   channelId)` (`schema.ts:80-83`), so a channel cannot appear twice in one
   fleet's join.

6. **A channel with posts but zero of them carrying a measured view count
   gets a bare, unexplained dash in the table.** `channel-table.tsx:203-204`
   only sets `thin = true` when `sampleSize > 0`; a channel whose usable
   (viewed) sample is exactly zero, which is the live state of both
   @nateherkai and @kaiships.ai right now, falls through with no "thin
   sample" note (lines 256-261 never render) and no never-synced hatch
   either (since these channels have synced). The row just shows a normal
   "Synced N ago" health label next to a dash, with nothing explaining why.
   The detail page for the same channel state is more honest: its progress
   bar (`[channelId]/page.tsx:125-129`) always renders "0 / 5 posts before a
   score appears" for the identical case.

7. **`/channels/does-not-exist` has no dedicated not-found screen.** No
   `not-found.tsx` exists anywhere under `src/app` (checked directly). The
   `notFound()` call at `[channelId]/page.tsx:51` therefore falls through to
   Next's generic built-in 404 page, not a "Channel not found, back to
   Channels" screen consistent with the rest of the app's empty and error
   states (compare the deliberately worded empty states in
   `channel-table.tsx` and `channel-video-grid.tsx`).

## A. Table row correctness

### TC-CH-A1: A channel with zero measured posts shows an unexplained dash
Steps:
1. Go to `/channels`.
2. Find the @nateherkai or @kaiships.ai row.
Expected: the "Median views" cell is a dash and the health label reads
"Synced N ago" (not "Never synced," since these channels have synced
before). No thin-sample note appears under the handle. Per finding 6, this
is a gap: the row gives no reason for the dash, unlike a channel with 1 to 4
measured posts, which would show "Only N posts, a median needs about 10
before its scores mean anything."

### TC-CH-A2: Row order is not guaranteed stable across reloads
Steps:
1. Go to `/channels`, record the top-to-bottom channel order.
2. Reload the page (full navigation, not client-side), record the order
   again.
Expected note both outcomes as informative: per finding 5, nothing in
`getChannelsList` orders the result, so a stable order across two loads is
only an accident of SQLite's default row return order, not a guarantee. If
the order changes between loads, that confirms the gap directly. If it
stays the same, that is consistent with (but does not prove the absence of)
the missing `ORDER BY`, since a single-table scan with no writes in between
commonly returns rows in a stable order anyway.

### TC-CH-A3: Fleet-scoped view can show the same channels in a different order than All channels
Steps:
1. Go to `/channels`, record the order of channels that belong to any one
   fleet with 2 or more members.
2. Click that fleet in the rail, record the order shown there.
Expected: needs fixture if no fleet with 2+ channels currently exists (mark
inconclusive and note that from the code alone, the fleet-scoped path is a
join through `fleetChannels` while the unscoped path is a plain table scan,
so there is no reason the two would agree on order; only a fleet with
enough members can expose a mismatch, if there is one to see with the
default engine).

## B. Fleet rail scoping

### TC-CH-B1: A fleet id that does not exist renders as a normal, empty fleet
Steps:
1. Go to `/channels?fleet=this-fleet-does-not-exist`.
2. Look at the rail: is any row (including "All channels") highlighted?
3. Look at the main panel's summary line and table.
Expected per finding 4: the table shows "No channels in this fleet yet" (via
`channel-table.tsx:148`), the top summary line still reads based on the
(now empty) scoped channel list, and no row in the fleet rail is
highlighted, not even "All channels." Nothing on the page indicates the
`fleet` param does not correspond to a real fleet; a user landing here from
a stale bookmark or a deleted fleet would have no way to tell this apart
from a real, empty fleet.

### TC-CH-B2: All channels total in the rail matches the unscoped table
Steps:
1. Go to `/channels` (no fleet param).
2. Compare the number next to "All channels" in the rail against the number
   of rows in the table and the summary line's channel count.
Expected: all three numbers agree (3, per the current fixture). This is the
control case confirming the rail's count and the table's row count read the
same underlying list, so a mismatch here would point at something more
basic than findings 4 or 5.

## C. Outlier definitions within one page

### TC-CH-C1: List column and detail stat tile agree for the same channel
Steps:
1. Go to `/channels`, read @kallaway's "Outliers (30d)" number.
2. Go to `/channels/<kallaway's id>`, read the "Outliers, 30d" stat tile.
Expected: the two numbers match exactly, since both call
`countOutliers30d` (`channels.ts:104-118`) with the same 2x, 30-day,
live-only definition. This is the control case: if they disagree, that is a
more basic bug than finding 3 below.

### TC-CH-C2: The "Outliers Only" tab count does not have to match the stat tile above it
Steps:
1. On @kallaway's detail page, note the "Outliers, 30d" stat tile number
   from TC-CH-C1.
2. Click the "Outliers Only" tab and count the cards shown.
Expected per finding 3: the tab is not bounded to 30 days and (per
`detail.videos`'s doc comment) does not exclude removed posts, while the
stat tile is bounded to 30 days and excludes removed posts. If @kallaway has
any 2x+ post older than 30 days, or any removed 2x+ post, the tab's count
will exceed the stat tile's, with nothing on the tab labeling it as a
different, wider window. If the two happen to match today, that only means
@kallaway currently has no posts outside the 30-day window scoring 2x or
higher, not that the underlying logic agrees; re-check this case after any
future sync extends the post history.

### TC-CH-C3: A removed post can appear in "Outliers Only" but never in the 30-day stat (needs fixture)
Steps:
1. Would require a channel with a post marked `deleted_at` that also scores
   2x or higher.
Expected: needs fixture. Verdict from code alone (finding 3):
`getOutlierFeed` is called with no filter that drops deleted posts
(`feed.ts`'s `buildWhere` comment: "Deleted posts are NOT excluded here"),
and `outliersOnly` at `[channelId]/page.tsx:53` applies no `!v.deleted`
check either, so such a post would render in the tab. `countOutliers30d`
would never count it, since it filters `isNull(deletedAt)`. No such fixture
exists in the current 3-channel dataset to exercise this directly.

## D. Median sample size vs the real baseline window

### TC-CH-D1: The detail page's post count does not match the configured baseline window
Steps:
1. Go to `/settings#scoring`, read the current "Baseline window" value
   (one of "Last 12 posts," "Last 30 days," "All history") without changing
   it.
2. Go to `/channels/<kallaway's id>` (about 46 posts with views, well above
   any of those window sizes).
3. Read the "Median views" sub-caption ("of N posts") and the progress bar
   caption ("score active, based on the last N posts").
Expected per finding 1: if Settings reads "Last 12 posts" (the fresh-install
default, `settings/index.ts:141-143`), the true sample behind the median is
12 posts, but the detail page's `usableForScore` (`[channelId]/page.tsx:67`)
is a hardcoded `min(measured posts, 20)`, unrelated to the configured
window. With about 46 measured posts, expect the page to display "of 20
posts" and "based on the last 20 posts," a number neither Settings' window
nor any other on-page figure actually confirms is what the median was
computed from. If Settings instead reads "All history," the mismatch is
even larger (46 vs. the displayed 20). Either way, the displayed count and
the real window should be compared and flagged as disagreeing unless they
happen to coincide (window set to a value >= 20, e.g. an edited "Last 30
days" combined with fewer than 20 total measured posts).

## E. Add channel dialog, opened and closed only

### TC-CH-E1: Opening and closing the dialog on the handle tab has no side effect
Steps:
1. Go to `/channels`.
2. Click "Add channel."
3. Confirm the "By handle" tab is selected by default and type a few
   characters into the handle field, without clicking "Track channel."
4. Close the dialog (Escape key or its close control), not the submit
   button.
5. Reload `/channels`.
Expected: the dialog closes without any network mutation; the channel
table's row count and contents after reload are unchanged from before step
2. This is the control confirming the dialog is safe to open for
inspection without tracking a real channel.

### TC-CH-E2: Switching to "Paste reel URL" and back, then closing, has no side effect
Steps:
1. From the open "Add a channel" dialog, click the "Paste reel URL" tab.
2. Type a placeholder value into the Reel URL field, without clicking
   "Import reel."
3. Switch back to the "By handle" tab.
4. Close the dialog.
Expected: switching tabs clears any inline error state (per
`add-channel-dialog.tsx`'s `onValueChange` handler) and neither tab's
pending input survives as a submitted record. The channels list is
unchanged after reload, same control as TC-CH-E1.

## F. Channel detail not-found path

### TC-CH-F1: Visiting an unknown channel id
Steps:
1. Go to `/channels/does-not-exist`.
Expected per finding 7: since no `not-found.tsx` exists anywhere under
`src/app`, this renders Next's generic built-in "This page could not be
found" screen, not a Channels-branded "Channel not found" message with a
link back to `/channels`. Note whether the generic page at least keeps the
app's shell chrome (topbar, sidebar) or replaces the whole screen; either
way, flag the missing custom empty state as a real gap against the care
taken elsewhere in this codebase's empty-state copy.

## G. Zero-post and never-synced differentiation

### TC-CH-G1: The list table gives less explanation than the detail page for the same zero-sample state
Steps:
1. Go to `/channels`, note @kaiships.ai's row (health label and median
   dash), from TC-CH-A1.
2. Go to @kaiships.ai's detail page, read the progress bar caption near the
   "Reach by post" section.
Expected per finding 6: the detail page's progress bar explicitly reads "0 /
5 posts before a score appears" (or the current `scoreMinUsablePosts`
value), while the table row for the same channel and the same underlying
fact (zero measured posts) shows nothing beyond a plain dash. The two
screens describe the identical state with very different levels of honesty.

### TC-CH-G2: A channel that has synced but truly has zero posts, versus one never synced (needs fixture)
Steps:
1. Would require confirming whether @hormozi (if present) has `lastSyncedAt`
   set with zero rows in `videos`, versus `lastSyncedAt` still null.
Expected: needs fixture verification of which state @hormozi is actually
in before this is a clean test. If `lastSyncedAt` is set and `videos` is
truly empty, expect the same gap as TC-CH-A1/G1: a "Synced N ago" label
with an unexplained dash, no hatch pattern (hatch only applies when
`lastSyncedAt === null`, `channel-table.tsx:198,221-229`). If instead
`lastSyncedAt` is null, expect the intended, already-correct never-synced
hatch and label, in which case this is not a distinct finding, only a
confirmation that finding 6 needs a synced-but-empty fixture specifically,
not merely a low-post-count one.

## H. Null formatting controls

### TC-CH-H1: Never-synced channel formatting is consistent
Steps:
1. If any channel in the current list shows "Never synced," read its
   Followers and Median views cells.
Expected: both cells show a plain dash (`formatCompact(null)`), the row
carries the hatched background, and the "Outliers (30d)" cell also shows a
dash rather than "0," per `channel-table.tsx:282-286`'s explicit
`lastSyncedAt === null ? "-" : channel.outliers30d` branch (a real zero is
only shown once a sync has actually looked). If no never-synced channel
exists in the current fixture, mark this needs fixture and rely on the code
citation above as the verdict.

## Verdict

Seven candidates, all grounded in file:line reads, none independently
confirmed by a browser pass in this session (none was run, per scope). In
rough order of user visibility: the outlier-definition split on the channel
detail page (finding 3) and the fake-empty-fleet state (finding 4) are the
two most likely to visibly confuse a real user first; the sample-size
mismatch (finding 1) is the most likely to quietly misinform without ever
looking wrong; the missing table-row explanation for a zero-measured
channel (finding 6) and the generic 404 (finding 7) are smaller, honest
polish gaps; the two hardcoded `2`s (finding 2) and the missing `ORDER BY`
(finding 5) are maintainability risks more than active symptoms today.

No app code was changed, no channel was added or removed, and no browser
was opened to produce this document.

## Verification, code + DB, 2026-08-01

Read-only pass against the current checkout and `data/crowsnest.db` (sqlite3,
SELECT only). No app code was edited, no DB row was written, no browser was
opened. Fixture note up front: the database now holds four channels, not
three. `@hormozi` is present, has `last_synced_at` set
(`2026-08-01T04:59:34.120Z`), and has zero rows in `videos`. `@kallaway` now
has 10 total videos and 8 carrying a view count, not "about 46 posts with
views" as the plan assumed when it was written; the other numbers below are
checked against the fixture as it stands today, and that shift changes what a
couple of the browser test cases would show.

1. **Sample size shown does not match the real baseline window. CONFIRMED.**
   Verified `getChannelMedianBasis` at `channels.ts:281-316`, called from
   `[channelId]/page.tsx:60`, and the hardcoded `Math.min(..., 20)` at
   `[channelId]/page.tsx:67`, feeding the sub-caption at line 90, the bar
   width at line 122, and the caption at lines 126-128, exactly as described.
   `settings/index.ts:141-143` confirms the fresh-install default is
   `last12Posts`. This is a real, unconditional defect: the 20-post cap has
   no relationship to the configured window. Caveat for the browser test
   case (TC-CH-D1): with the fixture as it stands today, `@kallaway` has
   only 8 measured posts (`SELECT channel_id, count(*) FILTER (WHERE
   view_count IS NOT NULL) FROM videos WHERE channel_id =
   '625b12e4-d96b-42e2-a8b8-baa936a58972'` -> 8 of 10), so
   `min(8, 20) = 8` happens to equal the real windowed sample
   `min(8, 12) = 8` under `last12Posts`. Loading the page today would show
   matching numbers by coincidence, not because the bug is fixed. The
   mismatch needs a channel with more than 20 measured posts (or a
   `last30Days`/`allHistory` window pulling in more than 20) to become
   visible again; no channel in the current fixture qualifies.

2. **Two call sites hardcode `2` instead of importing `OUTLIERS_30D_MIN_SCORE`.
   CONFIRMED.** Verified `[channelId]/page.tsx:53` (`outliersOnly`) and
   `outlier-history-chart.tsx:60` (`outlierCoords`) both write the literal
   `2`, while `channel-table.tsx:23,42` imports the constant from
   `src/lib/outlier-constants.ts:14`. No visible symptom today since the
   constant is still 2, exactly as the finding says.

3. **"Outliers Only" tab and "Outliers, 30d" stat tile use different
   definitions. CONFIRMED.** Verified `[channelId]/page.tsx:98` reads
   `detail.stats.outliers30d` from `countOutliers30d`
   (`channels.ts:104-118`: `outlier_score >= OUTLIERS_30D_MIN_SCORE`,
   `posted_at >= now-30d`, `deleted_at IS NULL`), while the tab at line 156
   renders `outliersOnly` (line 53: `outlierScore >= 2`, no time bound, and
   `detail.videos` includes removed posts per the doc comment at
   `channels.ts:41-45`). `feed.ts:149-154`'s `buildWhere` comment confirms
   deleted posts are deliberately not excluded from the feed the tab reads.
   DB check against the predicates: unwindowed, undeleted-agnostic count of
   `outlier_score >= 2` for `@kallaway` is 2; the windowed, live-only count
   (`countOutliers30d`'s exact predicate) is also 2 (both posts scored 2.3
   and 10.1 on 2026-07-09/10, within the current 30-day window, and no
   video anywhere in the DB has `outlier_score >= 2` with `deleted_at`
   set). So TC-CH-C2 would show matching numbers today for `@kallaway`, not
   because the two code paths agree, but because the current data has no
   old or removed 2x+ post to expose the split. The finding itself, and
   TC-CH-C3's fixture gap, both stand as described.

4. **A bad `?fleet=` id renders as an indistinguishable, normal empty fleet.
   CONFIRMED.** Verified `channels/page.tsx:15-19` only queries the
   fleet-scoped branch when `fleetId` is truthy, `channels.ts:150-161` has
   no null fallback for a zero-match fleet id, line 20's `?? allChannels`
   never fires because `[]` is not nullish, `channel-table.tsx:148` renders
   the same "No channels in this fleet yet" either way, and
   `fleet-rail.tsx:36` (all-channels highlight) plus the per-fleet highlight
   at line 53 (`activeFleet === fleet.id`, not lines 36-45 as the finding's
   citation range implies, minor line-range correction only) both fail to
   match a garbage id. DB makes this worse than the write-up assumed:
   `fleet_channels` is currently empty (`SELECT * FROM fleet_channels`
   returns zero rows) even though two real fleets exist ("AI Niche",
   "Craft References"), so today a real, legitimate fleet and a
   made-up fleet id render identically, not just a hypothetical.

5. **`getChannelsList` has no `ORDER BY`. CONFIRMED.** Verified both branches
   at `channels.ts:150-161`: the unscoped path is a plain `select()` with no
   `.orderBy()`, the fleet-scoped path joins `fleetChannels` with no
   `.orderBy()` either, and there is no sort control in
   `src/app/(shell)/channels/page.tsx` or `channel-table.tsx`. The dedupe
   safety claim also checks out: `schema.ts:80-83` defines
   `primaryKey({ columns: [t.fleetId, t.channelId] })` on `fleet_channels`.

6. **A channel with posts but zero measured views gets a bare dash with no
   explanation. CONFIRMED, including in DB.** Verified `channel-table.tsx:
   203-204`: `thin = !neverSynced && sampleSize > 0 && ...`, so a zero
   sample never renders the note at lines 256-261. DB query matching the
   predicate (`total` posts, `with_views` = posts with a non-null
   `view_count`, per channel):
   `@nateherkai` = 23 total / 0 with views, `@kaiships.ai` = 9 total / 0
   with views, both with non-null `last_synced_at`. That is exactly the
   `sampleSize === 0` + `neverSynced === false` cell the finding describes:
   `thin` is `false`, the hatch does not apply, and the row shows a plain
   "Synced N ago" next to a dash. This also resolves TC-CH-G2, which the
   plan marked "needs fixture": `@hormozi` has `last_synced_at` set
   (`2026-08-01T04:59:34.120Z`) and zero rows in `videos` at all (not in
   the per-channel video count query, confirming zero), so it is a second,
   live confirmation of the same gap, not merely a hypothetical needing a
   fixture. TC-CH-H1 (never-synced formatting), by contrast, is genuinely
   unexercisable right now: all four channels in the current DB have a
   non-null `last_synced_at`, so no never-synced row exists to check
   today; the code citation (`channel-table.tsx:282-286`) stands as the
   verdict per the plan's own fallback.

7. **No dedicated not-found screen for `/channels/does-not-exist`. CONFIRMED.**
   `find src/app -iname "not-found*"` returns nothing anywhere in the app,
   and `[channelId]/page.tsx:51` does call the bare `notFound()` with no
   custom messaging. Whether Next's generic 404 keeps the app's shell
   chrome is a rendering detail this pass cannot settle without loading the
   page; the underlying gap (no custom empty state exists to render either
   way) is fully confirmed from the file system alone.

### Summary

7 CONFIRMED, 0 NOT REPRODUCED, 0 NEEDS BROWSER. All seven bug candidates hold
up as real code defects on a fresh read; two of them (1 and 3) currently have
no visible symptom in the live DB purely because of what the fixture happens
to contain right now (no channel with more than 20 measured posts under a
sub-20 window; no removed or 30-day-stale 2x+ post for `@kallaway`), which is
a data coincidence, not evidence the code paths were reconciled. Finding 6
gained a second confirmed instance (`@hormozi`, synced with zero posts) that
the original plan had only listed as needing a fixture.
