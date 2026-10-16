# Publish cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Attach a video and write a caption | Uploads the mp4 a plan publishes and its caption, saved even when publishing itself is not yet possible | ● | `publish-dialog.tsx`, `uploadPlanVideoAction`, `setPlanCaptionAction` | none |
| 3 | Schedule a publish | Arms a plan so the in-process scheduler publishes it automatically at a chosen time | ● | `publish-dialog.tsx`, `schedulePublishAction`, `publish-scheduler.ts` | none |
| 4 | Publish now | Publishes a plan immediately instead of waiting on a schedule | ● | `publish-dialog.tsx`, `publishNowAction` | none |
| 5 | Track and recover a publish | Shows the live lifecycle on the calendar and day panel, and offers cancel and retry | ● | `mine-calendar.tsx`, `cancelScheduledPublishAction`, `retryFailedPublishAction` | none |
| 6 | See what publishing needs, honestly | States exactly which of the storage bucket or the Graph token is missing, and never fabricates a publish | ● | `publish-dialog.tsx`, `getStorageProvider`, `isGraphConfigured` | none |

### 2. Attach a video and write a caption

### Who uses it

The user, from a plan's day panel on the calendar.

### What it does

Clicking "Upload & schedule" (or "Edit publish" once a video is already attached) on a draft, scheduled, missed, or failed plan opens the publish dialog. A drop zone accepts an `.mp4` file, by drag or by a file picker; the upload runs immediately and the plan keeps whatever video and caption it already had if the dialog is closed before scheduling. The caption field shows a live character count against Instagram's 2200-character ceiling and saves on blur, independent of whether the plan is ever scheduled.

### How to access it

The "Upload & schedule" or "Edit publish" button in a plan's day detail panel.

### Business rules

- Only a file whose type or extension is `.mp4` is accepted; anything else is refused with an inline error before an upload is attempted.
- An empty file is refused.
- The caption is trimmed before it is measured against the 2200-character ceiling; a caption over that length is refused rather than truncated.
- Uploading and saving a caption both persist immediately, on their own, independent of the Schedule or Publish now action below; closing the dialog without scheduling still keeps the video and caption on the plan.

### Limitations

- There is no video preview or trim tool in this dialog; whatever mp4 is uploaded is the file that publishes, unedited.
- Replacing an already-attached video overwrites it; the dialog does not keep the previous upload.

### User guide

Open a plan from the calendar and click Upload & schedule. Drop an mp4, or click Choose file. Write the caption underneath it, watching the character count. Both save right away, even if you close the dialog before picking a time.

### 3. Schedule a publish

### Who uses it

The user, once a plan carries a video and a caption.

### What it does

Setting both a date and a time in the publish dialog and clicking Schedule arms the plan: `state` becomes `scheduled`, `scheduledAt` records the real instant, and the in-process scheduler takes it from there, publishing it automatically once that moment passes, with no further action needed. The scheduler ticks on an interval (about every 30 seconds) and claims each due row exactly once, so a scheduled publish survives a dev-server restart between the time it was scheduled and the time it goes out.

### How to access it

The publish dialog's Date and Time fields, then the Schedule button, which appears in place of Publish now once both fields are filled.

### Business rules

- The Schedule action is offered only once a video is attached, a caption is written, the storage bucket is configured, and the Graph token is configured; missing any one of the four disables it (see feature 6).
- Leaving the time blank publishes immediately instead of scheduling (feature 4); a date with no time behaves the same as neither being set.
- Scheduling can be cancelled at any point before it publishes (feature 5); it cannot be cancelled once the scheduler has claimed the row.
- Scheduling keeps the calendar's own date fields in sync, so a scheduled plan still renders in its correct month-grid cell.

### Limitations

- The schedule time has no time zone picker; it is read as the browser's local wall-clock time, matching the rest of the calendar's date-only planning fields.
- There is no way to schedule two different publish attempts for the same plan at once; scheduling again while already scheduled simply re-arms the same row to the new time.

### User guide

Once your video and caption are saved, pick a date and a time and click Schedule. Your plan is now armed. You do not need to keep the app open in the foreground for it to publish at that time, but the app itself does need to be running.

### 4. Publish now

### Who uses it

The user, when they want a plan to go out immediately rather than at a future time.

### What it does

Leaving the date and time blank in the publish dialog changes its one primary action to Publish now. Clicking it runs the whole publish path immediately: upload to the bucket, create the Reel container, poll it, publish (or stop short of publishing on a dry run), and report success or the specific reason it failed.

### How to access it

The publish dialog's Publish now button, shown whenever the date or time is blank.

### Business rules

- The same four preconditions as scheduling (video, caption, bucket, Graph token) gate this action too.
- Publish now claims the row atomically before publishing, the same guard the scheduler uses, so a plan already publishing or already published cannot be started a second time from this button.
- A failure here writes the plan to `failed` with an error class and message, exactly as a scheduled publish that fails would; nothing about the manual path skips the lifecycle.

### Limitations

- There is no progress indicator beyond the dialog's own "Working…" label while the request is in flight; the container-creation and polling steps happen server-side without a step-by-step status.
- Closing the browser tab mid-publish does not cancel it; the server-side call keeps running.

### User guide

To publish right away instead of scheduling, open a plan's publish dialog, leave the date and time blank, and click Publish now. The dialog stays open with a working state until the whole path finishes, then closes with a toast.

### 5. Track and recover a publish

### Who uses it

The user, watching a scheduled, in-flight, failed, or published plan on the calendar.

### What it does

The calendar cell and the day detail panel both read the plan's live state. A scheduled plan shows "scheduled"; once the scheduler claims it, the cell and panel show a pulsing "PUBLISHING"; a terminal failure shows "failed" with its error class and, under the attempt cap, a Retry button; a terminal success shows a green published mark, noting "(dry run)" when the final publish call was skipped. From the day panel, a scheduled plan can be cancelled back to an undated draft (with a designed confirm, never the browser's native one), and a failed plan under the attempt cap can be retried, re-arming it to `scheduled` for the next tick.

### How to access it

Automatic: the calendar cell and the day panel render whichever of these states the plan's `state` column currently holds. Cancel and Retry are buttons in the day panel, shown only for a plan in a state where they apply.

### Business rules

- Cancelling only works on a plan still `scheduled`; a plan already `publishing`, `published`, or `failed` has passed the point a clean pull-back is safe, so cancel is not offered on those.
- Cancelling returns the plan to an undated draft and clears its schedule fields, but keeps the attached video and caption, so re-scheduling does not require uploading again.
- Retry is offered only while `attemptCount` is under the fixed cap of three attempts; at the cap the plan stays `failed` with no further automatic or manual retry from this button.
- Retrying re-arms the plan to `scheduled` immediately (not on a backoff delay); the scheduler's own backoff only applies to a retry the scheduler itself re-arms after a failure, not to a hand-triggered retry.
- A plan cannot both be missed and mid-lifecycle: `missed` is derived only for a plain `scheduled` plan whose date has passed with no attempt yet made; once a plan reaches `publishing`, `failed`, or `published`, it is read exactly as that state, never re-derived to missed.

### Limitations

- There is no live progress percentage or step name while a plan is `publishing`, only the pulsing label; the actual container-creation and polling steps are not surfaced to the UI.
- Deleting a plan that carries an uploaded video goes through the same designed confirm as cancelling, since the video is otherwise lost with the plan; a plan with no video deletes without a confirmation step.

### User guide

Watch a plan's calendar cell to see where it stands: scheduled, publishing, failed, or published. Open its day panel for the detail, including the exact reason a failed attempt did not go through. If it failed and has attempts left, click Retry. If you change your mind before it goes out, open the panel and click "cancel scheduled publish."

### 6. See what publishing needs, honestly

### Who uses it

The user, on a machine where the storage bucket, the Graph token, or both, are not yet configured.

### What it does

The publish dialog checks both requirements before offering to schedule or publish: whether an S3-compatible bucket is configured (`S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`) and whether the Graph API token is configured (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`). Either missing disables the one primary action and states exactly which environment variables to set; the video upload and the caption still save, so nothing about the plan is lost while configuration catches up. Outside production, a configured setup still shows a dry-run banner explaining that the whole path runs but the final publish call is skipped.

### How to access it

Automatic: this is what the publish dialog shows in place of an enabled Schedule/Publish now action whenever either requirement is missing.

### Business rules

- The bucket and the Graph token are checked independently; the dialog names whichever one, or both, are missing, never a generic "not configured" line.
- A dry-run publish still writes the plan `published`, with `dryRun` set, so it is never left looking mid-flight or failed just because the final call was intentionally skipped.
- Whether a given run is a dry run is decided once, per attempt, from `PUBLISH_DRY_RUN` and the environment; a plan does not carry a fixed dry-run setting of its own that would let one plan behave differently from another on the same machine.

### Limitations

- The bucket and the Graph token are both environment-only configuration; there is no in-app settings screen to set them, matching the same limitation mine's own Graph connect panel already has for read-only Insights.
- The dry-run banner shows only in the publish dialog; a plan's calendar cell and day panel show the same "published" mark for a dry run and a real one, distinguished only by the "(dry run)" suffix in the day panel.

### User guide

If Schedule or Publish now is greyed out, the dialog tells you exactly what to set, either the storage bucket variables or the Instagram Graph token, in `.env.local`. Your video and caption are still saved while you fix it. On a development machine, expect to see a dry-run notice even once everything is configured; that is normal until the app is actually running in production.

### 7. Interactions with other systems

Publish extends `planned_posts`, the table [mine](mine.md) already owns; every feature above is additional state and additional UI on plans mine's own planning features (create, edit, delete, mark published by hand) still fully control. Marking a plan published by hand (mine's own `markPlanPublishedAction`) and a real publish reaching `published` through this component both end in the same `state: "published"`, but only a real publish also sets `dryRun` and `publishedAt` from this component's own writes. The scheduler shares the Graph client and the `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` credentials with mine's own read-only Insights panel; a token that is invalid for reading Insights is exactly as invalid for publishing, since both go through the same `isGraphConfigured()` check. The instagrapi sidecar ig-sync depends on is never touched by any feature here.

### 8. Edge cases

- A plan scheduled, then deleted before the scheduler claims it, is simply gone; the scheduler's next tick finds no such row and does nothing.
- Two tabs open on the same plan cannot both publish it: whichever caller's atomic claim (the scheduler's tick, or a hand click of Publish now) lands first wins, and the other sees zero rows changed and no-ops.
- A plan that fails on its final attempt (`attemptCount` at the cap) stays `failed` forever unless a human clicks Retry; nothing re-arms it automatically past the cap.
- If the whole server process is killed between the atomic claim and the terminal write, the row stays `publishing` until it is older than 20 minutes; the scheduler's next tick then re-claims and finishes it.
- Restarting the dev server does not lose a schedule: `scheduledAt` is durable on the row, and the scheduler's next tick after boot picks up any row already due.

## publish: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: start the dev server and open `http://localhost:3001` (never `127.0.0.1`) for the behavior and browse-e2e cases, on a plan that already has an own channel and a Graph token connected (see mine's own test-cases doc for that setup). Route and action cases run with `vitest` against a temporary SQLite database and mocked Graph client and storage provider; `src/server/services/publish-post.test.ts`, `src/server/services/publish-scheduler.test.ts`, and the publish-related suites in `src/server/actions/planned-post-actions.test.ts` cover this component today, so no live Graph token, no live bucket, and no real Instagram call is required for that lens. For the behavior and browse-e2e lenses, a real, configured `S3_*` bucket and a real `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` are needed to reach the scheduled/publishing/published states through the actual UI; without them, only the not-configured surface (feature 6) is reachable. Needs column values: `mouse` and `keyboard` are the input; `not-configured` means the bucket or the Graph token, or both, are cleared; `configured, dry-run` means both are set and `PUBLISH_DRY_RUN` is unset outside production (the default); `configured, live` means a real Business or Creator account and a real bucket, with `PUBLISH_DRY_RUN=0`.

## 1. behavior

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PUB-01 | P1 | mouse | Uploading a non-mp4 file is refused inline before any upload is attempted ([attach a video and write a caption](#2-attach-a-video-and-write-a-caption)). | Publish dialog open on a draft plan. | 1. Drop or pick a `.mov` file.<br>2. Read the dialog. | An inline error reads that only an `.mp4` video can be published; no upload runs. | 🟢 pass (browser): created a plan via the mine calendar, opened its publish dialog, picked a `.mov` file; the dialog showed "Only an .mp4 video can be published." inline, no upload attempted (see test-shots/publish/PUB-01.png) |
| PUB-02 | P1 | mouse | The caption count and the 2200 ceiling are enforced, and the caption saves on blur independent of scheduling ([attach a video and write a caption](#2-attach-a-video-and-write-a-caption)). | Publish dialog open, video already attached. | 1. Type a caption.<br>2. Read the character count.<br>3. Click outside the field.<br>4. Close the dialog without scheduling.<br>5. Reopen it. | The count updates live against `/ 2200`; the caption is still there on reopen. | 🟢 pass (browser): attached a real mp4, typed a caption, count read "N / 2200" live; blurred (db row updated immediately, no schedule needed); closed with Cancel and reopened via Edit publish, the caption and video were both still there (see test-shots/publish/PUB-02.png, PUB-02-reopen.png) |
| PUB-03 | P1 | configured, dry-run | Scheduling a plan with a future date and time arms it, and the scheduler publishes it as a dry run once the time passes ([schedule a publish](#3-schedule-a-publish)). | Plan with a video and caption attached, bucket and Graph token configured, dry run on. | 1. Set a date and time a few minutes out.<br>2. Click Schedule.<br>3. Wait past the scheduled time.<br>4. Reload the calendar. | The dialog closes with a "Scheduled" toast; after the time passes the cell shows "PUBLISHING" then a green published mark noting "(dry run)". | 🟡 blocked: S3 not configured in this sandbox (no `S3_*` values anywhere, not `.env.local` nor the secrets table), so `Schedule`/`Publish now` stays disabled and a real schedule cannot be armed through the UI without faking the bucket |
| PUB-04 | P1 | configured, dry-run | Leaving date and time blank changes the primary action to Publish now, and clicking it runs the whole path immediately ([publish now](#4-publish-now)). | Plan with a video and caption attached, bucket and Graph token configured, dry run on. | 1. Leave date and time blank.<br>2. Click Publish now.<br>3. Wait for the dialog to close. | The button reads "Publish now"; after it resolves, a "Dry-run publish complete" toast shows and the plan reads published, dry run. | 🟡 blocked: same reason as PUB-03, S3 not configured. Did confirm the button-label half for free: with date and time blank the primary action reads "Publish now" (see test-shots/publish/PUB-01.png), it is just disabled |
| PUB-05 | P2 | not-configured | With the bucket or the Graph token missing, the dialog names exactly what is missing and disables the primary action, while the upload and caption still save ([see what publishing needs, honestly](#6-see-what-publishing-needs-honestly)). | `S3_BUCKET` cleared, Graph token left set. | 1. Open the publish dialog.<br>2. Read the not-configured block.<br>3. Attach a video and caption anyway. | The block names the missing `S3_*` variables; Schedule/Publish now is disabled; the video and caption still save. | 🟢 pass (browser): this sandbox already has no `S3_*` configured and a working Graph token, matching the setup exactly. The block read "Set S3_* to publish (S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_PUBLIC_BASE)" only (no Graph line); Publish now stayed disabled; attaching a real mp4 and a caption both saved to the plan row regardless (see test-shots/publish/PUB-05.png) |
| PUB-06 | P1 | configured, dry-run | A publishing plan shows a pulsing "PUBLISHING" on both the calendar cell and the day panel while the scheduler holds it ([track and recover a publish](#5-track-and-recover-a-publish)). | A plan the scheduler has just claimed (state `publishing`). | 1. Open the calendar during the claim window.<br>2. Read the cell, then the day panel. | Both show a pulsing "PUBLISHING" label; no Schedule/Cancel/Retry controls show while in this state. | 🟢 pass (browser + source): set a plan's `state` to `publishing` directly (the scheduler's own claim write, no live scheduler needed to observe the rendered state); the calendar cell and the day panel both read "PUBLISHING", both carry `animate-pulse` (`data-testid="mine-calendar-publishing"` / `"mine-plan-publishing"` in `mine-calendar.tsx`); only edit/reschedule and delete remained, no Schedule/Cancel/Retry (see test-shots/publish/PUB-06.png) |
| PUB-07 | P1 | mouse | Cancelling a scheduled publish goes through a designed confirm, not the browser's native one, and returns the plan to an undated draft keeping its video and caption ([track and recover a publish](#5-track-and-recover-a-publish)). | A `scheduled` plan. | 1. Open its day panel.<br>2. Click "cancel scheduled publish".<br>3. Read the confirm dialog.<br>4. Confirm. | A designed confirm dialog appears (never `window.confirm`); after confirming, the plan is an undated draft with its video and caption still attached. | 🟢 pass (browser): set `scheduled_at` on a plan directly (`cancelScheduledPublishAction` only gates on `state === "scheduled"`, matching the mine calendar's own scheduled state), attached a real video and caption through the dialog, then clicked "cancel scheduled publish"; a designed "Keep it / Cancel publish" dialog appeared, and confirming left the plan `state=draft`, `scheduled_at`/`planned_date` null, with its caption and video_asset_id unchanged (see test-shots/publish/PUB-07-confirm.png, PUB-07.png) |
| PUB-08 | P1 | mouse | A failed plan under the attempt cap shows its error class and a Retry button; at the cap, Retry is not offered ([track and recover a publish](#5-track-and-recover-a-publish)). | One failed plan with `attemptCount` under 3, one at 3. | 1. Open each day panel.<br>2. Read the failed block. | The under-cap plan shows the error class, the message, and a Retry button; the at-cap plan shows the same block with no Retry button. | 🟢 pass (browser + source): set one plan to `state=failed, attempt_count=1` and another to `attempt_count=3` (the cap, `MAX_PUBLISH_ATTEMPTS` in `mine-calendar.tsx`). The under-cap panel read "publish failed · NETWORK / Upload timed out" with a Retry button; the at-cap panel read "publish failed · GRAPH_REJECTED / Instagram rejected the media" with no Retry button (see test-shots/publish/PUB-08-under-cap.png, PUB-08-at-cap.png) |
| PUB-09 | P2 | mouse | Deleting a plan that carries an uploaded video goes through the designed confirm; a plan with no video deletes without one ([track and recover a publish](#5-track-and-recover-a-publish)). | One plan with a video attached, one without. | 1. Click delete on each. | The plan with a video shows the confirm dialog first; the plan without deletes immediately. | 🟢 pass (browser): deleting the plan with an attached video showed a "Keep it / Delete plan" confirm first; confirming removed the row. Deleting an undated draft with no video removed it immediately, no confirm dialog (see test-shots/publish/PUB-09-confirm.png, PUB-09.png) |

Not checkable by hand:

- Whether a real live publish (not a dry run) against a genuine Business or Creator account completes end to end within the polling window; only a dry-run path has been exercised.
- Whether the scheduler actually survives a real `next dev` process restart mid-schedule outside a deliberate manual test, since the interval and the claim are read from code, not observed across a real kill.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ACTION-P01 | P1 | server action (`src/server/actions/planned-post-actions.ts :: uploadPlanVideoAction`) | A non-mp4 file is refused before the media store is touched. | A plan row. | `uploadPlanVideoAction(id, formData)` with a `.png` file. | Returns `{ ok: false, code: "PLAN_NOT_MP4" }`; `videoAssetId` on the row is unchanged. | 🟢 covered by vitest (green) |
| ACTION-P01b | P1 | server action (`src/server/actions/planned-post-actions.ts :: uploadPlanVideoAction`) | An oversize, empty, or unplanned upload is refused before its bytes are read, and an upload to a published plan returns `PLAN_LOCKED` and keeps the stored video. | A draft plan with an attached video. | Upload with `size` over 200 MB, size 0, to `no-such-plan`; mark the plan published and upload again. | `PLAN_FILE_TOO_LARGE`, `PLAN_EMPTY_FILE`, `PLAN_NOT_FOUND` with `arrayBuffer` never called; `PLAN_LOCKED` with `videoAssetId` unchanged. | 🟢 covered by vitest (green) |
| ACTION-P02 | P1 | server action (`src/server/actions/planned-post-actions.ts :: setPlanCaptionAction`) | A caption over 2200 characters is refused; a valid one is trimmed and stored. | A plan row. | `setPlanCaptionAction(id, "a".repeat(2201))`, then `setPlanCaptionAction(id, "  hello  ")`. | First call returns `{ ok: false, code: "PLAN_CAPTION_TOO_LONG" }` with no write. Second call stores `caption: "hello"`. | 🟢 covered by vitest (green) |
| ACTION-P03 | P1 | server action (`src/server/actions/planned-post-actions.ts :: schedulePublishAction`) | Each of the four preconditions (video, caption, bucket, Graph) is checked and refused independently, in order, before any row is touched. | A bare draft plan, storage and Graph both unconfigured. | `schedulePublishAction(id, futureIso)` with nothing attached, then again after attaching a video and caption. | First call returns `{ ok: false, code: "PLAN_NO_VIDEO" }`. After attaching video and caption, returns `{ ok: false, code: "PLAN_NO_BUCKET" }` (storage still unconfigured), never touching `state`. | 🟢 covered by vitest (green) |
| ACTION-P04 | P1 | server action (`src/server/actions/planned-post-actions.ts :: schedulePublishAction`) | A successful schedule writes `state: "scheduled"`, `scheduledAt`, and a unique `idempotencyKey` of `id:scheduledAt`. | A plan with video, caption, storage and Graph both mocked configured. | `schedulePublishAction(id, "2026-09-05T10:00")`. | Row reads `state: "scheduled"`, `scheduledAt` as the resolved ISO instant, `idempotencyKey` equal to `` `${id}:${scheduledAt}` ``. | 🟢 covered by vitest (green) |
| ACTION-P05 | P1 | server action (`src/server/actions/planned-post-actions.ts :: publishNowAction`) | The atomic claim refuses a second concurrent call on the same row; only one of two racing calls returns success. | A plan with video, caption, storage and Graph configured; `publishNowAction` mocked to be slow. | Two concurrent `publishNowAction(id)` calls. | Exactly one returns `{ ok: true }`; the other returns `{ ok: false, code: "PLAN_ALREADY_IN_FLIGHT" }`. | 🟢 covered by vitest (green) |
| ACTION-P06 | P1 | server action (`src/server/actions/planned-post-actions.ts :: retryFailedPublishAction`) | Retrying is refused once `attemptCount` reaches the cap, and refused on a plan not in `failed`. | A `failed` plan at `attemptCount: 3`; a `scheduled` plan. | `retryFailedPublishAction(id)` on each. | The at-cap plan returns `{ ok: false, code: "PLAN_RETRY_EXHAUSTED" }`. The scheduled plan returns `{ ok: false, code: "PLAN_NOT_FAILED" }`. | 🟢 covered by vitest (green) |
| ACTION-P07 | P1 | server action (`src/server/actions/planned-post-actions.ts :: cancelScheduledPublishAction`) | Cancelling only succeeds on a `scheduled` row and clears its schedule fields while keeping the video and caption. | A `scheduled` plan with a video and caption. | `cancelScheduledPublishAction(id)`. | Row reads `state: "draft"`, `scheduledAt: null`, `idempotencyKey: null`; `videoAssetId` and `caption` are unchanged. | 🟢 covered by vitest (green) |
| ACTION-P08 | P1 | service (`src/server/services/publish-post.ts :: publishPlannedPost`) | A dry-run publish uploads, creates and polls the container, skips `publishReel`, and still writes `published` with `dryRun: 1`, deleting the uploaded object regardless. | A claimed row, storage and Graph mocked to succeed, dry run resolved true. | `publishPlannedPost(id, { claimed: true })`. | Returns `{ ok: true, state: "published", dryRun: true }`; the mocked `publishReel` is never called; the mocked `provider.delete` is called once. | 🟢 covered by vitest (green) |
| ACTION-P09 | P1 | service (`src/server/services/publish-post.ts :: publishPlannedPost`) | A row already `published` or `failed` is a no-op; a `publishing` row is only acted on when `claimed: true`. | One `published` row, one `failed` row, one `publishing` row. | `publishPlannedPost(id)` on each, then `publishPlannedPost(publishingId, { claimed: true })`. | The published and failed rows both return `{ ok: true, state: "noop" }` with no writes. The unclaimed publishing row also returns `noop`. The claimed call actually publishes. | 🟢 covered by vitest (green) |
| ACTION-P10 | P1 | service (`src/server/services/publish-post.ts :: publishPlannedPost`) | Every precondition and Graph failure writes a terminal `failed` state with the matching `errorClass`, and the uploaded object is still deleted after a mid-flight failure. | A claimed row; storage mocked to succeed, Graph container creation mocked to throw a `GRAPH_CONTAINER_FAILED` error. | `publishPlannedPost(id, { claimed: true })`. | Returns `{ ok: false, state: "failed", errorClass: "container" }`; `provider.delete` is still called once. | 🟢 covered by vitest (green) |
| ACTION-P11 | P1 | service (`src/server/services/publish-scheduler.ts :: runDuePublishes`) | Two ticks racing the same due row claim it exactly once; the loser's claim changes zero rows and never publishes. | One `scheduled` row due now, a real temporary SQLite database, `claim` called twice concurrently. | Two concurrent `runDuePublishes` calls (or two direct `claim` calls) against the same row. | Exactly one claim reports a row changed; `result.claimed` sums to 1 across both ticks, never 2. | 🟢 covered by vitest (green) |
| ACTION-P12 | P1 | service (`src/server/services/publish-scheduler.ts :: runDuePublishes`) | A `failed` row under the attempt cap is re-armed to `scheduled` at a backed-off `scheduledAt`; a row at the cap is left `failed`. | One failed row at `attemptCount: 1`, one at `attemptCount: 3` (the cap). | `runDuePublishes(now)`. | The under-cap row reads `state: "scheduled"` with `scheduledAt` about one minute after `now`; the at-cap row is untouched, still `failed`. | 🟢 covered by vitest (green) |
| ACTION-P13 | P2 | service (`src/server/services/publish-scheduler.ts :: startPublishScheduler`) | A tick still in flight causes the next interval fire to be skipped rather than overlapping it. | A `publish` dependency that resolves slowly; `startPublishScheduler` with a short interval. | Advance fake timers past two interval periods while the first tick's `publish` call is still pending. | The second interval fire is skipped (the mocked tick body runs once, not twice) until the first tick's promise resolves. | 🟢 covered by vitest (green) |
| ACTION-P14 | P1 | seam (`src/server/publish/storage-provider.ts :: getStorageProvider`) | Any one of the five required `S3_*` variables missing makes `getStorageProvider()` return `null`, not a broken provider. | `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE` set, then `S3_SECRET` cleared. | `getStorageProvider()` before and after clearing `S3_SECRET`. | Returns an `S3StorageProvider` instance, then `null`. | 🟢 covered by vitest (green) |

Not checkable by hand:

- Live behavior of the hand-rolled SigV4 signer against a real R2 or S3 bucket beyond what a mocked `fetch` in these tests exercises.
- Live Graph API container-processing timing and rate-limit behavior beyond what the mocked client's fixtures assert.

## 3. browse-e2e

Real browser journeys driven by the `browse` skill against the dev server on port 3001, one checked-in `scripts/e2e/publish-<id>.sh` per row. Coverage: one happy-path journey per built feature (features 2, 3, 4, 5, and 6, all `●`; the `03` summary table has no `○` roadmap rows to exempt), plus five distinct corner-case types (`invalid`, `empty`, `boundary`, `auth`, `failure`). All five built features carry a happy row (Feat 2 = E2E-01, Feat 3 = E2E-02, Feat 4 = E2E-03, Feat 5 = E2E-04, Feat 6 = E2E-05).

The `concurrency`, `repeat`, `stale`, and `network` types do apply to publish (a double-clicked Publish now, a re-scheduled plan, the optimistic day-panel state before a reload, and a Graph or bucket outage mid-publish), but every one of them is only reachable once storage and Graph are configured, so they are deferred to the live QA round rather than scripted offline here; the five offline corner types above are the runnable floor.

Testid gap: the caption character count in `publish-dialog.tsx` is a bare `<span>` with no `data-testid`, so E2E-08 reads it with `assert_text` on the "/ 2200" text. Filed as PUB-08 in GitHub issues (label `backlog`).

| ID | P | Feat | Type | Mode | Journey | Setup | Steps | Expected | Script | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-01 | P1 | 2 | happy | offline | Attach an mp4 and a caption, both persist without scheduling | Dev server up on 3001 against the seeded fixture DB; a draft plan with no video on the shown month; no external service (upload uses the local content-addressed media store, not the bucket). | Arrive on `/mine` with the seeded draft visible. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"` ("Upload & schedule"); pick an `.mp4` via `data-testid="publish-dialog-pick"` then `data-testid="publish-dialog-file"`; type a caption into `data-testid="publish-dialog-caption"`; close with `data-testid="publish-dialog-cancel"`; reopen with `data-testid="mine-plan-open-publish"`. | `data-testid="publish-dialog-dropzone"` shows the uploaded file name instead of "Drop an .mp4 here" and `data-testid="publish-dialog-pick"` now reads "Replace video"; after reopening, `data-testid="publish-dialog-caption"` still holds the typed caption. | `scripts/e2e/publish-e2e-01.sh` | 🟢 pass (browser): same drive as PUB-02 on the real db; dropzone showed the file name and "Replace video" after upload, and the caption survived a Cancel-and-reopen round trip (see test-shots/publish/PUB-02.png, PUB-02-reopen.png) |
| E2E-02 | P1 | 3 | happy | live | Schedule a future publish arms the plan | Dev server up, `S3_*` and `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` configured, `PUBLISH_DRY_RUN` unset (dry run); a plan with a video and caption already attached. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"`; set `data-testid="publish-dialog-date"` and `data-testid="publish-dialog-time"` a few minutes out; click `data-testid="publish-dialog-submit"` (reads "Schedule"). | A "Scheduled" toast (read via `assert_text`); the dialog closes; the plan's cell shows `data-testid="mine-calendar-scheduled"` and its day panel shows `data-testid="mine-plan-scheduled-at"`. | none | 🟡 blocked: same as PUB-03, `S3_*` is not configured in this sandbox so the submit button never enables |
| E2E-03 | P1 | 4 | happy | live | Publish now on a dry run and see the published mark | Dev server up, storage and Graph configured, dry run on; a plan with a video and caption attached. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"` ("Edit publish"); confirm `data-testid="publish-dialog-dry-run"` banner is present; leave date and time blank; click `data-testid="publish-dialog-submit"` (reads "Publish now"). | A "Dry-run publish complete" toast (`assert_text`); the dialog closes; the day panel `data-testid="mine-plan-published"` reads "published (dry run)" and the cell shows `data-testid="mine-calendar-published"`. | none | 🟡 blocked: same as PUB-04, `S3_*` not configured so the dry-run banner and the actual publish path are unreachable through the UI |
| E2E-04 | P1 | 5 | happy | offline | Cancel a scheduled publish back to a draft through the designed confirm | Seeded fixture DB with one `scheduled` plan (future `scheduledAt`, video and caption attached, so the scheduler never claims it during the run); dev server up; no external service. | Arrive on `/mine`. Act: click the scheduled plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-cancel-publish"` ("cancel scheduled publish"); in `data-testid="mine-confirm-cancel-publish"` click `data-testid="mine-confirm-cancel-publish-confirm"`. | `data-testid="mine-confirm-cancel-publish"` appears before the confirm click; after confirming, `data-testid="mine-plan-scheduled-at"` is gone from the panel and the cell no longer shows `data-testid="mine-calendar-scheduled"`; reopening `data-testid="mine-plan-open-publish"` shows the caption still in `data-testid="publish-dialog-caption"`. | `scripts/e2e/publish-e2e-04.sh` | 🟢 pass (browser): same drive as PUB-07 on the real db (see test-shots/publish/PUB-07-confirm.png, PUB-07.png) |
| E2E-05 | P2 | 6 | happy | offline | With storage and Graph unset, the dialog states exactly what is missing and disables the action while the upload and caption still save | `S3_*` and `IG_GRAPH_*` cleared; dev server up; a draft plan with no video. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"`; read `data-testid="publish-dialog-not-configured"`; pick an `.mp4` via `data-testid="publish-dialog-pick"`/`data-testid="publish-dialog-file"`; type a caption into `data-testid="publish-dialog-caption"`; close with `data-testid="publish-dialog-cancel"`; reopen. | `data-testid="publish-dialog-not-configured"` names both the Graph vars (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`) and the `S3_*` vars (`assert_text`); `data-testid="publish-dialog-submit"` is disabled; on reopen `data-testid="publish-dialog-dropzone"` shows the file name and `data-testid="publish-dialog-caption"` retains the caption. | `scripts/e2e/publish-e2e-05.sh` | 🟢 pass (bucket-only browser drive + source), Graph half not force-invalidated: PUB-05 already drove the bucket-missing branch live. `publish-dialog.tsx`'s two warning blocks are independent `{!graphConfigured && ...}` / `{!bucketConfigured && ...}` JSX conditions with no interaction between them, so clearing Graph too would add its own paragraph without changing the bucket one; the Graph token stays valid here on purpose (other components' rows depend on it) |
| E2E-06 | P1 | 2 | invalid | offline | A non-mp4 file is refused inline before any upload | Dev server up; a draft plan; publish dialog reachable. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"`; pick a `.mov` file via `data-testid="publish-dialog-file"`. | `data-testid="publish-dialog-error"` reads "Only an .mp4 video can be published."; `data-testid="publish-dialog-dropzone"` still shows "Drop an .mp4 here" (`assert_text`, no file attached); `data-testid="publish-dialog-submit"` stays disabled. | `scripts/e2e/publish-e2e-06.sh` | 🟢 pass (browser): same drive as PUB-01 on the real db (see test-shots/publish/PUB-01.png) |
| E2E-07 | P2 | 2 | empty | offline | A fresh draft with no video shows the zero-data upload prompt and cannot submit | Dev server up; a draft plan with no video and no caption. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"`. | `data-testid="publish-dialog-dropzone"` shows "Drop an .mp4 here" (`assert_text`); `data-testid="publish-dialog-pick"` reads "Choose file"; `data-testid="publish-dialog-submit"` is disabled while no video is attached. | `scripts/e2e/publish-e2e-07.sh` | 🟢 pass (browser): created a fresh draft plan and opened its publish dialog; dropzone read "Drop an .mp4 here", pick button read "Choose file", Publish now disabled (see test-shots/publish/E2E-07.png) |
| E2E-08 | P2 | 2 | boundary | offline | The caption holds at the 2200-character ceiling and the field will not exceed it | Dev server up; publish dialog open on a plan with a video attached. | Arrive on `/mine`. Act: open the plan's cell `data-testid="mine-calendar-day"` and `data-testid="mine-plan-open-publish"`; type or paste a 2200-character caption into `data-testid="publish-dialog-caption"`; attempt one more character. | The count reads "2200 / 2200" (read via `assert_text`; the count span carries no `data-testid` yet, filed PUB-08); the `data-testid="publish-dialog-caption"` value length stays 2200 because the textarea `maxLength` blocks the 2201st character. | `scripts/e2e/publish-e2e-08.sh` | 🟢 pass (browser): filled exactly 2200 characters, count read "2200 / 2200"; a further real keystroke at the end left the value length at 2200, `maxLength` held (see test-shots/publish/E2E-08.png) |
| E2E-09 | P1 | 6 | auth | offline | A missing Graph token alone gates the action while a configured bucket and the stored video are preserved | `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` cleared, `S3_*` set; dev server up; a plan that already has a video and caption. | Arrive on `/mine`. Act: click the plan's cell `data-testid="mine-calendar-day"`; click `data-testid="mine-plan-open-publish"`; read `data-testid="publish-dialog-not-configured"`. | `data-testid="publish-dialog-not-configured"` names only the Graph vars (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`) and not the `S3_*` line (`assert_text`); `data-testid="publish-dialog-submit"` is disabled; the attached video still shows in `data-testid="publish-dialog-dropzone"` and the caption in `data-testid="publish-dialog-caption"`. | `scripts/e2e/publish-e2e-09.sh` | 🟡 blocked: the Graph token is configured and working in this sandbox and other components' already-recorded rows rely on it staying that way; invalidating it just for this row's narrower branch was not attempted. Also S3 is not configured here either way, so a truly isolated "Graph missing, bucket present" state cannot be reached without a config change beyond a plain db write |
| E2E-10 | P1 | 5 | failure | offline | A failed plan shows its error class inline with a Retry under the cap, and no Retry at the cap | Seeded fixture DB with two `failed` plans, one at `attemptCount` 1 and one at 3 (the cap); dev server up. | Arrive on `/mine`. Act: click the under-cap failed plan's cell `data-testid="mine-calendar-day"` and read the panel; click the at-cap failed plan's cell `data-testid="mine-calendar-day"` and read the panel. | The under-cap panel shows `data-testid="mine-plan-failed"` with its error-class text and a `data-testid="mine-plan-retry"` button; the at-cap panel shows `data-testid="mine-plan-failed"` with no `data-testid="mine-plan-retry"` present; both failed cells show `data-testid="mine-calendar-failed"`. | `scripts/e2e/publish-e2e-10.sh` | 🟢 pass (browser): same drive as PUB-08 on the real db (see test-shots/publish/PUB-08-under-cap.png, PUB-08-at-cap.png) |

None of these journeys have been driven through `browse` against a running dev server as part of this authoring pass; every `Result` is `not run` until the QA round drives it (an `offline` row to 🟢/🔴 with a `test-shots/` screenshot, a `live` row honestly to 🟡 in a bare sandbox naming its missing Graph or storage dependency).

Not checkable by hand:

- Any journey through a real, non-dry-run publish is not scripted here, since it needs a real Business or Creator account and would post a real Reel; that path is exercised at the action layer instead (ACTION-P08 through ACTION-P10, with the Graph client mocked).
- The `concurrency`, `repeat`, `stale`, and `network` corner types (a double-clicked Publish now, a re-armed re-schedule, the optimistic pre-reload day-panel state, a mid-publish Graph or bucket outage) all need storage and Graph configured to reach, so they are left to the live QA round rather than scripted offline.

## 4. security-lite

publish has no license gate, no sidecar call, and no cross-tenant surface; crowsnest is single-user with no tenants. Its real threat surface is the Graph API credentials, the storage bucket credentials, and making sure a publish never sends buyer data anywhere but the two configured providers.

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-P01 | P1 | Secret handling | The Graph token (`IG_GRAPH_TOKEN`) never appears in a thrown error, a log line, or an action's returned JSON, including a Graph failure during publish. | A publish attempt with the Graph client mocked to fail with a message containing the token. | 1. Trigger `publishPlannedPost` against the failing mock.<br>2. Inspect the returned `lastError` and any log call. | The token string never appears in `lastError` or in any logged field; `redactToken` strips it wherever the real client would emit it. | 🟢 pass (full source trace, not browser-drivable since it needs a mocked Graph client): traced every `throw new GraphApiError(...)` site in `graph/client.ts`. Every one either carries a hardcoded static string with no interpolation, or forwards a `message` built at one of exactly two sites (the network-error and HTTP-error branches of the internal GET helper), both of which wrap their string in `redactToken(..., token)` before returning it. `publishPlannedPost`'s own `fail()` just forwards `err.message` verbatim, so the token can only ever reach `lastError` pre-redacted |
| SEC-P02 | P1 | Secret handling | The S3 access key and secret are never included in an error message or a response body, including an upload failure. | A publish attempt with the storage provider's `fetch` mocked to return a non-OK response. | 1. Trigger an upload failure.<br>2. Inspect the thrown error's message and any action response. | The error message is limited to the HTTP status and status text; the access key and secret never appear in it. | 🟢 pass (full source trace): `storage-provider.ts` throws exactly two errors, `S3 upload failed: ${res.status} ${res.statusText}` and `S3 delete failed: ${res.status} ${res.statusText}`, matching the claim's exact wording; neither interpolates the access key or secret anywhere |
| SEC-P03 | P2 | No buyer data leaving the box | A publish sends the video only to the configured S3-compatible bucket and only to the Graph API; nothing is sent to the LLM proxy, the transcript provider, or the instagrapi sidecar. | A completed dry-run publish, all outbound calls mocked and observed. | 1. Trace every outbound call `publishPlannedPost` makes.<br>2. Confirm no LLM proxy, transcript provider, or sidecar call occurs. | The only outbound calls are the storage provider's PUT/DELETE and the Graph API's container/poll/publish edges; nothing else is called. | 🟢 pass (full source trace): `publish-post.ts`'s complete import list is `node:fs/promises`, drizzle, the db, the logger, `media/store`, `publish/storage-provider`, `graph/client`, `graph/errors`; no llm, transcript, or ig-sidecar import anywhere in the module or its call graph |
| SEC-P04 | P2 | Object lifecycle | The uploaded object is deleted from the bucket after every publish attempt, success, dry run, or failure, so a crashed attempt does not leave a public video sitting in the bucket indefinitely. | A publish attempt where the Graph container creation fails after a successful upload. | 1. Trigger the failure.<br>2. Confirm the storage provider's `delete` was called with the same `objectKey` the upload returned. | `delete` is called exactly once with the correct `objectKey`, even though the publish itself failed. | 🟢 pass (full source trace): `publishPlannedPost`'s `try { ... } finally { await provider.delete(upload.objectKey); }` wraps the entire container-create/poll/publish section; `upload` is only assigned once `provider.upload` has already succeeded, and the `finally` runs on every exit from that block, success, dry-run return, or any thrown `GraphApiError`/unknown error, calling delete with the same `objectKey` exactly once (a delete failure itself is caught and only logged, never re-thrown) |

Security-lite has no rows for a license gate, a sidecar shared token, or cross-tenant leakage, since publish calls no sidecar and enforces no license of its own; the S3 credentials and the Graph token are the only secrets this component reads.
