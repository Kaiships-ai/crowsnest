# feed: feature description

`documents/architect/core-components/feed/`

Status: shipped and in daily use.

The feed is the front door of the core loop: a page of outlier posts from tracked channels, ranked so the strongest performers sit first, that the user scans to find something worth remixing. It lives at `/feed` and is the landing page of the app. It is a direct server read: the page queries the database as it renders and shows either a page of cards or an empty state. There is no server action on the feed page itself and nothing to submit, so it cannot fail as an action. Everything the user changes about the view, the filters, which slice, how many posts, grid or list, is carried in the URL, and changing it re-reads the page. Because it needs nothing but the local database, the feed works in every restricted state: the LLM proxy being down, the Graph token being invalid, and the sidecar not running change nothing about whether it renders.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | The outlier feed page | Ranked grid or list of outlier posts, follower-band counts, Load more, four empty states | ● | `src/app/(shell)/feed/(list)/page.tsx` | none |
| 3 | The filter bar and saved views | URL-driven filter controls, saved views, Add post URL import | ● | `src/components/feed/filter-bar.tsx`, `saved-view-actions.ts` | FEED-Q2 |
| 4 | The quick preview sheet | Read-only panel over the feed showing one video's details | ● | `src/components/feed/quick-preview-sheet.tsx`, `preview-action.ts` | FEED-Q3 |
| 5 | The keep this post button | One-row-per-video toggle that saves a post to a shortlist | ● | `src/components/video/save-post-button.tsx`, `saved-post-actions.ts` | none |
| 6 | The save to vault dialog | Lifts a hook or style template out of an analysis into a reusable vault item | ● | `vault-actions.ts` | none |
| 7 | The video detail page | Two-column study surface for one video, with arrow-key navigation to neighbours | ● | `src/app/(shell)/feed/[videoId]/page.tsx`, `src/components/video/video-detail.tsx` | B-10 |

## 2. The outlier feed page

### Who uses it

Any user; it is the app's landing page and the default entry into the core loop.

### What it does

The page opens on a grid of cards, one per video, biggest scorer first. Each card shows a thumbnail with the caption laid over it, the outlier score as the largest number on the card, the view count and engagement rate, the channel handle and its follower count, and how long ago the post went up. A small line above the grid states the results count, notes when the default view is on, and offers a "Show all" link that drops it. If the grid holds more than the first 24 posts, a Load more button sits at the bottom.

### How to access it

Opens automatically at `/feed`. A card, the quick preview, or any link carrying a video id leaves it for the [video detail page](#7-the-video-detail-page).

### Business rules

- The default page size is 24, and Load more raises the URL's `limit` by 24 and re-reads; a slice that fits shows no button.
- A bare `/feed` visit applies the seeded High Conviction saved view rather than the full library, because the point of the tool is the outliers, not the archive. `?all=1` is the explicit escape. Cosmetic params (density, view, sort, limit) do not count as filters, so toggling one alone still reads as bare and keeps the default view.
- The results count is the true size of the current slice before paging, so it can read larger than the visible cards.
- Follower bands are nano under 10k, mid 100k to 1M, macro 1M and up. Each band count is computed under every other active filter with that band excluded, so picking one band does not change the others; the three counts need not sum to the total, since a channel between 10k and 100k, or with an unknown follower count, matches no band.
- The score badge turns amber at 1.0, the moment a post beat its channel baseline, and stays muted below that; a post with no score shows a dash and sorts last under the score sort but stays present under the recent sort. The badge's heat tiers escalate above 1.0: a wash below 5x, solid amber from 5x, bolder past 20x. The score shows as a multiple to one decimal, for example 38.0x.
- A soft-removed post (`videos.deleted_at` set) stays in results rather than being excluded, marked "No longer on Instagram" on the card and "removed" on the list row.
- The page has four distinct empty states, each with its own copy and recovery link: no channels tracked, channels tracked but none ever synced, a search that matched nothing, and a filter slice (including the default view) that came back empty.
- There is no save button on the card; saving needs an analysis, which only exists on the detail page, so the card links there instead.
- A card is keyboard-reachable: Enter or Space on a focused thumbnail or list row opens the quick preview, the same as a click.
- Grid and list are chosen by the `view` URL value; the list is a plain data table with no thumbnail, and the whole row is the click target.

### Limitations

- The quick preview and the video detail page are separate features, documented on their own.

### User guide

`/feed` opens on your strongest recent outliers, ranked by how far each beats its channel's own typical performance. The score badge turns amber once a post clears that bar. Use "Show all" above the grid to see the full library instead of the default view, and Load more at the bottom to see further down the ranking. A post that Instagram has removed still shows, marked "No longer on Instagram," so you never lose track of a post that was once worth remembering.

## 3. The filter bar and saved views

### Who uses it

Any user narrowing or reordering the feed, and anyone pulling a single post into the feed by hand.

### What it does

The bar sits above the grid and holds a search box, narrowing controls (fleet, minimum score, minimum views, minimum engagement, timeframe, analyzed status, follower band), a sort, layout and density toggles, a saved views dropdown, and an Add post URL button. Every choice is written into the URL and the feed re-renders from it; the bar never fetches results itself. A saved view names the current filters so they can be reapplied later; two built-in views, Balanced and High Conviction, are always present.

### How to access it

The sticky header of `/feed`.

### Business rules

- Filter state lives entirely in the URL. Controls call `router.replace(..., { scroll: false })`, so a filter change is a client-side navigation, not a form submit; the search box waits about 350ms after the last keystroke before rewriting the URL.
- The "any" option of every filter control writes an explicit `key=any` token rather than dropping the key, so "explicitly no condition" stays distinct from "never set".
- Using any filter control drops the `limit` param, so a narrowed feed starts back at its first page.
- A saved view restores only three criteria: minimum score, minimum views, and timeframe. A view saved while a search term, an engagement floor, or a band were also set does not restore those.
- The two built-in views, Balanced and High Conviction, are seeded once at install and marked `isSystem`; create, rename, and delete each refuse to touch a system row (`SAVED_VIEW_IS_SYSTEM`). Renaming or deleting a view another tab already deleted returns `SAVED_VIEW_NOT_FOUND`.
- Saved view names are not deduplicated, except the two reserved built-in names; two tabs can both save a view named the same thing and both succeed.
- Layout, density, and sort are not filters: they rewrite the URL but do not surface Clear filters, do not reset the load-more depth, and do not ride along into a detail page link.
- Add post URL opens the same dialog the channels board uses to add a channel, straight to its "Paste post URL" tab, and runs `importReelAction` (`importReelByUrl`) as a foreground request: the button disables to "Importing...", a successful import closes the dialog, shows a "Post imported" toast, and refreshes the feed with the post present. A failed import keeps the dialog open with the reason as an inline alert, not a toast. Re-importing a post that already exists updates the existing video rather than duplicating it.

### Limitations

- Saved view names are not deduplicated across tabs or sessions, an open question tracked as `FEED-Q2` in the [backlog](05-backlog-to-enhance.md).
- The import needs the post-fetch provider (yt-dlp) reachable; with it down, or the post gone, the import fails and the dialog stays open.

### User guide

Narrow the feed with the controls above the grid: pick a minimum score, minimum views, a timeframe, or a follower band, and the grid updates immediately. Type in the search box to filter by caption or channel. To keep a combination of filters, open Saved views, click Save / manage views, name it, and save; it appears in the dropdown from then on. The two built-in views, Balanced and High Conviction, are always available and cannot be renamed or removed. To pull a single post into the feed by hand, click Add post URL, paste a link, and click Import post.

## 4. The quick preview sheet

### Who uses it

Any user scanning the feed who wants a closer look at one card without leaving the grid.

### What it does

Clicking a card slides in a read-only panel from the right, titled "Quick preview". It shows placeholder bars while the video's details load, then fills in the thumbnail with its score, the channel handle, the caption, view/like/comment counts and the post's age, and the first few lines of the transcript, with two buttons: Open full page and Remix.

### How to access it

Click any card, or focus it and press Enter or Space.

### Business rules

- The details are fetched lazily, keyed to the clicked card's id, only once the sheet opens, so scrolling the feed with the sheet closed costs nothing.
- Opening a preview does not add the video to recently viewed; only opening the full detail page does that.
- The sheet works whether or not the LLM proxy, the Graph API, or the sidecar are running, because everything it shows was already stored by an earlier sync or analysis.
- A video with no transcript shows "No transcript yet, open the full page to transcribe."; a stored transcript shows as a four-line excerpt.
- The sheet shows the score, channel, caption, counts, and a transcript excerpt, but not the analysis, the baseline, the carousel, or the save and keep buttons; those live on the full detail page.
- "Open full page" carries the feed's active filter and sort as a query suffix, so the detail page's previous and next navigation resolves against the same ordered set the sheet was opened from.
- The open sheet is client-only state, not in the URL, so a reload returns to the feed with no sheet open. Escape, the close button, or a click on the dimmed area all close it.
- A video the platform has removed still resolves and previews here, marked "No longer on Instagram" the same way the card is. Only a video whose row is truly gone shows "This post couldn't be found."

### Limitations

- The sheet has no error branch on a failed server read: a rejected fetch leaves it stuck on its placeholder bars rather than showing an error or a not-found state, tracked as `FEED-Q3` in the [backlog](05-backlog-to-enhance.md).

### User guide

Click any card to see more without leaving the feed. A panel slides in from the right with the video's score, channel, caption, counts, and the start of its transcript. From there, open the full page for everything, jump straight into Remix, or close the panel and keep scanning.

## 5. The keep this post button

### Who uses it

Any user on a video's detail page who wants to shortlist it.

### What it does

A single star button in the detail page's action row. Unkept, it reads "Keep this post" and opens a small dialog with an optional note. Kept, it reads "Kept" with a filled star, and removing it is one click.

### How to access it

The action row of the [video detail page](#7-the-video-detail-page), next to the save to vault dialog.

### Business rules

- Save is one row per video (`saved_posts` is unique on `video_id`); a second keep on an already-saved video is refused with "That post is already saved", met only in a two-tab race since the button hides Keep once a video is kept.
- The button's kept or not-kept state is a prop off the page's server read, not local state; the refresh after a keep or remove is what flips the label.
- A blank or whitespace-only note is sent as no note and renders as a dash.
- Removing carries an Undo action in its toast that re-creates the row with its original note; removing an already-gone row is a no-op success, so a stale Undo does not error.
- If the video was removed between page load and the click, Keep returns "That post no longer exists" (`SAVED_POST_VIDEO_NOT_FOUND`); the underlying saved row, if any, is already gone with it, since a video's cascade deletes its saved post.
- The write needs no external service.

### Limitations

None of note; this is the most straightforward write in the component.

### User guide

Click Keep this post on any video's detail page to add it to your shortlist, with an optional note on why. Click Kept to remove it; if you change your mind, click Undo in the toast that follows.

## 6. The save to vault dialog

### Who uses it

Any user on an analyzed video's detail page who wants to reuse its hook or its structure and style later.

### What it does

An outline button, "Save to vault", opens a dialog with a three-way choice: Hook, Style, or Both, starting on Hook. Fields below it, a title, a template line, and tags, are prefilled from the video's analysis and editable. Saving writes a `vault_items` row for the chosen type or types, which then appears in the remix studio's hook and style selects.

### How to access it

The action row of the video detail page, next to keep this post. The button is disabled with a tooltip, "Analyze this video first to save hook/style templates", until the video has an analysis.

### Business rules

- Every field is computed client-side from the analysis already on the page, with no further fetch; Save is enabled from the first paint.
- Choosing Hook, Style, or Both decides what is written, captured at the moment Save is clicked; Both writes both items in the same atomic call, so a failure on either one saves neither.
- There is no validation: an empty title or template saves an empty vault item, and a blank tag field saves no tags.
- The fields never reset, on close, cancel, or a successful save; only a page reload recomputes the prefill from the analysis.
- Saving the same video, or the same choice, twice always creates new rows; there is no per-video or per-template cap and no dedupe.
- The write needs no external service; the gate is indirect, an analysis only exists because the LLM proxy produced one earlier.

### Limitations

- There is no undo, unlike keep-this-post's Undo toast; a vault item is removed later on the vault page.

### User guide

Once a video is analyzed, click Save to vault on its detail page to lift its hook, its style, or both into your vault as reusable templates. Review the prefilled title, template text, and tags, edit anything you like, and click Save. The new template shows up the next time you start a remix.

## 7. The video detail page

### Who uses it

Any user studying one video up close, reached from a feed card, the quick preview, a similar-outliers card, or any link carrying a video id.

### What it does

A two-column reading surface at `/feed/{videoId}`. The left column holds the media, the outlier score, the raw metrics, and the median baseline against the channel's own posts. The right column holds a summary and tabs for the transcript, the hook and structure, why it worked, and the layout, with a sticky action row (Remix this, plus the smaller keep, save, copy, and generate actions) at the bottom. A header carries the back link, the position in the feed, and the previous and next controls.

### How to access it

`/feed/{videoId}`, from a card, the quick preview's "Open full page", a similar-outliers card, the recently-viewed list, a channel grid, or a vault card.

### Business rules

- Rendering needs no external service; only the actions launched from it (analyze, generate idea, download) touch the LLM proxy, a transcript provider, or the sidecar.
- Left and right arrow keys page to the previous and next video in the same feed order, carrying the same filter query string; the handler is skipped while a text input, textarea, or contenteditable has focus. A carousel on screen claims the arrow keys for its own slides, including at the first and last slide, and blocks the page-level move.
- The position label and the previous/next controls are absent, not wrong, when the video falls outside the resolved feed slice or past the 5000-post cap (`FEED_ORDER_LIMIT`).
- Opening the page records the video as recently viewed: fire-and-forget, deduped, most recent first, capped at eight ids (`RECENTLY_VIEWED_MAX`), so a slow or failing write never delays the render.
- Six numbers stay above the fold: view count, duration, posted time, and follower count in one row, then likes, comments, and an engagement rate below. A missing value renders as a dash, never a zero; the engagement rate is a dash unless views is above zero and both counts are present.
- The median baseline states its method, window, sample size, and a confidence word; below the channel's minimum usable posts it states the real count instead of drawing a fake bar, and says there is no data to measure against when the channel row is missing entirely.
- A video with no downloaded file shows the thumbnail dimmed behind a Download button, then a spinner, then the real video on success or the real error with the button still present to retry. A carousel renders its children in position order, one at a time, each downloading independently.
- Up to five similar outliers, scored by tag overlap, show in a row below both columns; an empty result says to analyze more videos.
- A soft-removed video still resolves here by id and shows a removed banner plus the last downloaded copy, unlike the feed, which hides it.

### Limitations

- The analysis summary field is rendered on the page but never written by the analysis pass, so it always shows empty. Tracked as `B-10` in the [backlog](05-backlog-to-enhance.md).
- Copy as prompt builds and copies a prompt regardless of analysis state, degrading section by section; Save to Vault stays gated on an analysis existing.

### User guide

Open any post from the feed to study it: the score and the metrics that back it sit on the left, the transcript and the breakdown of what worked sit in tabs on the right. Use the left and right arrow keys, or the prev and next buttons, to move through the same slice you arrived from without going back to the grid. From here you can keep the post, save its hook or style to the vault, or start a remix.

## 8. Interactions with other systems

Persistence and autosave. The grid and its filters write nothing; the URL is the only state the feed page itself carries. Keep this post, save to vault, saved views, and Add post URL are the feed's own durable writes (`saved_posts`, `vault_items`, `saved_filters`, `videos`); each lands as soon as its action succeeds, with no draft or autosave step in between.

Navigation and refresh. `/feed` is a server component that re-reads on every navigation, so a filter change, Load more, or a page link back from the detail page all re-run the query rather than patching client state. The quick preview sheet's open/closed state and its fetched detail are the one piece of this component that lives outside the URL, and a reload drops it.

Background jobs and the sidecar. The feed is a reader, not a writer, of the videos the sidecar sync produces; it is owned in full by [background jobs](../../shared/background-jobs.md). A sidecar that is down or falling behind never errors the feed, it just stops gaining new posts, and every action already documented above (save, vault, keep, remix) still works on what is already stored.

External services. Rendering the feed, the quick preview, and the video detail page touch no external service; only the actions launched from the detail page (analyze, generate idea, download) reach the LLM proxy or a transcript provider, and Add post URL reaches the yt-dlp provider. See [external services](../../shared/external-services.md).

Status and failures. The feed has no failure strip surface of its own; its four empty states are the whole of its own-page failure handling, described above. Add post URL's failure is a dialog-local inline alert, not a toast and not the shell's failure strip. See [status and failures](../../shared/status-and-failures.md).

Configuration and settings. The two built-in saved views, and their default criteria, are seeded once at install in `bootstrap.ts`; changing the seed moves the default view without a code change. `FEED_ORDER_LIMIT` (5000) and `RECENTLY_VIEWED_MAX` (8) are plain constants in code, not settings a user can change.

## 9. Edge cases

- **Two tabs racing the same write.** A second keep on an already-saved video, or a second delete or rename of a saved view another tab already changed, is refused rather than silently duplicated or lost (`SAVED_POST_ALREADY_SAVED`, `SAVED_VIEW_NOT_FOUND`).
- **Re-importing a post by URL updates it in place.** `importReelByUrl` upserts on the same `(platform, external_id)` key a sidecar sync uses, so importing a post already in the feed refreshes its row rather than creating a duplicate.
