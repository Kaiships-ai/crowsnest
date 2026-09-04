# publish: feature description

publish is what turns a planned post on `/mine` from an intention into a real Reel on the creator's own Instagram channel. It adds no new page; every feature below lives inside the existing calendar day panel and a new dialog it opens. Nothing here ever fakes success: a missing storage bucket or a missing Graph token disables the one action that would publish and states exactly what is missing, and outside production a publish runs its whole real path except the very last call, so the flow is provably real without risking the live account.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Attach a video and write a caption | Uploads the mp4 a plan publishes and its caption, saved even when publishing itself is not yet possible | ● | `publish-dialog.tsx`, `uploadPlanVideoAction`, `setPlanCaptionAction` | none |
| 3 | Schedule a publish | Arms a plan so the in-process scheduler publishes it automatically at a chosen time | ● | `publish-dialog.tsx`, `schedulePublishAction`, `publish-scheduler.ts` | none |
| 4 | Publish now | Publishes a plan immediately instead of waiting on a schedule | ● | `publish-dialog.tsx`, `publishNowAction` | none |
| 5 | Track and recover a publish | Shows the live lifecycle on the calendar and day panel, and offers cancel and retry | ● | `mine-calendar.tsx`, `cancelScheduledPublishAction`, `retryFailedPublishAction` | none |
| 6 | See what publishing needs, honestly | States exactly which of the storage bucket or the Graph token is missing, and never fabricates a publish | ● | `publish-dialog.tsx`, `getStorageProvider`, `isGraphConfigured` | none |

## 2. Attach a video and write a caption

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

## 3. Schedule a publish

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

## 4. Publish now

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

## 5. Track and recover a publish

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

## 6. See what publishing needs, honestly

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

## 7. Interactions with other systems

Publish extends `planned_posts`, the table [mine](../mine/03-feature-description.md) already owns; every feature above is additional state and additional UI on plans mine's own planning features (create, edit, delete, mark published by hand) still fully control. Marking a plan published by hand (mine's own `markPlanPublishedAction`) and a real publish reaching `published` through this component both end in the same `state: "published"`, but only a real publish also sets `dryRun` and `publishedAt` from this component's own writes. The scheduler shares the Graph client and the `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` credentials with mine's own read-only Insights panel; a token that is invalid for reading Insights is exactly as invalid for publishing, since both go through the same `isGraphConfigured()` check. The instagrapi sidecar ig-sync depends on is never touched by any feature here.

## 8. Edge cases

- A plan scheduled, then deleted before the scheduler claims it, is simply gone; the scheduler's next tick finds no such row and does nothing.
- Two tabs open on the same plan cannot both publish it: whichever caller's atomic claim (the scheduler's tick, or a hand click of Publish now) lands first wins, and the other sees zero rows changed and no-ops.
- A plan that fails on its final attempt (`attemptCount` at the cap) stays `failed` forever unless a human clicks Retry; nothing re-arms it automatically past the cap.
- If the whole server process is killed between the atomic claim and this component's own terminal write, the row is left in `publishing` with nothing in this codebase that currently re-claims it; recognizing and recovering that state is not built (see [05-backlog-to-enhance](05-backlog-to-enhance.md)).
- Restarting the dev server does not lose a schedule: `scheduledAt` is durable on the row, and the scheduler's next tick after boot picks up any row already due.
