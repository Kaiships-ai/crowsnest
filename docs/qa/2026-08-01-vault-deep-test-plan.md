# Vault page deep test plan, 2026-08-01

Read-only code audit of `src/app/(shell)/vault/page.tsx`, the components
under `src/components/vault/`, `src/server/queries/saved-posts.ts`,
`src/server/queries/vault.ts`, and `src/server/queries/dashboard.ts`
(`getTopOutliersToday`, which the Vault's own empty state depends on),
modeled on `docs/qa/2026-08-01-feed-deep-test-plan.md`.

Two things checked directly against the code and found clean, so they are
not listed as candidates below: an unknown `?tab=` value falls back to
"posts" (`page.tsx:24,72`, a plain `VALID_TABS.includes` gate), and an
unknown `?sort=` value falls back to "recent" (`page.tsx:27-29`). Both still
get a regression test case since a future edit could silently break the
fallback.

Current dev DB state, read directly with sqlite3 before writing any test
case: 0 rows in `saved_posts`, 5 rows in `scripts`, 3 `vault_items` of type
"hook" and 3 of type "style". All 6 vault_items share the exact same seeded
`created_at` ("2026-07-23T17:16:58.698Z") and all 6 have a null
`source_video_id`. Of the 5 scripts, 2 have a hook/style link but no source
video, and 3 have a source video but no hook/style link. The highest
`outlier_score` in the whole `videos` table is 10.1, on a post from
2026-07-09 (@kallaway); every video posted in the trailing 7 days from
"today" (2026-08-01) has a null `outlier_score`. This state makes several
findings below directly, currently reproducible with zero fixture data, and
makes every Saved-posts-tab-with-rows case a "needs fixture" case, since
that tab is genuinely empty right now.

Every case is read-only against `http://localhost:3000`. Nothing is synced,
saved, deleted, or submitted. The one dialog case (J1) opens and closes the
New template dialog without pressing Save.

## Bug candidates found by reading the code

1. **The Vault header's count line claims the whole Vault is empty even
   when three of its four tabs are not.** `page.tsx:90-94` renders
   `savedPosts.length === 0 ? "Nothing saved yet." : ...` directly under the
   page's `<h1>Vault</h1>`, above all four tabs, and it reads only
   `savedPosts.length`, never `scripts.length`, `hooks.length`, or
   `styles.length`. In the current dev DB this is not a theoretical gap:
   `saved_posts` has 0 rows while Scripts has 5, Hooks has 3, and Styles has
   3. A user landing on `/vault` right now reads "Nothing saved yet" while
   three of the four tabs one click away are full. The line's own wording,
   "Nothing saved yet," is a Vault-wide claim sitting above Vault-wide tabs,
   not a Saved-posts-tab-scoped one.

2. **The empty state's "Open the top outlier" link can point straight at a
   video with no score at all.** `vault-empty-state.tsx:12-29` renders a
   link to `/feed/${topOutlierVideoId}`, built in `page.tsx:83` by calling
   `getTopOutliersToday(1)` only when `savedPosts.length === 0`.
   `getTopOutliersToday` (`dashboard.ts:106-126`) first tries videos posted
   in the trailing 7 days, ordered by `outlierScore IS NULL, DESC
   (outlierScore)`, and only falls back to an all-time query if that first
   query returns zero rows. It returns the first row of whatever it finds,
   even if every candidate's score is null; the "IS NULL" ordering key only
   controls placement among scored versus unscored results within a
   non-empty result set, it does not trigger the all-time fallback branch.
   Confirmed directly against the dev DB: every video posted in the last 7
   days has a null `outlier_score`, so the 7-day branch returns 5 rows, all
   null-scored, and picks one of them (`ed0022ae-4f75-4393-832c-c3cb88be8f26`,
   an unscored "Fish Audio" post, per a direct query run against
   `data/crowsnest.db` using the same predicate and ORDER BY as the
   production query). The real highest-ever post, 10.1x on @kallaway from
   2026-07-09, is never considered, because it falls outside the 7-day
   window and the 7-day branch is not empty. The doc comment at
   `vault-empty-state.tsx:7-11` says the link "only gets a real link when a
   top post actually exists," but a null-scored post is not a top outlier in
   any sense the label implies.

3. **Vault's tabs are an uncontrolled client component with no URL sync in
   either direction beyond the very first render.** `page.tsx:99` renders
   `<Tabs defaultValue={defaultTab}>`, and `src/components/ui/tabs.tsx`
   wraps Base UI's `Tabs.Root` with no `value` or `onValueChange` prop
   anywhere in the file. `defaultValue` is read once, on mount, by an
   uncontrolled component; a `TabsTrigger` click updates only Base UI's
   internal state, never the URL. `?tab=` therefore only ever decides which
   tab a fresh navigation lands on. Manually clicking between tabs looks
   like normal navigation but leaves no trace in the URL, the browser
   history stack, or a later reload.

4. **Because of finding 3, the sort control can write a `tab` param that no
   longer matches the tab actually on screen.** `vault-sort-control.tsx:23-27`
   builds its next URL from `new URLSearchParams(searchParams.toString())`,
   i.e. whatever the URL already carries, and only ever adds or removes
   `sort`. If a user arrives via `/vault?tab=scripts` (a real, live link,
   see `layout.tsx:57`'s "Draft a script" checklist item and
   `stage-script.tsx:174,307`'s "Open in Vault" links), then clicks over to
   the Saved posts tab by hand (which, per finding 3, does not touch the
   URL), the URL still reads `?tab=scripts`. Clicking any sort option now
   writes `?tab=scripts&sort=score` while Saved posts, not Scripts, is what
   is on screen. A reload from that exact URL sends the user to Scripts,
   silently discarding the tab they were actually looking at when they
   touched sort.

5. **`getVaultItems`'s `ORDER BY` has nothing to break a tie on, and the dev
   DB's 6 real rows are all tied.** `vault.ts:36` orders strictly by
   `desc(tables.vaultItems.createdAt)` with no secondary key. All 6 seeded
   vault_items rows (3 hooks, 3 styles) share the literal same `created_at`
   timestamp. With a full tie and no tiebreaker, the order SQLite returns is
   whatever its query plan happens to produce, not a value the code commits
   to, so nothing here guarantees the Hooks or Styles tab renders the same
   card order on every load. This one needs no fixture: the tie already
   exists in the current dev DB.

6. **`getSavedPosts`'s "score" sort has no SQL-level order and no
   tiebreaker at all, unlike its own "analyzed" sibling.**
   `getJoinedSavedPosts` (`saved-posts.ts:41-54`) has no `.orderBy(...)`
   whatsoever, it is a plain join. All ordering happens afterward in
   `sortRows` (`saved-posts.ts:56-81`), entirely in JS. The `"analyzed"`
   branch (`saved-posts.ts:68-75`) explicitly breaks ties by `savedAt`. The
   `"score"` branch (`saved-posts.ts:58-67`) does not: two saved posts with
   the same `outlierScore` keep whatever order the untouched, unordered SQL
   result handed them, which is not a value the code defines anywhere.
   `v1-scope.md`'s Vault acceptance criterion 6 says "the order is stable
   across reload." Compare Feed's own "score" sort (`feed.ts:200-212`),
   which at least runs its NULL-then-DESC ordering inside the SQL
   `ORDER BY` clause itself; Vault's version does not even have that much,
   since there is no `ORDER BY` upstream of the JS sort at all. This case
   needs a fixture, since `saved_posts` is empty right now.

7. **The two-tier Hooks/Styles empty state reads correct on inspection, but
   neither branch is reachable live today.** `templatesEmpty =
   hooks.length === 0 && styles.length === 0` (`page.tsx:80`), consumed by
   `EmptyTemplates` (`page.tsx:31-52`): true shows the heavy "Nothing saved
   yet" copy with a Browse the Feed link, false shows a one-line "No hooks
   saved yet" / "No styles saved yet" with no link. Read against
   `TemplateGrid` (`page.tsx:54-63`), the logic looks right: it only fires
   the heavy state when both tabs are genuinely empty, and the light state
   when a sibling tab still has content. But the current dev DB has 3 hooks
   and 3 styles, so `templatesEmpty` is false and neither branch of
   `EmptyTemplates` is currently visible in either tab. This needs a
   fixture (or a destructive delete of real vault_items, out of scope here)
   to observe directly.

8. **Undo after Remove does not restore the original saved_posts row, it
   creates a different one.** `saved-post-row.tsx`'s `remove` handler calls
   `deleteSavedPostAction`, then on Undo calls `createSavedPostAction({
   videoId: item.videoId, note: row.note ?? undefined })`.
   `createSavedPostAction` (`saved-post-actions.ts:30-49`) always assigns a
   fresh `id = newId()` and `createdAt: nowIso()` (line 43), it has no
   parameter to pass through the original id or the original `savedAt`.
   `deleteSavedPostAction` (`saved-post-actions.ts:71-78`) is a hard delete
   with no soft-delete path, by the file's own doc comment. So "Undo" in
   the toast silently changes two things about the row: its id, and its
   saved-at timestamp becomes "now" instead of whenever it was originally
   saved, which also silently moves it to the top of a "Recently saved"
   sort. The toast's label, "Undo," implies a full restore; the code
   restores the content but not the identity or the position. Not exercised
   live here: reaching this state needs an existing saved post (a fixture)
   and then a remove-then-undo sequence, which is itself a pair of writes.

9. **Saving a new template does not switch you to the tab where you would
   see it.** `new-template-dialog.tsx:59-70`'s `submit()` calls
   `router.refresh()` on success and nothing else; it never touches the
   active tab. A user who opens "+ New template" while viewing, say, Saved
   posts or Scripts, fills it in, and saves, sees the dialog close and the
   page silently refetch, with no visible change on the tab they are
   looking at, since the new row landed on Hooks or Styles. Not exercised
   live here per the no-side-effects constraint on this pass; only the
   dialog's open/close/validation path is tested (J1 below).

## A. The Vault-wide count line versus per-tab content

### TC-VLT-A1: Header count says "Nothing saved yet" while three tabs have real content
Steps:
1. Go to `/vault` with no query string.
2. Read the line under the "Vault" heading, above the tabs.
3. Click the Scripts tab and read what is shown.
4. Click the Hooks tab and read what is shown.
5. Click the Styles tab and read what is shown.
Expected: per finding 1, step 2 should read "Nothing saved yet." Steps 3
through 5 should each show real cards (5 script cards, 3 hook cards, 3
style cards, per the current dev DB), directly contradicting the blanket
claim read in step 2. If the header line instead reads something scoped to
Saved posts only ("0 saved posts" or similar), the finding does not hold as
written and needs revising against whatever text is actually shown.

## B. Empty state exits

### TC-VLT-B1: "Open the feed" from the empty Saved posts tab
Steps:
1. Go to `/vault` (Saved posts tab, 0 rows).
2. Read the "Open the feed" button's destination without clicking, or click
   it and confirm the landing page.
Expected: routes to `/feed`, a page that exists and is not empty (per the
Feed deep test plan's fixture, about 42 synced posts exist). This exit is
expected to work; record if it does not.

### TC-VLT-B2: "Open the top outlier" can target an unscored post
Steps:
1. Go to `/vault` (Saved posts tab, 0 rows).
2. Read the "Open the top outlier" button's href (inspect the link, do not
   necessarily need to click) and note the video id in it.
3. Separately, go to `/channels` or `/feed?minScore=0` and find the single
   highest-scored post currently in the system (10.1x, @kallaway, per the
   dev DB read for this plan).
Expected per finding 2: the video id from step 2 is very likely not the
10.1x post from step 3, because that post was made more than 7 days before
the test is run and every post from the last 7 days is unscored. As of this
reading the predicted target is the "Fish Audio" post
(`ed0022ae-4f75-4393-832c-c3cb88be8f26`), but the exact id can drift with
time or a re-sync; the load-bearing check is whether the linked post has any
score at all, not the literal id. If the linked post does carry a real
score, or is in fact the 10.1x post, the finding does not hold today and
should be re-read against the current `videos` table state before being
called a pass.

## C. Tabs and the ?tab= param

### TC-VLT-C1: Bare /vault opens on Saved posts
Steps:
1. Go to `/vault` with no query string.
Expected: the Saved posts tab is active (underlined per the "line" tab
variant) and its content, the empty state from B1/B2, is what renders.

### TC-VLT-C2: ?tab= opens directly on each named tab
Steps:
1. Go to `/vault?tab=scripts`, note which tab is active.
2. Go to `/vault?tab=hooks`, note which tab is active.
3. Go to `/vault?tab=styles`, note which tab is active.
Expected: each of the three loads opens directly on the matching tab
(Scripts, Hooks, Styles respectively) with that tab's real content
visible, not Saved posts. This also exercises the real "Open in Vault" /
"Draft a script" links from `layout.tsx:57` and `stage-script.tsx:174,307`,
which all point at `/vault?tab=scripts`.

### TC-VLT-C3: An unknown ?tab= value falls back to Saved posts, not a blank tab
Steps:
1. Go to `/vault?tab=not-a-real-tab`.
Expected: per the clean fallback already confirmed by reading
`page.tsx:24,72`, this should behave identically to bare `/vault`: Saved
posts active, no blank or broken tab strip, no console error.

### TC-VLT-C4: Clicking between tabs never changes the URL
Steps:
1. Go to `/vault?tab=scripts` (Scripts active).
2. Click the Hooks tab.
3. Click the Saved posts tab.
4. After each click in steps 2 and 3, read the address bar.
Expected per finding 3: the address bar keeps reading `/vault?tab=scripts`
throughout, unchanged by either click, even though the on-screen active tab
correctly changes each time. If the URL does update on a tab click, findings
3 and 4 do not hold and need revising against whatever sync mechanism is
actually firing.

### TC-VLT-C5: A manual tab switch does not survive reload, and touching sort afterward writes a mismatched tab param
Steps:
1. Go to `/vault?tab=scripts` (Scripts active, URL reads `?tab=scripts`).
2. Click the Saved posts tab (per C4, the URL should stay `?tab=scripts`).
3. Reload the page (full navigation, not a client-side action).
4. Note which tab is active after the reload.
5. Navigate back to `/vault?tab=scripts`, click over to Saved posts again,
   then click any sort option ("Highest score", for example).
6. Read the address bar after the sort click.
Expected per findings 3 and 4: step 4 lands back on Scripts, not Saved
posts, since the URL never recorded the manual switch. Step 6 should read
something like `/vault?tab=scripts&sort=score`, a URL whose `tab` value
(Scripts) does not match what is actually on screen (Saved posts, since the
sort click did not change tabs). A follow-up reload from that URL would
land on Scripts, not the Saved posts view the sort was clicked from.

## D. Sort control

### TC-VLT-D1: Sort control renders and is clickable even with zero saved posts
Steps:
1. Go to `/vault` (Saved posts tab, 0 rows, empty state showing).
2. Confirm the "SORT" row with "Recently saved / Highest score / Analysed
   first" is visible above the empty state.
3. Click "Highest score", then "Analysed first", then "Recently saved".
Expected: the control is visible and each click updates the `sort` query
param (or removes it for "Recently saved", per `vault-sort-control.tsx:25`)
without an error, a blank page, or the empty state disappearing. There is
nothing to reorder, so no visible list change is expected, only the URL
changing.

### TC-VLT-D2: An unknown ?sort= value falls back to Recently saved, not a blank or crashed list
Steps:
1. Go to `/vault?sort=not-a-real-sort`.
Expected: per the clean fallback already confirmed by reading
`page.tsx:27-29`, behaves identically to `sort=recent` (or no `sort` param
at all): the "Recently saved" option shows as selected (`aria-pressed`),
no console error.

### TC-VLT-D3 (needs fixture): Recent and Score sorts produce the documented order
Steps:
1. With 2 or more saved posts of different `savedAt` and different
   `outlierScore` (including at least one null score), go to
   `/vault?sort=recent` and record order.
2. Go to `/vault?sort=score` and record order.
Expected, per `saved-posts.ts:56-81` and its own passing unit tests
(`saved-posts.test.ts`): "recent" is most-recently-saved first; "score" is
highest score first with null scores last. The current dev DB has 0 saved
posts, so this is a code-verified pass (the unit tests already cover it
directly) rather than a live browser result; mark needs fixture if run
against `http://localhost:3000` before any post is saved.

### TC-VLT-D4 (needs fixture): Score-sort ties are not guaranteed stable across reload, unlike Analysed-sort ties
Steps:
1. With 2 or more saved posts sharing the exact same `outlierScore`, go to
   `/vault?sort=score`, record the order of the tied rows.
2. Reload (full navigation) and record the order again.
3. Separately, with 2 or more saved posts sharing the same `analyzed` state,
   go to `/vault?sort=analyzed`, record order, reload, record again.
Expected per finding 6: step 3's order should stay stable across the
reload, since `sortRows`'s `"analyzed"` branch explicitly breaks ties by
`savedAt` (`saved-posts.ts:71-74`). Step 1 versus step 2 has no such
guarantee: `getJoinedSavedPosts` has no `ORDER BY` and the `"score"` branch
has no tiebreaker, so a changed order between the two loads would confirm
the finding, and an unchanged order would be consistent with, but not proof
against, the same gap (SQLite can return a stable order for an unwritten
table by accident). Needs fixture: 0 saved posts exist right now.

## E. Hooks/Styles ordering (live, no fixture needed)

### TC-VLT-E1: Hooks tab card order across repeated reloads
Steps:
1. Go to `/vault?tab=hooks`, record the top-to-bottom order of the 3 hook
   titles ("Negative Warning Hook", "Curiosity Gap Hook", "Results-First
   Hook").
2. Reload (full navigation) and record the order again.
3. Reload a third time and record once more.
Expected per finding 5: all 3 hooks share the identical seeded `created_at`,
so nothing in `getVaultItems` (`vault.ts:20-37`) commits to a fixed order
among them. If the order is identical across all three loads, that is
informative but not proof of a guarantee (SQLite can be incidentally stable
for an unwritten table); if the order changes between any two loads, that
directly confirms the missing-tiebreaker finding.

### TC-VLT-E2: Styles tab card order across repeated reloads
Steps:
1. Go to `/vault?tab=styles`, record the top-to-bottom order of the 3 style
   titles ("Fast-Cut Listicle", "Talking-Head Teardown", "Screen-Record
   Walkthrough").
2. Reload twice more, recording order each time.
Expected: same as E1, applied to the Styles tab's 3 tied rows.

## F. Two-tier Hooks/Styles empty state (needs fixture)

### TC-VLT-F1 (needs fixture): Both Hooks and Styles empty shows the heavy state with a Feed link
Steps:
1. With zero rows in `vault_items` (the current dev DB has 3 hooks and 3
   styles, so this needs a fixture with both types cleared), go to
   `/vault?tab=hooks`.
2. Go to `/vault?tab=styles`.
Expected per finding 7: both tabs show the heavy "Nothing saved yet" copy
("Saving a hook or style keeps it with its source video...") with a working
"Browse the Feed" link to `/feed` (`page.tsx:34-45`), since `templatesEmpty`
is true only when both counts are zero.

### TC-VLT-F2 (needs fixture): One of Hooks/Styles empty, the other populated, shows the light state with no link
Steps:
1. With zero rows of one type (say hooks) and one or more rows of the other
   (styles), go to the empty tab.
Expected per finding 7: a single line, "No hooks saved yet." (or "No styles
saved yet."), centered, no Feed link and no heading, per
`page.tsx:47-51`'s `templatesEmpty === false` branch.

## G. Scripts tab (live, no fixture needed)

### TC-VLT-G1: Scripts render newest first
Steps:
1. Go to `/vault?tab=scripts`.
2. Record the top-to-bottom order of the 5 script cards by title.
Expected: newest `createdAt` first, per `vault.ts:79`'s
`orderBy(desc(tables.scripts.createdAt))`. Against the current dev DB, the
order should be: "OpenAI has officially launched ChatGPT Work." (newest),
then the two identical "This AI voice tool should not be free..." drafts (in
some order relative to each other, about 21 seconds apart), then "AI Tool
Nobody's Talking About, Script Draft", then "The Tool Everyone's Sleeping
On, Script Final" (oldest).

### TC-VLT-G2: Both script-card variants render their optional fields correctly
Steps:
1. On the Scripts tab, find "AI Tool Nobody's Talking About, Script Draft"
   or "The Tool Everyone's Sleeping On, Script Final" (these 2 have a
   hook/style link but no source video, per the dev DB read).
2. Read its badges and confirm there is no channel handle link.
3. Find "OpenAI has officially launched ChatGPT Work." (has a source video,
   @kallaway, but no hook/style link, per the dev DB read).
4. Read its content and confirm there is a channel handle link but no hook
   or style badge.
Expected per `script-card.tsx:44-57`: step 2's cards show a Hook badge, a
Style badge, or both, and no channel-handle link underneath, since
`sourceVideo` is null for both. Step 4's card shows a `@kallaway` link
(`script.sourceVideo.channelHandle`) and no badge row at all, since
`hookTitle` and `styleTitle` are both null. Neither variant should crash or
show an empty badge/link in place of the missing field.

## H. Template cards (live, no fixture needed)

### TC-VLT-H1: Every current hook/style card shows "Manual entry" with no source-video affordances
Steps:
1. Go to `/vault?tab=hooks`, look at all 3 cards.
2. Go to `/vault?tab=styles`, look at all 3 cards.
3. On any one card, open the "More actions" (three-dot) menu.
Expected: all 6 cards show "Manual entry" (`template-card.tsx:111-113`),
since `source_video_id` is null on all 6 rows in the dev DB, and none show
the "Use in Remix" button (`template-card.tsx:121-125`, conditioned on
`item.sourceVideo`). Step 3's menu should show only "Delete" (destructive),
not "View source video" (`template-card.tsx:79-83`), since there is no
source video to view. Do not choose Delete.

### TC-VLT-H2: Tag chips and {slot} badges render inside the template text
Steps:
1. On any hook or style card, read the tag chips under the template text
   (for example "curiosity", "warning" on "Negative Warning Hook").
2. Read the template text itself for any {word} pattern (for example
   "the {topic} nobody talks about", per the seeded "Curiosity Gap Hook").
Expected: tags render as outline-style chips (`template-card.tsx:94-102`),
and any {word} segment renders as an inline secondary-variant badge with
the braces stripped, per `renderTemplateText` (`template-card.tsx:29-43`)
and its `SLOT_PATTERN` regex; plain text segments render as normal text
around the badges, not swallowed or duplicated.

## I. Saved post row rendering (needs fixture, 0 saved posts today)

### TC-VLT-I1 (needs fixture): Null fields render as explicit dashes, not blanks or fabricated values
Steps:
1. With at least one saved post whose source video has no downloaded
   thumbnail (`thumbnailAssetId` null), one with a null "why kept" note, and
   one whose channel has fewer posts than the median baseline needs, go to
   `/vault` (Saved posts tab).
2. Read the thumbnail cell, the "WHY KEPT" cell, and the "vs [median]" text
   in the meta line for each such row.
3. Separately, find or create a saved post whose source video's
   `deletedAt` is set.
Expected: a null thumbnail asset shows the hatch-pattern placeholder with
the small play glyph (`saved-post-row.tsx:96-101`, `video-thumb.tsx:32-36`),
never a broken image icon. A null note shows a plain dash
(`saved-post-row.tsx:118-123`). A null `channelMedian` shows "vs " followed
by a dash (`formatCompact(null)`, `format.ts:11-21`, wired at
`saved-post-row.tsx:44`). Step 3's row additionally shows a "No longer on
[platform]" line in the destructive color (`saved-post-row.tsx:107-111`),
while still remaining a normal, clickable row rather than being hidden.

## J. New template dialog, opened and closed only

### TC-VLT-J1: Opening and closing the dialog without saving has no side effect
Steps:
1. Go to `/vault`, click "+ New template".
2. Confirm the "Save template" button is disabled (both Title and Template
   text are empty).
3. Type a title only, confirm Save is still disabled.
4. Type template text as well, confirm Save becomes enabled.
5. Close the dialog via the window's close control or Escape, without
   clicking Save.
6. Reopen the dialog.
Expected: step 2 and step 3 both show a disabled Save button, per
`new-template-dialog.tsx:121` (`disabled={!title || !templateText ||
pending}`). Step 6 shows a freshly reset form (Type back to "Hook", empty
Title and Template text fields), per `onOpenChange`'s call to `reset()`
(`new-template-dialog.tsx:54-57`) whenever the dialog closes. No new card
should appear on the Hooks or Styles tab afterward, since Save was never
pressed.

## Verdict

Nine candidates, all grounded in file:line reads; two of them (1 and 2) are
directly reproducible against the running dev DB with zero fixture data and
zero writes, simply by loading `/vault` as it stands today. In rough order
of how badly a real user would be misled: finding 2 is the sharpest, a
button literally labeled "the top outlier" can hand back a post with no
measured outlier score at all, while the real 10.1x post sits one query
away but outside a 7-day window the button never mentions. Finding 1 is
close behind, a Vault-wide "Nothing saved yet" claim sitting directly above
three tabs that are not empty. Findings 3 and 4 are a real but quieter
state-desync risk between the tab strip and the URL, one that a user would
likely never notice unless they specifically bookmarked or reloaded mid
session. Findings 5 and 6 are ordering-stability gaps that match each
other in shape (an SQL tie or an absent SQL order, no tiebreaker) but
differ in how easy they are to see: finding 5 is live-reproducible today,
finding 6 needs a fixture. Finding 7 reads correct in the code and is
listed mainly so its two branches get exercised the first time real
fixture data allows it. Findings 8 and 9 are smaller UX rough edges neither
exercised here, since reaching either needs a write this pass intentionally
avoids.

No app code was changed, no saved post, script, hook, or style was created
or removed, and no browser was opened to produce this document.

## Verification, code + DB, 2026-08-01

Read-only recheck of all nine bug candidates against the current code and a
live `sqlite3 data/crowsnest.db` (SELECT-only). No app code was edited, no
DB write was issued, no browser was opened. Line numbers below were read
directly, not carried over from the plan text.

**1. CONFIRMED.** `page.tsx:89-94` reads:
```
{savedPosts.length === 0
  ? "Nothing saved yet."
  : `${savedPosts.length} saved post${savedPosts.length === 1 ? "" : "s"}`}
```
under `<h1>Vault</h1>` (line 89), above the `<Tabs>` block starting at line
99. Only `savedPosts.length` is read; `scripts`, `hooks`, `styles` never
appear in this branch. DB query against the same tables the page queries
(`saved_posts`, `scripts`, `vault_items` by `type`):
```sql
SELECT (SELECT count(*) FROM saved_posts) AS saved_posts,
       (SELECT count(*) FROM scripts) AS scripts,
       (SELECT count(*) FROM vault_items WHERE type='hook') AS hooks,
       (SELECT count(*) FROM vault_items WHERE type='style') AS styles;
```
Result: `saved_posts=0, scripts=5, hooks=3, styles=3`. Matches the plan's
numbers exactly, so the header text branch and the DB state combine to
literally read "Nothing saved yet." while three tabs are non-empty.

**2. CONFIRMED.** `vault-empty-state.tsx:24-29` builds the link from
`topOutlierVideoId`, sourced at `page.tsx:83`
(`savedPosts.length === 0 ? await getTopOutliersToday(1) : []`).
`getTopOutliersToday` (`dashboard.ts:106-126`): the 7-day branch
(`dashboard.ts:109-115`) filters `posted_at >= now-7d AND deleted_at IS
NULL`, orders by `outlierScore IS NULL, outlierScore DESC`, and returns
early at line 116 whenever it has at least one row, regardless of whether
every score is null; the all-time fallback (`dashboard.ts:118-125`) only
runs when the 7-day query returns zero rows. Ran the identical
predicate/order against the DB (cutoff = now minus 7 days,
`2026-07-25T12:58:52Z` at query time):
```sql
SELECT v.id, v.posted_at, v.outlier_score, c.handle
FROM videos v JOIN channels c ON v.channel_id = c.id
WHERE v.posted_at >= '2026-07-25T12:58:52.000Z' AND v.deleted_at IS NULL
ORDER BY v.outlier_score IS NULL, v.outlier_score DESC
LIMIT 5;
```
Returned 5 rows, all with a null `outlier_score`; top row
`ed0022ae-4f75-4393-832c-c3cb88be8f26` (@nateherkai, posted 2026-07-27,
still the same id the plan predicted). Separately, the all-time top score
in `videos` is confirmed 10.1 on `a0ed7179-1b66-4f2e-90c9-03e81429f9fc`
(@kallaway, posted 2026-07-09), which falls outside the 7-day window and is
never reached because the 7-day branch returned rows. The empty state's
link (`vault-empty-state.tsx:25`) therefore resolves to a null-scored post,
not the real top outlier, exactly as the finding claims.

**3. CONFIRMED.** `page.tsx:99`: `<Tabs defaultValue={defaultTab}>`, no
`value` or `onValueChange` prop. `src/components/ui/tabs.tsx` (full file
read): `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` wrap
`@base-ui/react/tabs`'s `Root`, `List`, `Tab`, and `Panel` and forward only
`className`-related props; none of the four wrappers accept or pass through
`value`/`onValueChange`. `grep -rn "onValueChange"` across
`src/app/(shell)/vault/` and `src/components/vault/` finds it used only in
`new-template-dialog.tsx:84` (the Type select) and
`save-to-vault-dialog.tsx:114` (an unrelated dialog), never on the page's
`<Tabs>`. No code path anywhere in the Vault tree calls `router.push`,
`router.replace`, or touches `searchParams` on a tab click. This is a
provable negative, since the full set of files that could wire tab click to
router is small and was read in full, so the "URL never updates on tab
click" behavior is code-guaranteed, not just likely. Reading the literal
address bar text after a click (TC-VLT-C4) is still a DOM/browser
observation, so tag the browser-visible symptom NEEDS BROWSER even though
the code cause is fully confirmed: open `/vault?tab=scripts`, click Hooks
then Saved posts, and read the address bar after each click.

**4. CONFIRMED.** `vault-sort-control.tsx:23-27`:
```
const params = new URLSearchParams(searchParams.toString());
if (value === "recent") params.delete("sort");
else params.set("sort", value);
router.replace(`${pathname}?${params.toString()}`, { scroll: false });
```
Confirmed by direct read: this only ever adds or removes `sort`, starting
from whatever `searchParams.toString()` already is. Combined with finding
3 (tab clicks never touch the URL), a URL of `?tab=scripts` surviving a
manual switch to Saved posts, then getting `&sort=score` appended while
Scripts is not what's on screen, is a direct, code-provable consequence.
The finished mismatched-URL string (TC-VLT-C5) is a browser-observable end
state: tag NEEDS BROWSER for seeing the actual address bar text after the
click sequence, code cause CONFIRMED.

**5. CONFIRMED.** `vault.ts:36`: `.orderBy(desc(tables.vaultItems.createdAt))`,
no secondary column anywhere in the `getVaultItems` query builder
(`vault.ts:20-37`, read in full). DB query:
```sql
SELECT type, title, created_at, source_video_id FROM vault_items ORDER BY created_at DESC;
```
All 6 rows return `created_at = 2026-07-23T17:16:58.698Z`, an exact tie
across all 3 hooks and all 3 styles, with `source_video_id` null on every
row. A single-column `ORDER BY` over a fully tied column is not a
determinate order in SQLite; the specific order the current dev DB happens
to return (E1/E2's steps) is a live rendering fact, so mark the "does the
displayed order actually change across reloads" observation itself NEEDS
BROWSER, while the missing-tiebreaker cause is CONFIRMED from code and DB
alone.

**6. CONFIRMED.** `saved-posts.ts:41-54` (`getJoinedSavedPosts`): a plain
`.select(...).from(...).innerJoin(...).innerJoin(...)` with no `.orderBy(...)`
call anywhere in the function, read in full. `sortRows` (`saved-posts.ts:56-81`):
the `"score"` case (lines 59-67) compares only `outlierScore`, with a
`return 0` when both are null (line 62) and no fallback comparison; the
`"analyzed"` case (lines 68-75) explicitly breaks ties with
`b.savedAt.localeCompare(a.savedAt)` (line 73). This is an exact,
line-for-line match to the finding. `saved_posts` has 0 rows right now
(confirmed by the count query in item 1 above), so there is nothing to sort
in the live DB; the code-level gap is fully confirmed, but seeing it change
a rendered order needs a fixture and a browser, per the plan's own D4 case.

**7. CONFIRMED (as stated: logic reads correct, currently unreachable).**
`page.tsx:80`: `const templatesEmpty = hooks.length === 0 && styles.length
=== 0;`. `EmptyTemplates` (`page.tsx:33-52`): `templatesEmpty` true renders
the heavy block (lines 34-46, heading plus Feed link); false renders the
one-line variant (lines 47-51). `TemplateGrid` (`page.tsx:54-63`) only
calls `EmptyTemplates` when `items.length === 0` (line 55). DB counts from
item 1 above (`hooks=3, styles=3`) mean `templatesEmpty` evaluates `false`
today and both tabs' `items.length` are `3`, so `TemplateGrid` never even
calls `EmptyTemplates` in the current DB state, meaning neither branch is
on screen in either tab right now. Matches the finding exactly; no code
defect, just a confirmed-unreachable state pending a fixture (F1/F2).

**8. CONFIRMED.** `saved-post-actions.ts:30-49`
(`createSavedPostAction`): `const id = newId();` (line 38) and
`createdAt: nowIso()` (line 43) inside the `db.insert` call, no parameter
anywhere in the function signature (`{ videoId: string; note?: string }`,
line 30) for a caller to pass through an original id or timestamp.
`deleteSavedPostAction` (`saved-post-actions.ts:71-78`) is a bare
`db.delete(...).where(eq(...))`, and the file's own comment at lines 66-70
confirms "nothing here is soft-deleted." `saved-post-row.tsx`: `remove`
(around line 54) calls `deleteSavedPostAction(row.id)` (line 57), and the
toast's Undo handler (lines 66-68) calls
`createSavedPostAction({ videoId: item.videoId, note: row.note ??
undefined })`, passing neither the old id nor the old `savedAt`. Confirms
the finding precisely: Undo produces a new row with a new id and a
`createdAt` of "now," not a restore of the original. Not exercised live
here since it requires a saved-post fixture plus a remove/undo write pair,
outside this read-only pass.

**9. CONFIRMED.** `new-template-dialog.tsx:59-70` (`submit`): on success
(`result.ok`, line 63) calls `toast.success(...)` (64), `onOpenChange(false)`
(65), and `router.refresh()` (66); no tab-related state, prop, or URL
param is touched anywhere in the function or the rest of the file (128
lines read in full, and the component holds no reference to the active tab
at all). Confirms the finding: saving a hook or style while viewing Saved
posts or Scripts leaves that tab on screen after the refresh, with the new
item landing on a tab the user is not looking at. Not exercised live here
(would require an actual save, a write this pass avoids).

### Tally
CONFIRMED: 9. NOT REPRODUCED: 0. NEEDS BROWSER (for the on-screen or
address-bar symptom only, cause already code-confirmed): 3, all sub-aspects
of findings 3, 4, and 5, namely "did the URL actually stay put across
clicks" (C4), "does sort actually write a mismatched tab param" (C5), and
"does the Hooks/Styles card order actually change across reloads" (E1/E2).

## Browser verification

Read-only pass against the running app at `http://localhost:3000`. No saves,
no deletes, no settings writes.

**Finding 1 (count line): SEEN.**
Opened `/vault`. Header read "Nothing saved yet." on the Saved posts tab.
Switched to Scripts: header unchanged, tab body showed one real script card
(the ChatGPT Work transcript). Switched to Hooks: header still "Nothing
saved yet.", tab body showed three real cards (Negative Warning Hook,
Curiosity Gap Hook, Results-First Hook). Switched to Styles: header
unchanged again, tab body showed three real cards (Fast-Cut Listicle,
Talking-Head Teardown, Screen-Record Walkthrough). Matches the DB counts
from the code verification (scripts=5 on disk, hooks=3, styles=3, only the
first script row rendered per card list truncation). Screenshot:
`finding-vault1-styles.png`.

**Finding 2 (empty-state link): SEEN.**
From the Saved posts tab (0 saved), read the "Open the top outlier" link's
href: `/feed/ed0022ae-4f75-4393-832c-c3cb88be8f26`, exactly the id the code
verification predicted. Navigated to it: the score field showed the app's
null placeholder dash instead of a number, the views field showed the same
dash placeholder instead of a count, posted 4 days ago from @nateherkai, and
the page's own median-confidence copy read "Not enough of @nateherkai's
posts yet to have a normal. 0 of 5 needed before a median means anything."
Not @kallaway's 10.1x post. Screenshot: `finding-vault2-topoutlier.png`.

Findings 3, 4, and 5 (URL/tab-param behavior, sort-vs-tab mismatch, tied
Hooks/Styles order) were left alone per the task scope; only findings 1 and
2 were in scope for this pass.
