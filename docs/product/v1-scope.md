# Crowsnest V1 scope

Written 2026-07-31. Product owner's call. This resolves `V1-BRIEF.md` into
buckets, acceptance criteria, cuts, and an order.

Read `V1-BRIEF.md` first. The rules there are not up for renegotiation here:
dark only, score is the hero, follower band stays visible, amber means beat its
channel, no fabricated numbers, every visible control works.

Where this doc and the prototype disagree, this doc says so explicitly and gives
a reason. Everywhere else the prototype wins.

## Rulings taken as given

Kai has ruled on two of the three open questions. Both are settled inputs to this
doc, not positions it argues.

- **Scheduling is in V1.** A manual planner on the my-channel calendar, with
  draft, scheduled, and missed states, optionally linked to a remix session. No
  publishing and no reminders, ever. Section 4, decision 3 records the reasoning
  and the one condition I attach to it.
- **Multi platform is out of V1.** Instagram only. The TikTok and YT Shorts chips
  come out of the filter bar and out of `platform-chip.tsx`. The schema column
  stays so a later platform is additive. Removing a control that returns nothing
  is a bug fix, so it sits in the truth pass at P0 and is not counted as a cut.

The onboarding question was left to me. Section 4, decision 1 is my ruling.

## What V1 is, in one paragraph

One person, one Mac, one platform. Kai opens Crowsnest in the morning, sees
which watched posts beat their own channel overnight, reads why one worked,
saves it, and turns it into a script. The script gets a date on his own calendar,
and the calendar is honest about which dates he missed. When Instagram refuses to
answer, which is most days, the app tells him exactly what it did not get and
what he can do about it. Nothing on screen is invented.

## Bucket rules

- **P0**: V1 does not ship without this. Either the one job breaks without it,
  or shipping without it puts a lie on screen.
- **P1**: V1 is weak without this. Ships, gets used, feels unfinished.
- **P2**: after V1. Real features, wrong quarter.

Every prototype element appears in exactly one bucket below.

---

# 1. Priority list

## P0

### Truth pass (the bug that outranks every feature)

| Item | Why P0 |
|---|---|
| Remove TikTok and YT Shorts from `PLATFORM_OPTIONS` in `filter-bar.tsx` | A filter against a backend that can never return a non-Instagram row. Selecting it returns nothing, every time, by construction. |
| Remove the TikTok and YouTube branches from `platform-chip.tsx`, and the chip itself from the outlier card | With one platform the chip carries zero information. The prototype has no platform chip anywhere, so removing it moves toward the prototype, not away from it. |
| Remove TikTok and YouTube profile URL builders from `channel-header.tsx` | Dead branches that produce a broken link if a row is ever miscategorised. |
| Keep `channels.platform` and `videos.platform` | Both sit inside unique indexes. Dropping them is a migration that buys nothing and makes a second platform subtractive instead of additive. |
| Every metric with no value renders as a dash, never a zero, on every screen | Stated absolutely in the brief. Needs a sweep, not a component. |

Justification: the brief calls a UI promise the backend cannot keep a bug with
priority over any missing feature. These are those bugs. They cost hours. Per
Kai's ruling, the platform removals are counted here as bug fixes and not in
section 3 as cuts.

### First run

| Item | Why P0 |
|---|---|
| Welcome screen | First run is real work and currently has no home. Kai on a fresh machine has to read a shell script to get started. |
| Focus screen, subject only | The niche profile is read by every remix prompt (`getNicheProfile`, `remix-prompts.ts`). Without it the remix output is generic. It already persists via `saveNicheSettingsAction`. |
| Connect screen, Instagram session | `igLoginAction`, `igChallengeChooseAction`, `igChallengeCodeAction`, `igTwoFactorAction` all exist as server actions and are reachable only from Settings today. First run is where they belong. |
| Sources screen, pick channels | `addChannelAction` exists. Adding the first channel from a terminal is not a product. |
| First sync screen with the seven phases | `startSyncAction` plus `getSyncProgressAction` already report seven phases. The screen is a render of data that already exists. |
| First run gate | A `first_run_completed` key in `app_settings`. Without it the flow is unreachable after the first visit and untestable. |

Justification: a product Kai uses daily still has a day one. Every screen here
runs on a server action that already exists, so the cost is UI plus a routing
gate, not new backend.

### Feed

| Item | Why P0 |
|---|---|
| Sentence filter bar: score, channel, timeframe, sort as inline menus | The prototype reads filters as a sentence, not a form. This is a stated design problem the prototype solved. |
| Follower band chips with live counts | Locked in both briefs. A five follower account finds copyable formats through the band, not the raw score. |
| Grid and list views | Both exist in the prototype and the list view is how you scan 200 rows. |
| Card: score as hero, views, engagement rate, handle, age, hook overlay, duration | Engagement rate is `(likes + comments) / views`, all three columns exist on `videos`. It is a real number that was dropped for scope, not for truth. |
| Removed-from-Instagram flag on the card | `videos.deleted_at` exists. A post that no longer exists must say so or the score is misleading. |
| No-channels empty state and no-match empty state, distinct | The brief demands nothing crash on an empty database. Two different empty conditions need two different exits. |
| Loading skeleton | Already exists in `feed/loading.tsx`. Align to the prototype shape. |
| Feed summary line (count of what the current slice holds) | One line, real count, tells Kai whether his filter is too tight. |

### Video detail

| Item | Why P0 |
|---|---|
| Hero score at 52px, mono, tabular | Locked. |
| Median bar with the 1.0x marker and the channel median value | The score means nothing without what it is measured against. |
| Median spark histogram: what the median is made of, with sample span and confidence | Pure query work over `videos.view_count` in the baseline window. This is how Kai knows whether to trust the score. The brief: a number he cannot trust makes the product worthless. |
| Views, duration, age, follower count row | Already present. |
| Three tabs: Transcript, Hook and structure, Why it worked | Already present. |
| Analyse gate with a cost-honest line, blocked when the model proxy is down | Failure surface, and the analysis is not free. |
| Hook summary, verbatim hook, tags | Already present. |
| Beats with timecodes and share-of-runtime bars | `video_analyses.structure_segments` already holds `{label, startSec, endSec, note}`. The bar is arithmetic on existing data. |
| Layout section: on screen text, text position, cut rhythm, framing | The one job names layout: "take its hook, its script and its layout". Cutting it cuts a third of the product's stated purpose. Needs a frame pass, new columns on `video_analyses`, and a vision call. |
| Run frame pass action, with an unverified marker on any tag the model guessed without frames | The prototype marks unverified tags in three separate places. Guessed layout presented as measured layout is a fabricated number by another name. |
| Prev and next post with arrow keys, plus the index label | Reading twelve posts in a row is the daily loop. Going back to the feed between each one is the difference between a tool and a demo. |
| Remix, Save to vault, Copy as prompt as the three exits | Already present. Save changes meaning, see Vault below. |

### Remix studio

| Item | Why P0 |
|---|---|
| Five stage chips with state: done, active, idle, blocked | Already present. |
| Blocked state when the local model proxy is down, with a recovery action | The brief names the proxy going down as a normal state. |
| Stage item list, pick an option, advance, restart | Already present. |
| Reference rail: thumbnail, source stats, why it worked | Already present. |
| Research stage reads the Vault | The prototype's Stage 2 says "3 references pulled from the vault". Today `buildResearch` pulls similar tracked outliers and ignores the vault entirely. The point of saving a post is that it seeds the next remix. |
| Run log | `remix_sessions` records no per-run history. Add a `remix_runs` table. Without it a failed generation leaves no trace, and this pipeline fails often. |

### Channels and sync

| Item | Why P0 |
|---|---|
| Channel table: handle, health, band, followers, posts and median, sync, stop watching | Already present, needs prototype typography and the health vocabulary. |
| Four distinct health states: ok, partial, stale, never synced | The brief calls out a clear difference between stale and never synced. Never synced gets the hatched row and a dash for followers, not a zero. |
| Thin-sample note under any channel with fewer than ten posts | Prototype copy: "a median needs about ten before its scores mean anything". This is the sample size rule applied to competitors. |
| Add channel dialog: handle required, size band optional, backfill depth optional | Backfill depth needs to reach `runSync`'s lookback. Size band is a hint that survives until the first sync reads the real follower count. |
| Failure strip in the shell, five states: partial, rate limited, session expired, local service down, offline | The brief: failure is the normal state and every failure has a designed surface. Each state carries an error code, the facts of what happened, and one action. |
| Strip detail: what did not come back | `sync_jobs.gaps` already holds `SyncGap[]`. This is the difference between "sync failed" and a research tool. |
| Sync progress bar with the seven phases | Already built in `sync-progress-panel.tsx`. Align labels to the prototype. |

### Vault

| Item | Why P0 |
|---|---|
| Vault is a flat list of saved posts: thumbnail, caption, channel and views and duration and median, score, why kept, age | The prototype's model, and the model the detail screen's Save button already promises. Needs a `saved_posts` table. |
| Why kept, free text, optional, dash when empty | Six months later the reason is the only thing that makes a saved post useful. |
| Remix and remove per row, remove is undoable | Prototype behaviour. Undo via the toast. |
| Sort control | Three options, real orderings. |
| Empty state with two exits | Already exists in spirit. |

### My channel

| Item | Why P0 |
|---|---|
| Own channel connected through the Instagram Graph API | Insights are owned-channel only and there is no other source. `channel_insights` and `video_insights` tables plus a Graph sync path. A working own-channel Graph client already exists in Kai-Official-OS. Port it, do not rebuild it. |
| Six stat tiles, each carrying its sample size | Locked: every own-channel figure carries its sample size. |
| Progress line toward the post count where a score appears | The owned channel has eight posts. The interface has to show that honestly rather than compute a score off four data points. |
| Reach by post bars | The core own-channel read. |
| Post list: title, reach, length, published | Already close to what exists. |
| Score renders as a dash with the reason, until the post count clears the threshold | Prototype does exactly this. It is the single best example in the whole design of the no-fake-numbers rule. |

### Planner (Kai's ruling, manual only)

| Item | Why P0 |
|---|---|
| `planned_posts` table: title, planned date, state, optional `remix_session_id`, optional `script_id`, optional published `video_id` | Kai ruled scheduling into V1. Without a table the calendar is a client-side notepad that dies on reload. |
| Three states: draft, scheduled, missed | Prototype legend. Missed is what makes the calendar tell the truth about dead air rather than flatter him. |
| Missed is computed, never stored as a user action | A scheduled date in the past with no published post is missed by definition. Storing it as a state a human sets means it can be wrong. |
| Month calendar with published, scheduled, missed, dead air, and open cells | Now that four of the five legend states are real, the calendar is the planner's primary surface rather than a decoration. |
| Create a planned post on a day, from the calendar | The minimum interaction that makes a planner a planner. |
| A planned post carries a script | The condition attached to the ruling. See decision 3. A planned post with no script and no route to one is a notepad inside a research tool, and it will rot. |
| Remix stage 5 ends by placing the script on a date | The prototype's remix run ends on the calendar. This is the join that makes the whole loop close: outlier, analysis, script, date. |
| Move a planned post to another date | Plans change weekly. A planner that cannot be re-dated gets abandoned in a fortnight. |
| Delete a planned post, undoable via toast | Consistent with every other destructive action. |
| Reconcile a published post against its plan | When a sync brings back an own-channel post published on a planned date, the plan resolves to published and links to the video. Otherwise the calendar shows a phantom plan next to the real post forever. |
| Week reach column and selected day panel | Both already drawn, and both now have real data on both sides: reach from Insights, plans from `planned_posts`. |
| Agenda view | The list form of the same data. Cheap once the month view exists, and it is how you see a month of plans without counting cells. |

Justification: this is a ruling, not a proposal, so the bar here is not whether
the planner earns its place but whether it is built so it cannot rot. Every row
above is either the data model, the link to the script, or the reconciliation
that keeps plan and reality from drifting apart. What is explicitly not here:
publishing, reminders, notifications, and any integration that touches Instagram
on the write side. Those are not P2. They are never.

### Settings, the rows that change what a number means

| Item | Why P0 |
|---|---|
| Baseline: median, mean, trimmed mean | Changes the definition of the score. |
| Baseline window: last 12 posts, last 30 days, all history | Same. |
| Minimum posts before a score is computed | Same, and it is the rule that stops a three post channel producing a 40x. |
| Views floor | Same. |
| Feed threshold and default band | The two controls that decide what Kai sees when he opens the app. |
| Sync cadence and lookback window | Decides whether the app is a background tool or a button he presses. |
| Danger zone: discard all analyses, purge media, reset database, each behind a confirm dialog | Cheap, and Kai will need all three while the scoring rules are still moving. |
| A real settings write path | Today only three keys are writable. Every row above needs to persist and be read by the engine that uses it. |

### Shell and overlays

| Item | Why P0 |
|---|---|
| Sidebar with four groups and eight destinations | Prototype nav. Post and My channel become real destinations. |
| Toast with undo | Every destructive action in the prototype is undoable through the toast. |
| Confirm dialog | Needed by the danger zone. |
| Keyboard: 1 to 8 for sections, S for sync, arrows for posts, Esc to close | Daily-use tool. |

**P0 count: 75 line items across 12 groups.** 62 before Kai's scheduling ruling,
plus 13 for the planner.

## P1

**Shell**: rail collapse, feed and vault count badges in the nav, get started
checklist with its four real flags, sync health dots, command palette extended
to jump to individual posts.

**Dashboard**: NEXT bar, first run banner, producer donut, reach against score
scatter, 28 day rolling timeline, score ranking list, coverage list. The top
post hero and the empty states are already covered as part of the truth pass.

**Feed**: caption and channel search, comfortable and compact density, header
sync button, per filter empty-state hint copy, "not for me" dismiss with undo.

**Detail**: copy transcript button.

**Remix**: side by side compare of two options, and "use this one".

**Channels**: per channel last-8-runs sparkline from `sync_jobs`.
The competitor channel detail page keeps its current features and takes only
prototype typography.

**My channel**: length against reach scatter, weekday rhythm view. The calendar
and everything on it moved to P0 with the scheduling ruling.

**Planner**: the pipeline funnel (idea, drafted, scheduled, published, scored).
It is a five-stage count over `planned_posts` plus `videos`, so it becomes real
the moment the table exists, but it is a summary of the calendar rather than a
way to do anything, and the calendar itself has to be right first.

**Vault**: saved scripts as a second tab. Hook and style templates move to
where they are used, the Remix stage 3 and 4 pickers, with a "save as template"
action from the detail screen.

**Settings**: analysis prefs (frame pass mode, frames sampled, auto analyse,
re-run policy), storage prefs (retention, disk pressure, export), interface
prefs (density, feed layout, default sort, sidebar state, checklist visibility),
read-only reflection rows for connections, stagger, last full pass, database
size, media size.

## P2

- The four step spotlight tour. The sidebar checklist covers the same four
  moments without an overlay engine.
- Sync tuning controls that are currently env only and safe there: batch size,
  concurrency, stagger.
- A second platform. See decision 2.
- Auto analyse on a score threshold. Costs money on every sync, and V1 has not
  yet established what a run costs.
- Recurring plan slots, for example "a post every Tuesday and Friday". The
  manual planner has to earn its keep before it earns automation.

## Never

Not a bucket for later. A bucket for no.

- Publishing to Instagram from Crowsnest. Ruled out by Kai in the same breath as
  ruling the planner in, and it is the only thing that would turn a read-mostly
  research tool into an account-risking write client.
- Reminders and notifications of any kind. Same ruling.
- A light theme. Locked in both briefs.

---

# 2. Acceptance criteria

Written so a tester can run them without asking what was meant. Each one is a
starting state, an action, and an observable result.

## First run

1. With `first_run_completed` unset and zero rows in `channels`, opening any
   route redirects to the welcome screen.
2. The welcome screen shows four numbered steps and a "Get started" button. The
   step count in the copy matches the number of steps that actually run.
3. On the focus screen, selecting a subject and pressing Continue writes
   `niche_profile` to `app_settings`. Reloading the app and opening Settings
   shows the same value.
4. On the focus screen, Continue is disabled until a subject is selected, and
   the hint text says what is missing.
5. On the connect screen with the sidecar not running, the primary action shows
   the local service down state and does not spin forever.
6. On the connect screen with the sidecar running and no session, pressing
   Connect calls `igLoginAction`. If Instagram returns a challenge, the
   email/SMS choice appears; submitting a wrong code shows the error inline and
   leaves the field focused.
7. After a successful connect, the screen shows the connected handle, follower
   count, and post count, every one of them read from the profile response. If
   the profile response omits a field, that field shows a dash.
8. Pressing "Skip for now" on connect advances to sources and leaves the
   Instagram status disconnected. The app remains usable and every sync control
   shows the disconnected state.
9. On the sources screen, Continue is disabled at zero selected channels and the
   hint says so. The counter reflects the selection.
10. Pressing Continue on sources creates one `channels` row per selection, with
    `platform` set to `instagram` and `last_synced_at` null.
11. The first sync screen lists seven phases. Running it advances the phases in
    order and the percentage never goes backwards.
12. If the first sync fails partway, the screen shows the failure state with the
    error code, and "Open Crowsnest" is still available. The app opens with the
    failure strip already showing.
13. On completion, the result figures are counts from the `sync_jobs` row, not
    from the client. Pressing "Open Crowsnest" sets `first_run_completed` and
    lands on the dashboard.
14. Reloading after completion never shows the welcome screen again. Settings
    has a control that clears the flag and replays it.

## Feed

1. With zero channels, the feed shows the no-channels empty state and its call
   to action routes to add a channel.
2. With channels but zero scored posts, the feed shows the no-channels empty
   state copy about medians settling, not the no-match state.
3. With posts but a filter combination that matches none, the feed shows the
   no-match state and its "Clear filters" button removes every filter param from
   the URL.
4. Opening the score menu, choosing 5x+, and reloading the page keeps the
   selection. The filter lives in the URL.
5. The follower band chips are visible without opening any menu at every
   viewport width down to 1024px.
6. Each band chip shows a count. The sum of all band counts equals the number of
   posts matching every other active filter, and changing a non-band filter
   changes those counts.
7. A channel with a null `follower_count` appears under no band chip and is
   still reachable with the band set to any.
8. Each card shows the score in amber if it is at or above 1.0, and in the muted
   foreground below 1.0.
9. Engagement rate on a card equals `(like_count + comment_count) / view_count`
   rounded to one decimal. If any of the three is null, the card shows a dash in
   that slot and does not print "0.0%".
10. A post with `deleted_at` set shows the removed marker in the negative colour
    and is still openable.
11. Switching to list view and reloading keeps list view.
12. No platform filter, platform chip, or platform icon appears anywhere in the
    feed.
13. With exactly one post in the database, the grid renders one card and no
    layout gap artifacts.

## Video detail

1. Opening a post with no analysis shows the analyse gate, not empty tabs.
2. With the model proxy unreachable, the analyse button is disabled and the gate
   line names the proxy as the reason.
3. The hero score matches `videos.outlier_score` to one decimal and sits above a
   line naming the channel whose median it beat.
4. The median bar marker sits at the position corresponding to 1.0x on the
   0.2x to 12x scale, and the label under it prints the channel median with a
   thousands separator.
5. The median histogram bars are the view counts of the posts inside the current
   baseline window for that channel. The bar count equals the sample size printed
   next to it.
6. A channel with fewer posts than the minimum-posts setting shows the histogram
   area replaced by a line saying how many posts it has and how many it needs.
   No score is shown for its posts.
7. The confidence label is derived from sample size, and its exact thresholds are
   documented in the code next to where it is computed.
8. Beats render one row per `structure_segments` entry, with the timecode from
   `startSec` and `endSec`, and a bar whose width is the segment duration over
   the video duration. The bar widths sum to at most 100 percent.
9. The layout section shows four fields. Any field the frame pass did not
   produce shows a dash. Tags the model produced without a frame pass carry the
   unverified marker and render muted.
10. "Run frame pass" on a video with no downloaded media downloads it first and
    shows progress. On a video whose media cannot be re-resolved, it shows the
    failure and does not write a partial analysis.
11. Pressing the right arrow key moves to the next post in the current feed
    order, and the index label increments. At the last post the next control is
    disabled.
12. "Save to vault" creates a `saved_posts` row and the button changes to the
    saved state. Pressing it again offers to remove.
13. "Copy as prompt" puts markdown on the clipboard containing the score, the
    channel median, the hook, the beats, and the transcript. It contains no
    value the database does not hold.

## Remix studio

1. Opening remix on a post with no session creates one at stage `prompt`.
2. With the model proxy down, every stage past prompt shows the blocked state and
   the advance button does nothing. The recovery action names the command to
   start the proxy.
3. Stage 2 lists the posts saved in the vault, most recent first, with their real
   score, handle, views, and channel median. With an empty vault it says the
   vault is empty and links to the feed.
4. Stage 3 generates between three and seven hooks. A generation failure leaves
   the previous hook list intact and appends a failed entry to the run log.
5. The run log shows one row per generation attempt with a timestamp, the stage,
   the outcome, and the elapsed time. The rows survive a page reload.
6. Restart clears the stage back to prompt and does not delete the run log.
7. Advancing past stage 5 saves a `scripts` row and the script is reachable from
   the vault.
8. Stage 5 offers a date. Choosing one creates a `planned_posts` row in the
   scheduled state whose `script_id` is the script just saved and whose
   `remix_session_id` is this session. The row appears on the my-channel calendar
   on that date without a reload of the database.
9. Declining the date still saves the script. The remix run never becomes
   unfinishable because the planner refused a write.

## Channels

1. A channel with `last_synced_at` null shows "Never synced", a hatched row, a
   dash for followers, and a dash for posts. It never shows a zero.
2. A channel whose last `sync_jobs` row has status `partial` shows the partial
   health state in amber and a Sync button that is visible without hovering.
3. A channel whose last sync is older than 30 days shows the stale state with the
   age in days.
4. A channel with fewer than ten posts shows the thin-sample note with its actual
   post count in the sentence.
5. Add channel with an empty handle shows an inline error and does not close.
6. Add channel with a handle that already exists shows an inline error naming
   the collision.
7. Add channel with a valid handle creates the row, closes the dialog, and shows
   a toast. The row appears in never-synced state.
8. The backfill depth chosen in the dialog is the lookback used by that channel's
   first sync, verifiable in the `sync_jobs.lookback_days` column.
9. "Stop watching" removes the channel from the list and the toast offers undo.
   Undo within the toast window restores it with its videos intact.

## Failure surfaces

1. With `sync_jobs` last row status `partial`, the shell shows the amber strip
   with the partial title, the count of what was kept, the error code, and a
   Sync action. The strip is dismissible.
2. With the sidecar reporting a cooldown, the strip shows the rate limited state
   in the negative colour, the account-wide error code, and a countdown that
   ticks. Its action button is disabled while the countdown runs.
3. With the sidecar reporting no session, the strip shows the session expired
   state and its action routes to the Instagram section of Settings. Every sync
   control in the app is disabled in this state.
4. With the sidecar not reachable, the strip shows the local service down state
   and its action copies the start command to the clipboard. The feed, vault,
   and detail screens remain usable.
5. Expanding the strip detail lists one row per `sync_jobs.gaps` entry, with what
   was missed and why. With an empty gaps array the expander does not appear.
6. While a sync is running, the failure strip is hidden and the seven-phase
   progress bar is shown instead.
7. Cancelling a running sync sets `cancel_requested`, the progress bar clears,
   and the resulting job status appears in the strip.

## Vault

1. With zero saved posts, the vault shows the empty state and both of its exits
   route somewhere that exists.
2. Saving a post from the detail screen adds a row with the current score. Later
   score changes on that video are reflected in the vault row, because the score
   is read through the join, not copied.
3. A saved post with no "why kept" text shows a dash in that column.
4. "remix" on a vault row opens the remix studio on that video's session.
5. "remove" removes the row and offers undo in the toast. Undo restores it.
6. Changing the sort reorders the list and the order is stable across reload.

## My channel

1. With no Graph connection, the screen shows a connect state and no figures.
   It does not show zeros.
2. Every stat tile carries a sample size in its label, and the sample size is the
   count of rows the figure was computed from.
3. The score tile shows a dash with the reason until the post count clears the
   minimum-posts setting.
4. The progress line shows the actual post count over the actual threshold from
   settings, not a hardcoded 30.
5. Reach values come from `video_insights` and never from `videos.view_count`.
   If insights for a post are missing, that post's bar is absent and the count of
   missing posts is stated.
6. With eight posts and a reach of 9 on one of them, the bar chart renders
   legibly and does not scale a 9 to nothing.
7. The legend lists only the cell states that V1 can produce, and every state in
   the legend appears somewhere in a seeded database.

## Planner

The first five are the ones that decide whether the planner is a tool or a
notepad. Fail any of them and the feature has rotted before it shipped.

1. Finishing a remix run and choosing a date creates a `planned_posts` row whose
   `script_id` is not null and whose `remix_session_id` is not null. Verify in
   the database, not in the UI.
2. Opening a planned post that came from a remix shows the full script text and a
   link back to the source outlier, including its score and its channel. Two
   clicks from a calendar cell to the post that inspired it.
3. Creating a planned post directly on a calendar day, with no remix behind it,
   requires either a script or an explicit "no script yet" acknowledgement, and a
   plan in the second state renders visually distinct from one carrying a script.
   A tester can tell the two apart from across the room.
4. A planned post with no script and no remix session, older than 30 days, is
   surfaced by the calendar as stale rather than left to accumulate silently.
5. Deleting the script a plan points at does not orphan the plan. Either the
   delete is refused with the reason, or the plan drops to the no-script state
   and says so. It never renders a dead link.
6. A day with a plan in the scheduled state, whose date is in the past, and with
   no own-channel post published that day, renders as missed. No user action sets
   this, and there is no control anywhere that marks a day missed.
7. The missed state clears by itself when a sync brings back an own-channel post
   published on that date. The plan resolves to published, the cell shows the real
   reach, and the plan's `video_id` is set.
8. A day with a published post and no plan behind it renders as published, not as
   an error. Kai posting off-plan is normal.
9. Three or more consecutive days with no published post and no plan render as
   dead air, matching the prototype legend.
10. Dragging or re-dating a planned post moves it, and a plan re-dated into the
    past with no published post immediately reads as missed.
11. Deleting a planned post offers undo in the toast, and undo restores the row
    with its script link intact.
12. The agenda view lists the same rows as the month view for the same month.
    A plan visible in one and absent from the other is a failure.
13. With zero planned posts, the calendar renders published cells and open cells
    and says how to add the first plan. It does not render an empty grid with no
    explanation.
14. Nothing anywhere in the app sends a notification, schedules a background job
    tied to a plan date, or makes a write request to Instagram. Verified by
    grepping for notification and publish APIs, not by clicking around.
15. The pipeline funnel counts, when built, sum to the number of rows they claim
    to partition. Counting one plan in two stages is a fabricated number.

## Settings

1. Every segmented control on the page writes to `app_settings` and the value
   survives a reload.
2. Changing the baseline from median to mean and re-running scoring changes
   `videos.outlier_score` for at least one post in a seeded database, and the
   detail screen's median label updates to match.
3. Changing the minimum-posts setting upward causes channels below the new
   threshold to stop showing scores, on the feed and on the detail screen.
4. Changing the feed threshold changes what the feed shows on next open, and the
   feed's own filter control reflects the new default.
5. Read-only rows are visually distinct from writable rows and carry the
   read-only marker.
6. "Discard all analyses" asks for confirmation naming the count that will be
   deleted, and after confirming, the detail screen for a previously analysed
   post shows the analyse gate again.
7. "Purge media" asks for confirmation naming the byte total, and after
   confirming, a video whose media was purged shows its placeholder and offers
   to re-download.
8. "Reset database" asks for confirmation requiring an explicit action, and after
   confirming, the app returns to first run.
9. No control on the Settings page changes theme.

## Shell

1. Every sidebar item routes to a page that exists. No item routes to a 404.
2. The active item carries `aria-current`.
3. Pressing 1 through 8 navigates to the corresponding section from any screen
   that does not have a focused text input.
4. Pressing S starts a sync unless a sync is running or the Instagram connection
   is in a state that disables sync.
5. The toast dismisses on its own, and while it is showing, its undo action
   reverses the operation that raised it.
6. Command palette opens on Cmd K, lists screens and posts, and Escape closes it
   returning focus to the trigger.

## Global

1. With an empty database, every one of the eight screens renders without a
   thrown error and shows an empty state.
2. With exactly one channel, one video, and no analysis, every screen renders
   without a thrown error.
3. No screen renders a number the database does not hold. Verified by grepping
   the component tree for numeric literals inside render output.

---

# 3. Explicit cuts

Kai said 100 percent. These are the exceptions, each with a reason that is not
"it is hard".

| Cut | Reason |
|---|---|
| The signin screen (email, password, name, register toggle) | It authenticates against nothing. There is no server and no second user. The prototype contradicts itself here: its own Settings page says "No credential fields in the app by design" and reads the session from a file. The signin screen is a generic SaaS shape that the rest of the prototype already rejected. The real credential moment is the connect screen, which is P0. |
| "Sign out" in the danger zone | Follows the signin cut. There is nothing to sign out of. |
| The cadence question on the focus screen ("how often you post") | Nothing in the app reads it. A control that does nothing is banned by the brief. With the planner now in V1 there is a plausible future consumer, an expected-slot rule on the calendar, but V1's planner is manual by ruling, so nothing reads it in V1 either. Revisit alongside recurring plan slots. |
| The theme control in Settings, Interface | Dark only is locked in both briefs. A light-mode toggle is the one control on the whole page that would be shipping a promise the design forbids. |
| The 28-day rolling timeline's per-day colour ramp by score tier | Kept as a bar chart, moved to P1, but the colour ramp is cut: a day's bucket has no single score, so a tier colour asserts a reading the data does not contain. Single hue. |
| The four-step spotlight tour | The sidebar checklist tracks the same four flags and is already in the design. Two onboarding systems for a one-person app is one too many. Moved to P2, not deleted. |
| The prototype dock (failure state switcher, proxy switcher, reset) | It is a prototype control for demoing states, not a feature. The equivalent for the real app is the test suite. |
| Amber on the logo dot | Already decided during the UI port. The amber budget is one meaning and one primary action per screen. The prototype loses this one. |

Two things that were on this list in the first draft are no longer cuts.
**Scheduling** is now P0 by Kai's ruling, and the calendar's planned, scheduled,
and missed cells come with it. **The TikTok and YT Shorts chips** are counted as
a bug fix in the truth pass, per Kai's ruling that removing a control returning
nothing is a fix and not a cut. The prototype never had a platform filter, so
nothing of the prototype is lost either way.

Nothing else from the prototype is cut. Everything else is P0, P1, or P2.

---

# 4. Decisions

Decision 1 is mine. Decisions 2 and 3 are Kai's, recorded here with the
reasoning, the price, and my own position where it differs.

## Decision 1: onboarding

**Ruling: four of the six screens run in V1. Welcome, focus, connect, sources,
first sync. Signin is cut. Focus loses its cadence question.**

The `UI-BRIEF.md` line "no signup, no onboarding" was written against a SaaS
reflex, and it threw out first run setup along with the signup form. Those are
different things. Signup is an account. First run is configuration, and this app
has real configuration that today lives in a shell script and a `.env.local`
file: get the sidecar logged in, tell the app what Kai makes, pick channels,
run the first sync.

Three arguments for keeping it:

1. Every screen is a UI over a server action that already exists. `igLoginAction`
   with its challenge and 2FA branches, `saveNicheSettingsAction`,
   `addChannelAction`, `startSyncAction` with seven-phase progress. The backend
   cost is a single `app_settings` key and a route guard.
2. The alternative is worse than nothing. Without it, a fresh install shows the
   feed's no-channels empty state, which points at Add Channel, which works, but
   nothing anywhere tells Kai the sidecar needs to be running and logged in
   first. That is the one step he cannot guess.
3. The first sync screen is the best demonstration in the whole prototype of the
   brief's rule that failure is a designed surface. The first thing a new install
   does is fail, because Instagram rate limits a cold session. That deserves the
   full-page treatment the prototype gives it, not a red bar.

The signin cut is not reluctant. The prototype itself says the session is read
from `.crowsnest/session.json` and re-auth happens in a terminal, and that no
credential fields exist in the app by design. Those two statements cannot both be
true alongside an email and password form. Connect wins, signin goes.

Consequence: the step numbering shifts. `01 FOCUS`, `02 INSTAGRAM`,
`03 CHANNELS`, `04 FIRST SYNC`, and the welcome copy says four steps.

Also in: a Settings control that clears `first_run_completed` and replays the
flow. The prototype's dock has an "Onboarding" button that does this, and
without it the flow is untestable after the first run.

*A call you can overturn:* I put the focus screen in P0 because the niche
profile feeds every remix prompt. If you would rather Kai type it once in
Settings, focus drops to P1 and first run becomes three steps.

## Decision 2: multi platform

**Ruling: V1 is Instagram only. The chips come out.**

Priced both.

**Cost of taking the chips out.** Two entries in `PLATFORM_OPTIONS` in
`filter-bar.tsx`, two icon branches in `platform-chip.tsx`, two URL builders in
`channel-header.tsx`, plus a test asserting the feed offers no platform filter.
Under a day. The `platform` column stays on `channels` and `videos`, because it
sits inside both unique indexes and dropping it is a migration that buys nothing.
It is the seam for the second platform, kept as a column and hidden as a control.

**Cost of making it true.** One platform is the entire `services/ig` Python
sidecar (session persistence, challenge and 2FA handling, device pinning, rate
limit cooldowns, ten endpoints), the `server/ig` client with strict drift
detection, and the parts of `sync-engine.ts` that branch on provider behaviour.
That file is 1350 lines with 55 tests behind it. YouTube Shorts is the cheaper
of the two because the Data API is a real documented API with a key and a quota,
so call it two to three weeks including baseline semantics, media handling, and
tests. TikTok has no stable public surface, so it is a scraper with the same
session and challenge problems as Instagram plus a faster-moving target, and it
never stops needing maintenance. Call it four weeks and a permanent tax.

That is five to seven weeks to make two chips honest, on a product whose stated
one job is watching the creators Kai competes with, all of whom are on Instagram,
using a scoring model that only means anything once a channel has ten or more
posts in the same place.

The tiebreaker is that removing the chips moves toward the prototype rather than
away from it. The prototype has no platform filter, no platform chip, and one
mention of the word Instagram anywhere: a channel row subtitle. Kai's
"100 percent the prototype" instruction and this decision point the same way.

*A call you can overturn:* if the plan within six months is to watch YouTube
Shorts, say so now and the sync engine gets its provider seam widened during V1
rather than retrofitted. That costs a few days now against a week later. TikTok
I would argue against in any timeframe.

---

# 5. Build order

The rule that prevents deadlock: **schema and query signatures land before any
screen that consumes them, and they land as real queries against real data, not
stubs.** A stub is a fabricated number with a different name.

### Wave 0, day 1, no dependencies

Runs in parallel from the start.

- **Truth pass.** Frontend only. Remove the platform controls, sweep for zeros
  that should be dashes. Ship it same day.
- **Frame pass spike.** Prove that the configured model can read frames and
  return a structured layout object, before any UI is built on top of it. This
  is the riskiest P0 and it must be answered first. See risk below.
- **Graph Insights port.** Longest lead time, zero dependency on anything else in
  this list. Port the existing own-channel Graph client from Kai-Official-OS.
  Confirm the token and permissions are in hand on day one.

### Wave 1, backend contracts

Nothing in wave 2 can start until these exist. Everything here is schema plus a
query, no UI.

1. `app_settings` write path plus a typed settings module, with every P0 key.
   Blocks: Settings, feed defaults, scoring, sync cadence, My channel thresholds.
2. `saved_posts` table plus queries. Blocks: Vault, detail Save action, remix
   research stage.
3. Median histogram query: per-channel view counts inside the baseline window,
   plus sample size and span. Blocks: detail screen.
4. Feed query additions: engagement rate, band counts, deleted flag, feed
   summary count. Blocks: feed.
5. Failure surface query: the last `sync_jobs` row shaped into strip state,
   error code, facts, and gaps. Blocks: shell, channels, every sync control.
6. `video_analyses` layout columns and `remix_runs` table. Blocks: detail layout
   section, remix run log.
7. Scoring engine reads the settings module instead of constants. Blocks: every
   score on every screen behaving correctly when the settings change.

### Wave 2, screens, parallel across teams

Each of these depends only on wave 1 and can run beside the others.

- Failure surfaces plus sync progress alignment. Do this first in wave 2; every
  other screen has a disabled state that depends on it.
- Feed: filter sentence, band chips, card, both views, empty states.
- Detail: hero, median bar, histogram, beats bars, prev and next.
- Channels: health states, thin note, add dialog.
- Vault: the saved posts list.

### Wave 3, depends on wave 2

- First run flow. Depends on the settings write path and on the connect and sync
  states being designed, which happens in wave 2.
- Remix research reads the vault. Depends on `saved_posts` and on the vault
  screen existing.
- Detail layout section and Run frame pass. Depends on the wave 0 spike
  answering yes, and on the `video_analyses` columns.
- My channel. Depends on the Graph port landing.

### Wave 4, last

- Settings page. Deliberately last among the P0 groups: it is the surface that
  reflects every decision made in waves 1 to 3, and building it first guarantees
  rework. The keys are written in wave 1, the page that edits them is built once
  the consumers are known.
- Dashboard charts, all P1. Last because every chart is a read over data the
  other screens produced, and a chart built on a query that later changes is
  wasted twice.

### Deadlock prevention, stated plainly

- Backend never waits on a design. Wave 1 is schema and queries, and their shape
  comes from the prototype, which is already drawn.
- Frontend never waits on data. It waits on a query signature, which exists at
  the end of wave 1, and it develops against a seeded local database, not
  against fixtures. Seeded means real rows produced by a real sync, so a screen
  that looks wrong on real data looks wrong in development too.
- The only true serial chain in the whole plan is: Graph port, then My channel.
  It starts on day one for that reason.

---

# 6. The single biggest risk

**The frame pass cannot be proven to work until someone tries it, and a named
third of the one job depends on it.**

The one job is "take its hook, its script and its layout". The hook and the
script are text problems and the pipeline for them already works. The layout is
a vision problem: sample frames from the video, ask a model where the on-screen
text sits, how often it cuts, and how it is framed.

The configured model is a local router on port 20128 serving
`nvidia/minimaxai/minimax-m2.7` through `CompatLlmClient`, which already has to
stream everything and prompt-engineer its JSON because the router only translates
the streaming wire format. Whether that path carries images at all is unknown
and unknowable without trying it. If it does not:

- The layout section renders as four dashes forever, which is honest and useless.
- Or the layout runs against the real Anthropic API, which means a per-analysis
  cost on a tool built specifically to avoid subscriptions.
- Or the layout section is cut, and V1 ships two thirds of its own stated
  purpose.

None of those is acceptable quietly, and all three are cheap to discover and
expensive to discover late. Hence wave 0: a spike, day one, before a pixel of
the layout UI exists. If it fails, the decision is Kai's and it should be made in
week one, not week six.

Runner up: the Instagram Graph Insights path for the owned channel. The code
risk is low because a working client already exists in Kai-Official-OS and the
instruction is to port it. The risk that remains is the token and permission path,
which no amount of engineering effort accelerates. Confirm the token is in hand
on day one. If it is not, My channel drops to P1 and the "reach" vocabulary stays
"views" across every screen until it is.
