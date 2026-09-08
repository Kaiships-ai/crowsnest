# mine: feature description

mine is what fills `/mine`. The user does not go elsewhere to see how their own account is doing or to sketch what they mean to post next: one page owns both, and the two halves deliberately do not depend on each other. The planner (features 5 and 6 below) reads and writes `planned_posts` and needs no external service; publishing a plan (feature 8) is the one planner-side action that does, reaching the Instagram Graph API through the [publish](../publish/01-concept-brief.md) component. The metrics half (features 2, 3, and 7) reads the official Instagram Graph API, kept in a table set (`own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`) entirely separate from the tracked-channel tables ig-sync writes.

Two gates decide what the page shows, and neither is faked when its data is missing. The first is whether any tracked channel is marked as the user's own (`channels.isOwn`); with none, the whole page is the own-channel picker (feature 2). The second is the Graph API token; with it missing or failing, the metrics band is replaced or topped by a connect panel (feature 7) rather than a spinner or zeros. The planner tab strip renders in every state, because it depends on neither gate.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Choose your own channel | Marks one tracked channel as the user's own so the rest of the page has an identity to measure | ● | `src/components/mine/own-channel-picker.tsx`, `setOwnChannelAction` | B-15 |
| 3 | View your own channel dashboard | The header, six stat tiles, progress bar, and reach-by-post bars, gated on the Graph token | ● | `src/app/(shell)/(loaded)/mine/page.tsx`, `own-stat-tiles.tsx`, `reach-by-post-bars.tsx` | none |
| 4 | Browse own posts and weekday metrics | A flat post list and a weekday-average reach chart, both read-only | ● | `reach-by-post-bars.tsx` (`OwnPostList`), `own-weekday-rhythm.tsx` | none |
| 5 | Plan a post | Create or edit a planned post: a dated intention to publish, optionally carrying a script | ● | `plan-dialog.tsx`, `planned-post-actions.ts` | none |
| 6 | Manage the month calendar | The seven-column grid, the day detail panel, marking a plan published, and deleting one | ● | `mine-calendar.tsx`, `markPlanPublishedAction`, `deletePlannedPostAction` | B-09 |
| 7 | Connect and measure the Graph API | Check the token, and run a measurement that fills the own-channel tables | ● | `graph-connect-panel.tsx`, `graph-actions.ts` | none |
| 8 | Publish a planned post | Upload a video, write a caption, then publish now or schedule, cancel a schedule, or retry a failed publish | ● | `publish-dialog.tsx`, `mine-calendar.tsx`, `planned-post-actions.ts` | none |

## 2. Choose your own channel

### Who uses it

The user, on a machine where no tracked channel has been marked own yet.

### What it does

`/mine` opens as a picker instead of the dashboard: a short explanation and a list of every tracked channel not already own, each with a "This is me" button. Clicking one calls `setOwnChannelAction`, which unmarks whatever previously held the flag and marks the chosen channel, inside one transaction so the two updates commit together.

### How to access it

Automatic: it is simply what `/mine` renders when `getOwnChannel()` returns nothing.

### Business rules

- At most one channel can be flagged own at a time, enforced by the partial unique index `channels_single_own`, not only by application logic.
- The clicked row's button disables and relabels to "Setting" while the write runs, so a second row cannot be started at the same time.
- The picker lists every tracked channel that is not already own; on a machine with nothing tracked it shows a message pointing the user to add their Instagram account as a channel first, with no rows to pick.

### Limitations

- There is no control anywhere on `/mine` to clear the own-channel flag once set. `unsetOwnChannelAction` exists in `channel-actions.ts` and is exercised by tests, but no button on this page or its picker calls it (B-15). Switching to a different channel is possible (choosing another candidate reassigns the flag); returning to "no channel marked" is not, from this page.

### User guide

To start using My channel, open it from the sidebar. If no channel is marked as yours yet, you will see a list of every channel you are tracking. Find your own account and click "This is me". Your channel becomes the one this page reports on, and the page switches to your dashboard.

## 3. View your own channel dashboard

### Who uses it

The user, once a channel is marked own.

### What it does

The page shows the channel handle as a header, with a line underneath reading "Graph API, synced" and a relative time when the account has been measured, or "Graph API, not yet measured" when it has not, followed by the tracked follower count when the channel carries one. Below that, when the Graph token is usable and the account has been measured, six stat tiles show followers, reach, saves, shares, median reach, and posts measured, each carrying its own sample size. A thin progress bar shows how far the post count is toward `scoreMinUsablePosts` (default 5), the floor below which a median reach does not exist. A reach-by-post strip shows one bar per post, oldest first, with the printed number always the real reach even though short bars use a visual floor height so a tiny reach is still visible as a bar.

### How to access it

Automatic: it is what `/mine` renders once a channel is own, the Graph token is valid, and the account has been measured at least once.

### Business rules

- The two gates stack rather than replace: a token that fails right now, but a channel measured before, shows the real historical tiles, progress, and bars with the connect panel on top naming the problem, never hiding real numbers because a live check just failed.
- Followers on the tile come from the Graph account snapshot (`own_account_snapshots`); the follower count in the header line comes from the tracked channel's own row (`channels.followerCount`), a different source that can disagree with the tile when one is more recent than the other.
- Three metrics the Graph client does not request (profile visits, follows from post, watch time) have no tile at all, rather than a tile that always reads "not requested".
- The median reach caption changes with the data: below the usable-post floor it counts posts remaining ("N / 5 posts before a median reach appears"); once a median exists it names the sample it was built from.

### Limitations

- The dashboard reflects the last measurement, not a live read of Instagram; numbers update only after `measureOwnChannelAction` runs again and the page reloads or refreshes.
- A missing reach is never shown as zero. A post with no measured reach draws a dashed baseline and a dash for its number, both in the reach-by-post strip and, per feature 4, in the post list and weekday averages.

### User guide

Once your channel is connected and measured, My channel opens on your dashboard: your handle, when you were last measured, six numbers about your recent posts, a progress bar toward a reliable median, and a strip of bars showing the reach of each of your posts in the order you posted them. If a number has not been measured yet, it shows a dash rather than a misleading zero.

## 4. Browse own posts and weekday metrics

### Who uses it

The user, from the Posts and Metrics tabs on `/mine`.

### What it does

Posts is a flat list of every own post the Graph API has recorded, newest first, each row showing a caption, a reach number with a small bar, a length, and how long ago it went up; clicking a row opens that post's Instagram permalink in a new browser tab. Metrics is a bar chart of average reach by weekday, one bar per day, each with a post count beneath it. Both read the same one server load of the user's own posts (`getOwnPosts({ limit: 100 })`) that the page fetches once and hands to every display, including the reach-by-post strip in feature 3.

### How to access it

The Posts and Metrics triggers in the tab strip below the dashboard. Both render regardless of the Graph gate; when nothing has been measured they show their own empty state instead of an error.

### Business rules

- Only the newest 100 own posts are loaded. The list, the weekday averages, and the reach-by-post strip all compute over that same 100; the dashboard's total post count reflects every measured post, not only the loaded page.
- A missing caption renders as "Untitled post"; a missing duration renders as a dash in the Length column; a missing reach is excluded from the weekday averages rather than counted as zero.
- The list orders newest first; the reach-by-post strip in feature 3 orders oldest first, to match the calendar's reading direction, so the same posts appear in opposite order in the two places on purpose.

### Limitations

- These displays are read-only. Nothing on them writes a row, opens a dialog, or starts a generation; the only interactions are switching tabs and opening a post on Instagram.
- With only a handful of measured posts spread across seven weekdays, most days carry one post or none; the weekday chart's own caption says to read it as a reading, not a rhythm, until there is more data.

### User guide

Click Posts to see every one of your own posts the app has measured, most recent first, with its reach, length, and when it went up. Click a post to open it on Instagram in a new tab. Click Metrics to see your average reach by day of the week, which becomes more meaningful the more posts you have measured.

## 5. Plan a post

### Who uses it

The user, from the month calendar (feature 6).

### What it does

The plan dialog creates a new planned post or edits an existing one. A planned post is a dated intention to publish, optionally carrying a script, a video kind, and (when it came from a source video) a remix session link; the plan dialog itself neither publishes nor reminds, and publishing a plan is a separate step (feature 8). Clicking an empty day, or "New planned post", opens it in create mode with the date prefilled; clicking an existing plan opens it in edit mode with that plan's fields loaded. A plan with no script is allowed, but only on purpose: with no script selected, an "I don't have a script yet" checkbox must be ticked before Save enables.

### How to access it

The "New planned post" button and empty-day clicks on the month calendar, and clicking an existing plan's cell.

### Business rules

- A date present at save writes a `scheduled` plan; a blank date writes a `draft`. On edit, giving a dateless plan a date schedules it, and clearing a scheduled plan's date returns it to draft. A date in the past is accepted, not refused; it reads as `missed` on the calendar, computed on read, not stored.
- Create is a single write. Edit is one write too: `savePlanEditAction` takes only the fields that changed, validates all of them up front, then applies them in a single transaction, so a rejected edit changes nothing and a failure never leaves a partial write.
- A plan carrying a script from a remix session cannot have that script changed or removed in this dialog; the script select is replaced by a line pointing to the vault instead. Other fields on such a plan stay editable.
- Detaching a script writes a note ("Script detached on {date}.") so the plan reads as one that lost its script, distinct from one that never had one; attaching a new script clears that note.
- A blank or whitespace-only title is refused on both create and edit; the title is trimmed before the check.
- The video kind select offers exactly the fixed eight kinds (explainer, site-tour, product-promo, music-video, pr-announcement, talking-head, slideshow, general); the action's `BAD_VIDEO_KIND` refusal exists to guard a crafted request, since the UI cannot produce an unrecognized value.

### Limitations

- There is no time field and no target-length field anywhere in this dialog, even though the underlying record can hold both; other paths (a remix finish, or scheduling through the publish dialog) can set them, and editing through this dialog preserves whatever value they already have.
- Marking a plan published, deleting a plan, and publishing a plan are not in this dialog; those live on the calendar (features 6 and 8).
- The checkbox copy states that a scriptless plan "gets flagged stale after 30 days if it still has neither"; no code path in this repository currently computes or renders that flag anywhere, so the copy currently describes behavior that does not exist yet.

### User guide

To plan a post, click a day on the calendar, or click New planned post. Give it a title, optionally a note, optionally a script and a video kind, and save. If you have not written a script yet, tick the box saying so, so the plan is clearly marked as an idea rather than looking finished. To change a plan later, click it on the calendar, edit any field, and save again. When you are ready to publish it, open it on the calendar and use Upload and schedule (feature 8).

## 6. Manage the month calendar

### Who uses it

The user, on the Month tab of `/mine`, the default tab.

### What it does

The calendar is a seven-column grid, Monday through Sunday, of the current month. Each day cell shows what published (when the channel has been measured), what is planned, or nothing, and a plan that is mid-publish shows its lifecycle instead (scheduled, publishing, or failed). Clicking a day opens a detail panel with that day's date, the plan's title, state, note, and script; from there the user can open the plan for editing, mark it published, delete it, or take it through publish (feature 8). Cell precedence is fixed: published wins over publishing, publishing over failed, failed over missed, missed over scheduled, scheduled over dead air, dead air over open, so a day that both published and carried a plan reads as published.

### How to access it

The Month trigger in the tab strip; it is the tab the page opens on. The previous, next, and Today controls change the `?month=` query parameter and reload the page for that month.

### Business rules

- "Missed" is never stored. `getCalendarMonth` computes it on every read from today against a `scheduled` plan's `plannedDate`; there is no code path in this component that writes it.
- A plan marked published (even on a past date) reads as published, not missed, because published is checked ahead of missed in the cell precedence.
- Marking a plan published writes `publishedOwnPostId` and the plan's `state`, then re-reads the month; the toast reads "Marked published" when reconciled against a matching own post, or "Marked published, no post linked" otherwise.
- Deleting a plan removes the row, closes the panel, re-reads, and shows a "Planned post deleted" toast with an Undo action. A plan that carries an uploaded video asks for confirmation first, through a designed confirm dialog rather than the browser's native prompt. The Undo re-creates the plan from its title, note, date, and script only; it does not restore the original row's id, remix session link, source video link, video kind, planned time, target length, or published mark (B-09).
- Dead-air shading (three or more elapsed days with nothing published) and the reconciliation prompt both depend on the channel having been measured at least once; with no measurement, the grid still renders every plan, and a line above it explains that the rest is unavailable.
- The reconciliation prompt (a plan and an own post sharing a date) is a suggestion the user must click to accept; it is never applied automatically, and it stops appearing once the plan is marked published by hand.
- There is no drag anywhere on this grid. Rescheduling a plan is a date-field edit in the plan dialog; day cells are plain buttons.

### Limitations

- The undated-drafts list below the grid holds every plan with no date, across every month; a dated plan never appears there.
- Dead air never extends into the future; a run of empty days is truncated at today, since a day that has not happened yet cannot be missed.

### User guide

The Month tab is what you see when you open My channel. Days you have planned show their title; a day that passed without you marking or publishing it shows as missed, in red; a day you actually published on shows the reach it earned, once your account has been measured. Click any day to see its detail, plan something new, mark it published, or delete it. Deleting offers an Undo, though the restored plan may be missing a few of its original links. Use the arrows or Today to move between months.

## 7. Connect and measure the Graph API

### Who uses it

The user, from the connect panel that stands in for, or stacks above, the metrics band.

### What it does

"Check connection" calls `checkGraphTokenAction`, the cheapest authenticated call, and updates the panel's status text in place; when the token reads `ok`, the page refreshes so the metrics can appear. "Measure now" (shown only when the token is `ok` but nothing has been measured yet) calls `measureOwnChannelAction`, a full run: fetch the account and write a snapshot, upsert every post with a fresh insights row, then fetch and upsert comments, and refresh on success.

### How to access it

The connect panel, which renders automatically whenever the Graph token is not configured, is invalid, or the account has never been measured.

### Business rules

- The panel's copy is state-specific: not configured, rejected (`auth_failed`), rate limited, unreachable (`network`), unknown, or, when the token is ok but nothing has been measured, "Connected, nothing measured yet" with the one button that state offers, "Measure now".
- Account and posts failing during a measurement is a hard failure with no partial write; comments failing after the account and posts succeeded returns success with `partial: true`, since posts measured with comments missing is still a useful result.
- A metric Instagram does not disclose, or that the client does not request, is stored as null, never as zero; every display downstream treats a null differently from a real zero.
- Each button disables itself while its own call is in flight ("Checking", "Measuring"), so a second click cannot start a second run of the same action.

### Limitations

- The Graph token is environment-only configuration (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID` in `.env.local`); there is no Settings page control for it yet, so an invalid or missing token can only be fixed by editing that file and restarting the app.
- A measurement failing on the account or posts call shows the reason as a toast and leaves the panel exactly where it was; there is no retry-with-backoff built into this action, only whatever the user does by clicking again.
- This page has no failure-strip surface of its own. Success and failure both show as toasts and as the panel's own status copy; nothing here reaches the shell's shared failure strip, which is specific to sync jobs.

### User guide

If My channel shows a message about connecting instead of your numbers, click Check connection to see the current state. Once it reads connected, click Measure now to pull your real posts and their reach, saves, and shares from Instagram. This can take a moment; when it finishes, a toast tells you how many posts were measured and the dashboard fills in.

## 8. Publish a planned post

### Who uses it

The user, from a plan's day detail panel on the month calendar, once a plan is ready to go up.

### What it does

The publish dialog takes one planned post from a draft to a published Instagram Reel. It uploads an mp4, writes the Reel's caption, and then either publishes it now or schedules it for a chosen date and time. It opens from the day panel of a plan in a `draft`, `scheduled`, `missed`, or `failed` state, through an "Upload and schedule" button (which reads "Edit publish" once a video is attached). The same day panel also renders the rest of the lifecycle without the dialog: a scheduled plan shows when it will publish, a plan being published shows a "publishing" pulse, a failed plan shows its error class and message with a Retry button, and a published plan shows a check with a link to the post. A scheduled plan can be cancelled from the panel, which returns it to an undated draft while keeping its video and caption. The pipeline that actually uploads, builds the Reel, and fires a scheduled publish belongs to the [publish](../publish/01-concept-brief.md) component; this feature is the mine-side surface that drives it.

### How to access it

The "Upload and schedule" (or "Edit publish") button in a plan's day detail panel opens the dialog. The "cancel scheduled publish" link appears in the panel once a plan has a scheduled time, and the Retry button appears on a failed plan that is still under the attempt cap.

### Business rules

- Only an mp4 is accepted; the dialog refuses any other file by type and extension before it uploads.
- The caption is capped at Instagram's 2200-character ceiling, shown as a live count, and saved both when the field loses focus and again on submit.
- There is exactly one primary action, and its label is the whole decision: "Schedule" when both a date and a time are set, "Publish now" when they are not. It stays disabled until a video is attached, a caption is written, and both the Graph token and the storage bucket are configured.
- When the Graph token or the storage bucket is not configured, the dialog names exactly which variables are missing (`IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID`, or the five `S3_*` variables) and disables the action, but the video and the caption still save, so the plan keeps its draft rather than losing the work.
- A publish can only be scheduled forward: a past date is never pre-filled, and the date field's minimum is today.
- Dry run is the safe default off production and shows a banner saying the final publish call is skipped, so a dev machine can rehearse the whole path without touching the live account.
- Cancelling a scheduled publish, and deleting a plan that carries an uploaded video, both go through a designed confirm dialog rather than the browser's native prompt.
- Retry is offered only while the plan is under the attempt cap, and `retryFailedPublishAction` refuses an over-cap retry regardless of what the UI shows.

### Limitations

- Publishing needs both the Instagram Graph token and an S3-compatible bucket set in the environment; without them the dialog can attach a video and save a caption but cannot publish, and there is no in-app settings control for either yet.
- There is no upload progress bar and no live container-poll progress; while a publish runs the cell shows a "publishing" pulse and the outcome appears on the next refresh.
- Recovery from a process killed mid-publish (a row left in `publishing`) is not handled from this page; that is an open item of the [publish](../publish/02-architecture.md) component.

### User guide

When a plan is ready to go up, open it on the calendar and click Upload and schedule. Drop in your mp4, write the caption, and either pick a date and time to schedule it or leave the time blank to publish now. If publishing is not set up yet, the dialog tells you exactly which settings are missing; your video and caption still save so nothing is lost. A scheduled plan shows when it will publish and can be cancelled back to a draft; a plan that fails shows why and offers Retry; a published plan shows a check and a link to the post.
