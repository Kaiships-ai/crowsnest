# mine: feature description

mine is the user's own side of crowsnest: how their own Instagram account is doing, and what they mean to post next. It lives on the Dashboard at `/`, which carries three tabs: Overview (the research dashboard, owned by the dashboard, unchanged), My reels (own-account insights, feature 10 onward), and Calendar (the planner and publisher, features 5, 6, and 8). The tab lives in the URL as `?tab=overview|reels|calendar`. The old `/mine` route redirects to the Dashboard and leaves the sidebar (feature 9).

The two halves deliberately do not depend on each other. The planner reads and writes `planned_posts` and needs no external service; publishing a plan (feature 8) is the one planner-side action that does, reaching the Instagram Graph API through the [publish](../publish/01-concept-brief.md) component. My reels reads the official Instagram Graph API at `graph.instagram.com`, kept in a table set (`own_account_snapshots`, `own_posts`, `own_post_insights`, `own_comments`) entirely separate from the tracked-channel tables ig-sync writes.

Two gates decide what the own-account tabs show, and neither is faked when its data is missing. The first is whether any tracked channel is marked as the user's own (`channels.isOwn`); with none, My reels and Calendar show the own-channel picker (feature 2). The second is the Graph API token; with it missing or rejected, My reels shows the connect panel (feature 7) rather than a spinner or zeros. The planner works without a token.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Choose your own channel | Marks one tracked channel as the user's own so the rest of the page has an identity to measure | ● | `src/components/mine/own-channel-picker.tsx`, `setOwnChannelAction` | B-15 |
| 3 | View your own channel dashboard | The header, six stat tiles, progress bar, and reach-by-post bars at the top of My reels, gated on the Graph token | ● | `src/components/mine/my-reels-tab.tsx`, `own-stat-tiles.tsx`, `reach-by-post-bars.tsx` | none |
| 4 | Browse own posts and weekday metrics | A flat post list and a weekday-average reach chart, both read-only sections of My reels | ● | `reach-by-post-bars.tsx` (`OwnPostList`), `own-weekday-rhythm.tsx` | none |
| 5 | Plan a post | Create or edit a planned post: a dated intention to publish, optionally carrying a script | ● | `plan-dialog.tsx`, `planned-post-actions.ts` | none |
| 6 | Manage the month calendar | The seven-column grid, the day detail panel, marking a plan published, and deleting one | ● | `mine-calendar.tsx`, `markPlanPublishedAction`, `deletePlannedPostAction` | B-09, B-17 |
| 7 | Connect and measure the Graph API | Check the token, and run a measurement that fills the own-channel tables | ● | `graph-connect-panel.tsx`, `graph-actions.ts`, `src/server/services/own-measure.ts` | none |
| 8 | Publish a planned post | Upload a video, write a caption, then publish now or schedule, cancel a schedule, or retry a failed publish | ● | `publish-dialog.tsx`, `mine-calendar.tsx`, `planned-post-actions.ts` | none |
| 9 | Dashboard tabs and the `/mine` redirect | Overview, My reels, and Calendar tabs on `/`, tab held in `?tab=`, `/mine` redirecting there | ● | `src/app/(shell)/(loaded)/page.tsx`, `src/components/dashboard/dashboard-tabs.tsx`, `src/app/(shell)/(loaded)/mine/route.ts` (redirect), `src/components/layout/nav-items.ts` | none |
| 10 | Pick a reel | The own-account summary plus a newest-first reel list; choosing a reel opens its insight panel, held in `?reel=` | ● | `src/components/mine/my-reels-tab.tsx`, `src/components/mine/reel-picker.tsx` | none |
| 11 | Read one reel's insights | Summary tiles, interaction strip, what impacts your views, actions after viewing, and labelled placeholders for what the API does not give | ● | `src/components/mine/reel-insight-panel.tsx`, `src/server/services/reel-insights.ts`, `src/server/graph/client.ts` | Newer metrics unverified live |
| 12 | Compare views over time | One reel's measured views by hours since posting, against the median of the other reels | ● | `src/components/mine/reel-views-over-time.tsx`, `src/server/services/reel-insights.ts` | Live cadence unverified, needs a valid Graph token |
| 13 | See account-wide audience | Followers vs non-followers and Age, Country, Gender tabs, labelled as the whole account | ● | `src/components/mine/account-audience.tsx`, `src/server/graph/client.ts` | Unverified live |
| 14 | Scheduled measurement | A background job that measures the own channel hourly for new reels and daily for older ones | ● | `src/server/services/own-measure-scheduler.ts`, `src/server/services/own-measure.ts` | Live cadence unverified, needs a valid Graph token |

## 2. Choose your own channel

### Who uses it

The user, on a machine where no tracked channel has been marked own yet.

### What it does

The own-account tabs open as a picker instead of their content: a short explanation and a list of every tracked channel not already own, each with a "This is me" button (`own-channel-picker-choose`). Clicking one calls `setOwnChannelAction`, which unmarks whatever previously held the flag and marks the chosen channel, inside one transaction so the two updates commit together.

### How to access it

Automatic: it is what the My reels and Calendar tabs render when `getOwnChannel()` returns nothing.

### Business rules

- At most one channel can be flagged own at a time, enforced by the partial unique index `channels_single_own`, not only by application logic.
- The clicked row's button disables and relabels to "Setting" while the write runs, so a second row cannot be started at the same time.
- The picker lists every tracked channel that is not already own; on a machine with nothing tracked it shows a message pointing the user to add their Instagram account as a channel first, with no rows to pick.
- The Overview tab never shows the picker; it does not depend on an own channel.

### Limitations

- There is no control to clear the own-channel flag once set. `unsetOwnChannelAction` exists in `channel-actions.ts` and is exercised by tests, but no button calls it. Switching to a different channel is possible (choosing another candidate reassigns the flag); returning to "no channel marked" is not.

### User guide

Open the Dashboard and click the My reels or Calendar tab. If no channel is marked as yours yet, you see a list of every channel you are tracking. Find your own account and click "This is me". Your channel becomes the one these tabs report on, and the tab switches to its content.

## 3. View your own channel dashboard

### Who uses it

The user, once a channel is marked own.

### What it does

The page shows the channel handle as a header, with a line underneath reading "Graph API, synced" and a relative time when the account has been measured, or "Graph API, not yet measured" when it has not, followed by the tracked follower count when the channel carries one. Below that, when the Graph token is usable and the account has been measured, six stat tiles (`mine-stat-tile`) show followers, reach, saves, shares, median reach, and posts measured, each carrying its own sample size. A thin progress bar shows how far the post count is toward `scoreMinUsablePosts` (default 5), the floor below which a median reach does not exist. A reach-by-post strip (`mine-reach-bars`) shows one bar per post, oldest first, with the printed number always the real reach even though short bars use a visual floor height so a tiny reach is still visible as a bar.

In the reworked design this whole block becomes the account summary at the top of the My reels tab (feature 10), with the same gates and rules.

### How to access it

Automatic: the top of the My reels tab, once a channel is own and the account has been measured at least once.

### Business rules

- The two gates stack rather than replace: a token that fails right now, but a channel measured before, shows the real historical tiles, progress, and bars with the connect panel on top naming the problem, never hiding real numbers because a live check just failed.
- With no token configured at all, the connect panel shows alone, even over an account measured before.
- Followers on the tile come from the Graph account snapshot (`own_account_snapshots`); the follower count in the header line comes from the tracked channel's own row (`channels.followerCount`), a different source that can disagree with the tile when one is more recent than the other.
- The median reach caption changes with the data: below the usable-post floor it counts posts remaining ("N / 5 posts before a median reach appears"); once a median exists it names the sample it was built from.

### Limitations

- The dashboard reflects the last measurement, not a live read of Instagram; numbers update only after a measurement runs (feature 7 or feature 14) and the page reloads or refreshes.
- A missing reach is never shown as zero. A post with no measured reach draws a dashed baseline and a dash for its number, both in the reach-by-post strip and, per feature 4, in the post list and weekday averages.

### User guide

Once your channel is connected and measured, My reels opens on your account summary: your handle, when you were last measured, six numbers about your recent posts, a progress bar toward a reliable median, and a strip of bars showing the reach of each of your posts in the order you posted them. If a number has not been measured yet, it shows a dash rather than a misleading zero.

## 4. Browse own posts and weekday metrics

### Who uses it

The user, on the My reels tab.

### What it does

Posts is a flat list of every own post the Graph API has recorded, newest first, each row (`mine-post-row`) showing a caption, a reach number with a small bar, a length, and how long ago it went up; clicking a row opens that post's Instagram permalink in a new browser tab. Metrics is a bar chart of average reach by weekday, one bar per day (`mine-weekday-bar`), each with a post count beneath it. Both read the same one server load of the user's own posts (`getOwnPosts({ limit: 100 })`) that the page fetches once and hands to every display, including the reach-by-post strip in feature 3.

The reel picker (feature 10) lists reels only, so the flat post list stays in My reels for every own post, carousels included.

### How to access it

The Posts and Average reach by weekday sections at the bottom of the My reels tab. Both render regardless of the Graph gate; when nothing has been measured they show their own empty state instead of an error.

### Business rules

- Only the newest 100 own posts are loaded. The list, the weekday averages, and the reach-by-post strip all compute over that same 100; the dashboard's total post count reflects every measured post, not only the loaded page.
- A missing caption renders as "Untitled post"; a missing duration renders as a dash in the Length column; a missing reach is excluded from the weekday averages rather than counted as zero.
- The list orders newest first; the reach-by-post strip in feature 3 orders oldest first, to match the calendar's reading direction, so the same posts appear in opposite order in the two places on purpose.

### Limitations

- These displays are read-only. Nothing on them writes a row, opens a dialog, or starts a generation; the only interaction is opening a post on Instagram.
- With only a handful of measured posts spread across seven weekdays, most days carry one post or none; the weekday chart's own caption says to read it as a reading, not a rhythm, until there is more data.

### User guide

On the My reels tab, scroll to Posts to see every one of your own posts the app has measured, most recent first, with its reach, length, and when it went up. Click a post to open it on Instagram in a new tab. Below it, the weekday chart shows your average reach by day of the week, which becomes more meaningful the more posts you have measured.

## 5. Plan a post

### Who uses it

The user, from the month calendar (feature 6).

### What it does

The plan dialog creates a new planned post or edits an existing one. A planned post is a dated intention to publish, optionally carrying a script, a video kind, and (when it came from a source video) a remix session link; the plan dialog itself neither publishes nor reminds, and publishing a plan is a separate step (feature 8). Clicking an empty day, or "New planned post", opens it in create mode with the date prefilled; clicking an existing plan opens it in edit mode with that plan's fields loaded. A plan with no script is allowed, but only on purpose: with no script selected, an "I don't have a script yet" checkbox (`plan-dialog-no-script-ack`) must be ticked before Save (`plan-dialog-save`) enables. The other fields are the title (`plan-dialog-title`), script (`plan-dialog-script`), date (`plan-dialog-date`), and video kind (`plan-dialog-video-kind`).

### How to access it

The "New planned post" button and empty-day clicks on the month calendar, and clicking an existing plan's cell. The calendar lives on the Calendar tab.

### Business rules

- A date present at save writes a `scheduled` plan; a blank date writes a `draft`. On edit, giving a dateless plan a date schedules it, and clearing a scheduled plan's date returns it to draft. A date in the past is accepted, not refused; it reads as `missed` on the calendar, computed on read, not stored.
- Create is a single write. Edit is one write too: `savePlanEditAction` takes only the fields that changed, validates all of them up front, then applies them in a single transaction, so a rejected edit changes nothing and a failure never leaves a partial write.
- A plan carrying a script from a remix session cannot have that script changed or removed in this dialog; the script select is replaced by a line pointing to the vault instead. Other fields on such a plan stay editable.
- Detaching a script writes a note ("Script detached on {date}.") so the plan reads as one that lost its script, distinct from one that never had one; attaching a new script clears that note.
- A blank or whitespace-only title is refused on both create and edit; the title is trimmed before the check.
- The video kind select offers exactly the fixed eight kinds (explainer, site-tour, product-promo, music-video, pr-announcement, talking-head, slideshow, general); the action's `BAD_VIDEO_KIND` refusal exists to guard a crafted request, since the UI cannot produce an unrecognized value.
- The planner needs no Graph token.

### Limitations

- There is no time field and no target-length field anywhere in this dialog, even though the underlying record can hold both; other paths (a remix finish, or scheduling through the publish dialog) can set them, and editing through this dialog preserves whatever value they already have.
- Marking a plan published, deleting a plan, and publishing a plan are not in this dialog; those live on the calendar (features 6 and 8).
- The checkbox copy states that a scriptless plan "gets flagged stale after 30 days if it still has neither"; no code path in this repository currently computes or renders that flag anywhere, so the copy describes behavior that does not exist yet.

### User guide

To plan a post, open the Calendar tab and click a day, or click New planned post. Give it a title, optionally a note, optionally a script and a video kind, and save. If you have not written a script yet, tick the box saying so, so the plan is clearly marked as an idea rather than looking finished. To change a plan later, click it on the calendar, edit any field, and save again. When you are ready to publish it, open it on the calendar and use Upload and schedule (feature 8).

## 6. Manage the month calendar

### Who uses it

The user, on the Calendar tab of the Dashboard.

### What it does

The calendar is a seven-column grid, Monday through Sunday, of the current month. Each day cell (`mine-calendar-day`) shows what published (when the channel has been measured), what is planned, or nothing, and a plan that is mid-publish shows its lifecycle instead (scheduled, publishing, or failed). Clicking a day opens a detail panel with that day's date, the plan's title, state, note, and script; from there the user can open the plan for editing, mark it published (`mine-calendar-mark-published`), delete it (`mine-plan-delete`), or take it through publish (feature 8). Cell precedence is fixed: published wins over publishing, publishing over failed, failed over missed, missed over scheduled, scheduled over dead air, dead air over open, so a day that both published and carried a plan reads as published.

### How to access it

The Calendar tab (`?tab=calendar`). The previous, next, and Today controls change the `?month=` query parameter, keeping `tab=calendar`, and reload the page for that month.

### Business rules

- "Missed" is never stored. `getCalendarMonth` computes it on every read from today against a `scheduled` plan's `plannedDate`; there is no code path in this component that writes it.
- A plan marked published (even on a past date) reads as published, not missed, because published is checked ahead of missed in the cell precedence.
- Marking a plan published writes `publishedOwnPostId` and the plan's `state`, then re-reads the month; the toast reads "Marked published" when reconciled against a matching own post, or "Marked published, no post linked" otherwise.
- Deleting a plan removes the row, closes the panel, re-reads, and shows a "Planned post deleted" toast with an Undo action (`mine-delete-undo`). A plan that carries an uploaded video asks for confirmation first, through a designed confirm dialog rather than the browser's native prompt. The Undo re-creates the plan from its title, note, date, and script only; it does not restore the original row's id, remix session link, source video link, video kind, planned time, target length, or published mark.
- Dead-air shading (three or more elapsed days with nothing published) and the reconciliation prompt both depend on the channel having been measured at least once; with no measurement, the grid still renders every plan, and a line above it explains that the rest is unavailable.
- The reconciliation prompt (a plan and an own post sharing a date) is a suggestion the user must click to accept; it is never applied automatically, and it stops appearing once the plan is marked published by hand.
- There is no drag anywhere on this grid. Rescheduling a plan is a date-field edit in the plan dialog; day cells are plain buttons.
- On the Dashboard, the month controls keep `tab=calendar` in the URL alongside `month=`, so moving between months never drops the user back on Overview.

### Limitations

- The undated-drafts list below the grid holds every plan with no date, across every month; a dated plan never appears there.
- Dead air never extends into the future; a run of empty days is truncated at today, since a day that has not happened yet cannot be missed.

### User guide

Open the Calendar tab on the Dashboard. Days you have planned show their title; a day that passed without you marking or publishing it shows as missed, in red; a day you actually published on shows the reach it earned, once your account has been measured. Click any day to see its detail, plan something new, mark it published, or delete it. Deleting offers an Undo, though the restored plan may be missing a few of its original links. Use the arrows or Today to move between months.

## 7. Connect and measure the Graph API

### Who uses it

The user, from the connect panel that stands in for, or stacks above, the own-account metrics.

### What it does

The connect panel (`mine-connect-panel`) names the token state. "Check connection" (`mine-connect-check`) calls `checkGraphTokenAction`, the cheapest authenticated call, and updates the panel's status text in place; when the token reads `ok`, the page refreshes so the metrics can appear. "Measure now" (`mine-connect-measure`, shown only when the token is `ok` but nothing has been measured yet) calls `measureOwnChannelAction`, a full run through the shared measurement service: fetch the account and write a snapshot, upsert every post with a fresh insights row, then fetch and upsert comments when the call budget allows, and refresh the page whatever the outcome, so rows written before a failure still show; the panel then shows the refreshed token state, not the one it first rendered with. An unexpected error (a database error, say) comes back as a failure toast, never an unhandled error. The success toast reads how many posts were measured of how many were seen, and says when the run stopped early and why (the Instagram rate limit, the hourly call budget, or recent scheduled measurements having already spent most of this hour's calls). When this hour's calls are already spent before the run could even read the account, nothing is measured or written and the toast says so. Measure now has a budget of 190 calls, close to Instagram's 200 an hour.

### How to access it

The connect panel, which renders automatically on My reels whenever the Graph token is not configured, is rejected, or the account has never been measured.

### Business rules

- The panel's copy is state-specific: not configured, rejected (`auth_failed`), missing a permission (`permission_denied`, asking for a new token with the insights permissions and saying Check connection cannot see this permission, so the next measurement re-verifies it), rate limited, unreachable (`network`), unknown, or, when the token is ok but nothing has been measured, "Connected, nothing measured yet" with the one button that state offers, "Measure now".
- Account and posts failing during a measurement is a hard failure with no partial write. An auth refusal after some posts were measured is also a failure, and the rows already written stay. Every listed post is stored before insights are fetched, so a post the run never reached still appears; comments failing after the account and posts succeeded returns success with `partial: true`, since posts measured with comments missing is still a useful result.
- A metric Instagram does not disclose, or that the client does not request, is stored as null, never as zero; every display downstream treats a null differently from a real zero.
- Each button disables itself while its own call is in flight ("Checking", "Measuring"), so a second click cannot start a second run of the same action.
- The token is read through the secrets store: a value set in Settings > API keys (`IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID`) wins over `.env.local` and takes effect without a restart.
- "Measure now" and scheduled measurement (feature 14) run the same service and write the same tables. When a scheduled measurement is running, "Measure now" waits for it to finish, then runs.

### Limitations

- The panel copy and the not-configured error message still tell the user to set the token in `.env.local` and restart, and do not mention Settings > API keys, which is the faster path.
- A measurement failing on the account or posts call shows the reason as a toast, and the panel shows whatever token state the refresh brings back; there is no retry-with-backoff built into this action, only whatever the user does by clicking again.
- There is no failure-strip surface here. Success and failure both show as toasts and as the panel's own status copy; nothing here reaches the shell's shared failure strip, which is specific to sync jobs.

### User guide

If My reels shows a message about connecting instead of your numbers, paste your Graph token and Graph user ID in Settings > API keys, then come back and click Check connection. Once it reads connected, click Measure now to pull your real posts and their numbers from Instagram. This can take a moment; when it finishes, a toast tells you how many posts were measured and the tab fills in.

## 8. Publish a planned post

### Who uses it

The user, from a plan's day detail panel on the month calendar, once a plan is ready to go up.

### What it does

The publish dialog (`publish-dialog`) takes one planned post from a draft to a published Instagram Reel. It uploads an mp4, writes the Reel's caption, and then either publishes it now or schedules it for a chosen date and time. It opens from the day panel of a plan in a `draft`, `scheduled`, `missed`, or `failed` state, through an "Upload and schedule" button (`mine-plan-open-publish`, which reads "Edit publish" once a video is attached). The same day panel also renders the rest of the lifecycle without the dialog: a scheduled plan shows when it will publish, a plan being published shows a "publishing" pulse, a failed plan shows its error class and message with a Retry button (`mine-plan-retry`), and a published plan shows a check with a "view post" link that opens that reel on My reels (`/?tab=reels&reel=<id>`). A scheduled plan can be cancelled from the panel (`mine-plan-cancel-publish`), which returns it to an undated draft while keeping its video and caption. The pipeline that actually uploads, builds the Reel, and fires a scheduled publish belongs to the [publish](../publish/01-concept-brief.md) component; this feature is the mine-side surface that drives it.

### How to access it

The "Upload and schedule" (or "Edit publish") button in a plan's day detail panel on the Calendar tab opens the dialog. The "cancel scheduled publish" link appears in the panel once a plan has a scheduled time, and the Retry button appears on a failed plan that is still under the attempt cap.

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

- Publishing needs both the Instagram Graph token and an S3-compatible bucket; without them the dialog can attach a video and save a caption but cannot publish. The token can be set in Settings > API keys; the bucket has no in-app settings control yet.
- There is no upload progress bar and no live container-poll progress; while a publish runs the cell shows a "publishing" pulse and the outcome appears on the next refresh.
- Recovery from a process killed mid-publish (a row left in `publishing`) is not handled from this page; that is an open item of the [publish](../publish/02-architecture.md) component.

### User guide

When a plan is ready to go up, open it on the Calendar tab and click Upload and schedule. Drop in your mp4, write the caption, and either pick a date and time to schedule it or leave the time blank to publish now. If publishing is not set up yet, the dialog tells you exactly which settings are missing; your video and caption still save so nothing is lost. A scheduled plan shows when it will publish and can be cancelled back to a draft; a plan that fails shows why and offers Retry; a published plan shows a check and a link to the post.

## 9. Dashboard tabs and the `/mine` redirect

### Who uses it

The user, every time they open the Dashboard.

### What it does

The Dashboard at `/` carries a tab strip with three tabs: Overview (`dashboard-tab-overview`), My reels (`dashboard-tab-reels`), and Calendar (`dashboard-tab-calendar`). Overview is the existing research dashboard, unchanged. My reels holds features 3, 4, and 10 to 13. Calendar holds features 5, 6, and 8. The selected tab lives in the URL as `?tab=overview|reels|calendar`, so a reload, a back button, or a shared link lands on the same tab. The `/mine` route renders no page of its own; it answers a real 307 redirect to the Dashboard; the sidebar has no "My channel" entry.

### How to access it

Open the Dashboard from the sidebar. The remix finish step's "View in your plan" and the vault script dialog's "Open the planner" link straight to the Calendar tab; old links and bookmarks to `/mine` land there through the redirect.

### Business rules

- A missing or unknown `tab` value means Overview.
- `/mine` redirects to `/?tab=calendar`, carrying a valid `month=` (`YYYY-MM`) and nothing else, since `/mine` was the planner.
- Each tab loads only its own data. Opening Overview does not call the Graph API, and opening My reels does not run the Overview's sidecar and model pings.
- The tab strip renders above every state of every tab, including Overview's "no channels are being watched" empty state and the own-channel picker, so the user can always move between tabs.
- Planner and measurement actions revalidate `/`, so a write shows up on the tab the user is looking at. Measure now revalidates even when the run fails, since rows written before the failure stay.

### Limitations

- Overview keeps its own content and empty states; this feature only hosts it. Its behavior is documented by the dashboard component, not here.

### User guide

The Dashboard has three tabs. Overview is the research dashboard you already know. My reels shows how your own reels are doing. Calendar is where you plan and publish. The tab you pick stays in the address bar, so you can bookmark or share it. If you had My channel bookmarked, it now opens the Calendar tab.

## 10. Pick a reel

### Who uses it

The user, on the My reels tab, once a channel is own and the account has been measured.

### What it does

My reels opens with the account summary from feature 3, then a list of the user's reels, newest first. Each item (`reels-picker-item`) shows the reel's thumbnail, the date it was posted, and its latest measured views. Choosing a reel shows its insight panel (feature 11) and writes the choice to the URL as `?reel=<id>`. The id can also be the reel's Instagram media id, which is what the calendar's "view post" link carries for a plan crowsnest published itself. The post list and weekday chart from feature 4 sit inside the tab too, for posts that are not reels.

### How to access it

The My reels tab (`?tab=reels`).

### Business rules

- Only own posts whose Graph product type is a reel appear in the picker.
- With no `reel` in the URL, the newest reel is selected. With an id that is not one of the user's reels yet (a reel just published and not measured), the panel says "This reel hasn't been measured yet" instead of showing another reel, and the picker still lists every reel. With the id of one of the user's posts that is not a reel (a calendar "view post" on a plan marked published against a carousel), the panel says which format the post is, that it has no reel insights, and links to it on Instagram. If `tab`, `reel`, or `month` appears twice in the URL, the first value is used.
- Views shown in the picker are the latest stored measurement for that reel, never a live read.
- The picker shows the connect panel (feature 7) above it when the token is rejected but the account was measured before, the same stacking rule as feature 3.

### Limitations

- A reel posted after the last measurement does not appear until the next measurement, manual (feature 7) or scheduled (feature 14).

### User guide

Open My reels to see your reels, newest first, each with its thumbnail, date, and views. Click a reel to see its full insights. The address bar remembers which reel you picked.

## 11. Read one reel's insights

### Who uses it

The user, after picking a reel in feature 10.

### What it does

The insight panel is modeled on the Instagram app's Reel insights screen, and every number in it comes from the official Graph API. It has five blocks.

- **Summary tiles** (`reels-summary-tile`): Views (`views`), Viewers (`reach`), Average watch time (`ig_reels_avg_watch_time`, which the API returns in milliseconds and the panel shows in seconds), and Follows, marked "not reported for reels" (`reels-not-reported`): Meta lists `follows` and `profile_visits` for feed and story media only, so crowsnest does not ask for them on a reel.
- **Interaction strip** (`reels-interaction`): Likes, Comments, Reposts (`reposts`), Shares, Saves (`saved`).
- **What impacts your views** (`reels-impact-row`), in the Instagram app's order of importance to reach: Skip rate (`reels_skip_rate`), Share rate, Like rate, Save rate, Repost rate, Comment rate.
- **Actions after viewing** (`reels-action-row`): Follows and Profile visits, both marked "not reported for reels", and Bio link taps, read from `profile_activity` with `breakdown=action_type`, taking the bio link action. Instagram leaves out an action nobody took, so a measured reel with no bio link action reads 0; only a failed call shows a dash.
- **Not available from the Instagram API** (`reels-unavailable`): labelled placeholders for "How long people watched" (the retention curve), "When people liked your reel", and "Top sources of views". Each says plainly that the API does not provide it.

Every block shows when it was measured (`reels-measured-at`). The panel reads the reel's newest successful measurement: a later failed measurement never replaces the last good numbers or their measured time, and a reel whose measurements all failed reads as not measured yet.

### How to access it

Pick a reel on the My reels tab.

### Business rules

- Share, like, save, repost, and comment rates are derived per viewer: the metric divided by `reach`. This matches the Instagram app within rounding; for example, 1,112 shares over 80,997 viewers reads as 1.4%.
- A rate is not shown when `reach` is missing or zero, or when its own metric is missing. A dash stands in, never a 0%.
- Skip rate comes straight from the API, not derived, and carries an "estimated" label because the API marks the metric as in development.
- A metric the API did not return is stored as null and shown as a dash, never as zero, the same rule as feature 7.
- Every number carries its measured time, and the panel says that Instagram's data can lag up to 48 hours behind the app.

### Limitations

- The retention curve, the like timing chart, and the view sources exist in the Instagram app but not in the Graph API, so the panel shows labelled placeholders rather than an estimate.
- Per-reel follower split and per-reel demographics do not exist in the API either; feature 13 shows the account-wide versions instead, labelled as such.
- A reel's numbers are only as fresh as its last measurement.

### User guide

Pick a reel to see its insights. The top row shows views, viewers, average watch time, and follows. Below it are likes, comments, reposts, shares, and saves. "What impacts your views" lists your skip rate first, then how often viewers shared, liked, saved, reposted, and commented, each as a share of the people who saw the reel. "Actions after viewing" shows follows, profile visits, and bio link taps. A few charts from the Instagram app are not offered to other apps; those spots say so instead of guessing. Each block tells you when it was measured; Instagram can take up to two days to settle its numbers.

## 12. Compare views over time

### Who uses it

The user, on a reel's insight panel.

### What it does

A line chart (`reels-views-chart`) plots the selected reel's views against hours since it was posted, using crowsnest's own snapshots of `views` in `own_post_insights`, one row per measurement. A second line, "Your typical reel", shows the median views at the same hour since posting across the user's other measured reels.

### How to access it

It sits in the reel's insight panel (feature 11).

### Business rules

- Each point is a real stored measurement, and the chart never draws a point at an hour where no measurement exists. Each line runs straight from one measured hour to the next, so a gap in measurement shows as a segment between two real points, never as an invented point.
- Hours since posting are counted from the reel's posted time to each snapshot's capture time, in whole hours.
- The chart covers the first 168 hours (7 days) after posting, matching the Instagram app's views over time; later snapshots are not plotted.
- The typical line uses only reels other than the selected one, and at each hour only reels that were measured at that hour. Where no other reel was measured, the typical line runs straight on to the next hour that has one.

### Limitations

- The curve only has shape when a reel was measured often in its first days, which is what scheduled measurement (feature 14) does. Reels measured only by hand show a few scattered points.
- Reels posted before scheduled measurement existed have sparse early history, so the typical line is thin until newer reels accumulate snapshots.

### User guide

The views over time chart shows how your reel's views grew in the hours after you posted it, next to how your typical reel grows. Above the typical line means this reel is moving faster than usual.

## 13. See account-wide audience

### Who uses it

The user, on the My reels tab.

### What it does

Two blocks stand in for insights the Instagram app shows per reel but the Graph API only gives for the whole account. Each is labelled "Whole account, not this reel".

- **Followers vs non-followers** (`reels-follower-split`): the account's `views` with `breakdown=follower_type`, over the last 24 hours (the API's default window). When the last refresh of the split failed, the block says "Last refresh failed" (over the previous numbers when there are any) instead of "Not measured yet".
- **Audience details**, with tabs Age (`reels-audience-tab-age`), Country (`reels-audience-tab-country`), and Gender (`reels-audience-tab-gender`): from `engaged_audience_demographics`, showing the top results the API returns.

### How to access it

The My reels tab, below the reel's insight panel.

### Business rules

- The account-wide label is always visible on both blocks, so no account number reads as a reel number.
- Audience details uses engaged audience, not followers: `follower_demographics` needs 100 or more followers and `engaged_audience_demographics` needs 100 or more engagements. When the stored audience fetch error is Instagram's "Not enough" refusal, the block shows that threshold explanation rather than an empty chart. Any other stored error keeps the last stored rows with a "Last refresh failed" note.
- Both blocks carry their measured time.

### Limitations

- Nothing here is per reel. The API offers no per-reel follower split or demographics.
- Only the top results come back from the API, so the Country tab does not sum to 100%.
- The threshold message is recognized by Meta's "Not enough" wording, not a documented error code.

### User guide

Below your reel's insights, two blocks describe your whole account rather than this one reel: how many of your views come from followers versus non-followers, and who engages with you by age, country, and gender. They are marked as account-wide so you do not read them as this reel's numbers.

## 14. Scheduled measurement

### Who uses it

Nobody clicks it; it runs in the background for the user who has an own channel and a working Graph token.

### What it does

A background job measures the own channel automatically: every hour for reels posted in the last 72 hours, and once a day for older ones. Each run writes the same tables as a manual measurement (feature 7), so every run adds a snapshot row to `own_post_insights` for each reel it measures. Those snapshots are what feature 12 plots.

### How to access it

It starts with the app. It is modeled on the existing in-process schedulers (`sync-scheduler.ts`, `publish-scheduler.ts`). "Measure now" (feature 7) stays for an immediate run.

### Business rules

- The job stays under the Graph API limit of 200 calls per hour, counting every call it makes, including account-wide ones; one scheduled run makes at most 150 calls, and Measure now at most 190, both less every Graph call the app made in the last hour (earlier measurements, Check connection, publishes) beyond a 10-call headroom. The count is kept in memory, so it starts fresh after the app restarts. Each post reserves only the calls it needs; the rate-limit stop is the final guard.
- Only one measurement runs at a time: a scheduled tick and "Measure now" share one lock. A tick that finds a run in progress skips that hour; "Measure now" waits its turn. Neither doubles the calls.
- When there is no own channel, no token, or the token is rejected, a run does nothing and writes nothing. A token rejected mid-run, including while pulling comments or audience, ends the run as failed, and rows already written stay.
- A rate-limited run stops and makes no further calls, whether the limit hits on a reel, on comments, or on audience; it leaves the rest to the next run and does not retry in a loop.
- A failed measurement does not count as measured, and a failure backs the reel off, counted from its newest failure. A reel under 72 hours old is retried every hour however often it fails (not enough viewers, a network error, or an Instagram outage all clear). An older reel, measured before or not, is retried once an hour later, then daily. When Instagram refused the request itself (for example a post from before the account became a business account) it waits a day. So an older reel that keeps failing adds about one failed row a day.
- Each due check allows five minutes of slack, so a run landing just before the hour still measures the reel. After the app starts, the first run happens about 30 seconds later rather than an hour later.
- A token that lacks the insights permission (Instagram refuses the core metrics with a scope code, 200 to 299, or a code 10 naming a permission) ends the run as failed with the permission error, keeping rows already written, and My reels shows the missing-permission state. An Instagram throttle, including the business use case limit Instagram sends as HTTP 400 (code 80002), stops the run as rate limited.
- A failure on one reel does not stop the others, the same per-post rule the manual measurement already follows. "Not enough viewers for the media to show insights" (code 10) is one such per-reel failure. A reel whose measurement errors unexpectedly is stored as a failed measurement, so it backs off like any other; a token removed mid-run ends the run.
- Comments refresh at most once a day on scheduled runs; they reuse the run's post list, one call per post with comments, reserved before the posts so a full account still gets them. When the comments cannot fit the budget at all, nothing is reserved: the posts are measured first and the comments are skipped with the budget named as the cause.
- The audience and follower-split numbers are stored only when that whole daily read finished; a read cut short by a rate limit, or by a failure on a later audience dimension, keeps showing the last complete one with a "Last refresh failed" note and retries next run.
- When the last hour's calls cannot cover even the account, the post list, and one post, a scheduled run is skipped without any call or write and tried again next hour.
- A run that measured no post's insights (none due, or every one failed) does not clear a missing-permission state, since the account read works without the insights permission.

### Limitations

- The job only runs while the app is running. A machine that is asleep or has crowsnest closed makes no measurements, and the views over time chart shows the gap.
- It has no on-screen status of its own; the measured times on My reels are how the user sees it is working.
- When Instagram refuses the account-wide breakdowns, nothing is stored, so each hourly tick asks again, about four calls an hour.

### User guide

Once your token is connected, crowsnest measures your reels on its own: every hour while a reel is new, then daily. You do not need to click Measure now, though it is still there when you want fresh numbers straight away. Measurements happen only while crowsnest is running.

## 15. Interactions with other systems

- **Instagram Graph API** (`graph.instagram.com`): the only source of own-account numbers, through `src/server/graph/client.ts`. Features 11 and 13 request metrics beyond the core set (`reach`, `saved`, `shares`, `total_interactions`, `comments`, `likes`, and `views` for reels): the extended reel set, `profile_activity`, and the account breakdowns.
- **Secrets store**: `IG_GRAPH_TOKEN` and `IG_GRAPH_USER_ID` come from Settings > API keys first, `.env.local` second.
- **Dashboard**: owns the Overview tab and the `/` route that now hosts My reels and Calendar.
- **publish**: runs the upload, container, and scheduled publish that feature 8 drives.
- **remix and vault**: link to the planner at `/?tab=calendar`.
- **Settings**: `scoreMinUsablePosts` sets the median floor in feature 3.

## 16. Edge cases

- **No own channel**: My reels and Calendar show the picker; Overview is unaffected.
- **No tracked channels at all**: the picker has no rows and points to adding a channel; Overview shows its own empty state; the tab strip stays.
- **Token rejected after earlier measurements**: real stored numbers show with the connect panel on top, never hidden.
- **Token set but never measured**: the connect panel offers Measure now; scheduled measurement fills the tab on its next run.
- **Own channel has no reels, only carousels**: the picker is empty and says so; the post list still shows every post.
- **`?reel=` points to a deleted or unknown reel**: the panel says the reel has not been measured yet; no other reel is shown in its place.
- **`?reel=` points to an own post that is not a reel**: the panel names its format and links to it on Instagram instead of waiting for a reel measurement that never comes.
- **Reach of zero or missing**: every derived rate shows a dash.
- **Account under 100 engagements**: Audience details explains the API threshold instead of showing an empty chart.
- **Audience refresh fails for another reason**: the last stored rows stay, with a "Last refresh failed" note.
- **Rate limit hit mid-run**: the run stops; stored numbers stay and keep their measured times.
- **A reel's latest measurement failed**: the panel, the calendar's published reach, and Overview keep its last good numbers and measured time. A reel never measured successfully shows its newest failure. Either way the reel backs off from its newest failure: hourly under 72 hours old, otherwise an hour, then daily.
- **Token status on My reels**: the token check is cached for five minutes (30 seconds when it came back rate limited, unreachable, or unknown), so moving between reels does not call Instagram. Saving a token in Settings or a measurement hitting a rejected token clears it, a successful measurement sets it to connected, a measurement refused for permission sets it to missing a permission, and Check connection always checks live but keeps a missing permission until a measurement succeeds or the token changes, since the live check cannot see the insights permission.
- **Follower split refresh fails**: the Followers vs non-followers block says the last refresh failed instead of "Not measured yet".
- **Month navigation on Calendar**: `tab=calendar` stays in the URL with `month=`.
