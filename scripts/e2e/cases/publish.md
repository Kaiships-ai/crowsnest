# Publish cases

## Built features

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Attach a video and write a caption | Stores the mp4 a plan publishes and its caption, saved even when publishing itself is not yet possible | ● | `uploadPlanVideoAction`, `setPlanCaptionAction`, `crowsnest_attach_video` | none |
| 3 | Schedule a publish | Arms a plan so the in-process scheduler publishes it automatically at a chosen time | ● | `schedulePublishAction`, `publish-scheduler.ts` | none |
| 4 | Publish now | Publishes a plan immediately instead of waiting on a schedule | ● | `publishNowAction` | none |
| 5 | Track and recover a publish | Retry a failed plan under the attempt cap, or cancel a scheduled one | ● | `retryFailedPublishAction`, `cancelScheduledPublishAction` | none |
| 6 | See what publishing needs, honestly | Refuses with a code naming which of the storage bucket or the Graph token is missing, and never fabricates a publish | ● | `getStorageProvider`, `isGraphConfigured` | none |
| 7 | Gate 2 before every publish | Publish from a Plan card stores a draft with five checks (video, caption, keyword as a warning, time, cover); Kai approves it on the Gate 2 board, which arms or publishes the reel with its cover, and journals who proposed and who approved. A reel with no approved draft of exactly its video, caption and cover never publishes | ● | `src/server/services/gate2-drafts.ts`, `publishPlannedPost` (`isApproved`), `attachPlanVideo` (sibling `<name>-cover.png`) | no MCP tool drafts a publish |

The web app's publish dialog and Tuần này reel drawer are retired with the web app; a Lead Studio board replaces them. Every rule below is enforced in the server actions in `src/server/actions/planned-post-actions.ts` and the services they call.

### 2. Attach a video and write a caption

`uploadPlanVideoAction` and `crowsnest_attach_video` attach an mp4 through `attachPlanVideo`; `setPlanCaptionAction` stores the caption.

- Only an mp4 (an `ftyp` box) is accepted, at most 200 MB; an empty file is refused.
- The caption is trimmed before it is measured against the 2200-character ceiling; a caption over that length is refused rather than truncated.
- Uploading and saving a caption both persist on their own, independent of scheduling or publishing.
- Replacing an already-attached video overwrites it; a `publishing` or `published` plan refuses with `PLAN_LOCKED`.

### 3. Schedule a publish

`schedulePublishAction` arms the plan: `state` becomes `scheduled`, `scheduledAt` records the instant, and the in-process scheduler publishes it once that moment passes.

- It is refused unless a video is attached, a caption is written, the storage bucket is configured, and the Graph token is configured; each missing one has its own code (see feature 6).
- Scheduling can be cancelled at any point before it publishes (feature 5); it cannot be cancelled once the scheduler has claimed the row.
- Scheduling keeps `plannedDate` and `plannedTime` in sync with `scheduledAt`.
- Scheduling again while already scheduled re-arms the same row to the new time.
- The scheduler runs only while the process that started `startJobs` runs.

### 4. Publish now

`publishNowAction` runs the whole publish path immediately: upload to the bucket, create the Reel container, poll it, publish (or stop short of publishing on a dry run).

- The same four preconditions as scheduling gate it.
- It claims the row atomically before publishing, the same guard the scheduler uses, so a plan already publishing or published cannot be started a second time.
- A failure writes the plan to `failed` with an error class and message, exactly as a scheduled publish that fails would.

### 5. Track and recover a publish

- `cancelScheduledPublishAction` works only on a `scheduled` plan. It clears `scheduledAt` and `idempotencyKey` and keeps the day, the video, and the caption, so the plan can be scheduled again without a new upload.
- `retryFailedPublishAction` is refused once `attemptCount` reaches the cap of three (`PLAN_RETRY_EXHAUSTED`). Retrying re-arms the plan to `scheduled` at once; the scheduler's backoff applies only to retries it arms itself.
- `missed` is derived only for a plain `scheduled` plan whose date has passed with no attempt yet; `publishing`, `failed`, and `published` are always read as stored.
- `deletePlannedPostAction` refuses a `publishing` plan.

### 6. See what publishing needs, honestly

Both requirements are checked before a schedule or publish: whether an S3-compatible bucket is configured (`S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`), through `getStorageProvider`, and whether the Graph API token is configured, through `isGraphConfigured`.

- The bucket and the Graph token are checked independently, each with its own refusal code (`PLAN_NO_BUCKET`, `PLAN_NO_GRAPH`).
- A dry-run publish still writes the plan `published`, with `dryRun` set, so it is never left looking mid-flight or failed.
- Whether a run is a dry run is decided once, per attempt, from `PUBLISH_DRY_RUN` and the environment.
- The bucket is environment-only configuration.

### 7. Interactions with other systems

Publish extends `planned_posts`, the table [mine](mine.md) already owns; every feature above is additional state on plans mine's own planning features (create, edit, delete, mark published by hand) still fully control. Marking a plan published by hand (mine's own `markPlanPublishedAction`) and a real publish reaching `published` through this component both end in the same `state: "published"`, but only a real publish also sets `dryRun` and `publishedAt` from this component's own writes. The scheduler shares the Graph client and the `IG_GRAPH_TOKEN`/`IG_GRAPH_USER_ID` credentials with mine's own read-only Insights measurement; a token that is invalid for reading Insights is exactly as invalid for publishing, since both go through the same `isGraphConfigured()` check. The instagrapi sidecar ig-sync depends on is never touched by any feature here.

### 8. Edge cases

- A plan scheduled, then deleted before the scheduler claims it, is simply gone; the scheduler's next tick finds no such row and does nothing.
- Two callers cannot both publish one plan: whichever atomic claim (the scheduler's tick, or `publishNowAction`) lands first wins, and the other sees zero rows changed and no-ops.
- A plan that fails on its final attempt (`attemptCount` at the cap) stays `failed` unless a human retries it; nothing re-arms it automatically past the cap.
- If the whole server process is killed between the atomic claim and the terminal write, the row stays `publishing` until it is older than 20 minutes; the scheduler's next tick then re-claims and finishes it.
- Restarting the server does not lose a schedule: `scheduledAt` is durable on the row, and the scheduler's next tick after boot picks up any row already due.

## publish: test cases

Result markers: 🟢 pass, 🔴 bug, 🟡 blocked (missing dependency named in the cell). Rows still reading "not run" were not driven in QA round 1.

How to run these: route and action cases run with `pnpm test --project crowsnest` (vitest) against a temporary SQLite database and a mocked Graph client and storage provider. The web app's behavior cases, browser journeys, and its :3001 dev server are retired with the web app.

## 1. behavior

Retired with the web app (the publish dialog and reel drawer no longer exist): PUB-01, PUB-02, PUB-03, PUB-04, PUB-05, PUB-07, PUB-09. Their server claims are covered by ACTION-P01 through ACTION-P14.

Not checkable by hand:

- Whether a real live publish (not a dry run) against a genuine Business or Creator account completes end to end within the polling window; only a dry-run path has been exercised.

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
| ACTION-P07 | P1 | server action (`src/server/actions/planned-post-actions.ts :: cancelScheduledPublishAction`) | Cancelling only succeeds on a `scheduled` row and clears its schedule fields while keeping the video and caption. | A `scheduled` plan with a video and caption. | `cancelScheduledPublishAction(id)`. | Row keeps `state: "scheduled"` and its `plannedDate`, with `scheduledAt: null`, `idempotencyKey: null`; `videoAssetId` and `caption` are unchanged. | 🟢 covered by vitest (green) |
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

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GATE2-P01 | P1 | service (`publishPlannedPost`) | A reel with no approved draft never uploads or publishes. | A claimed reel with video and cover, no draft. | `publishPlannedPost(id, { claimed: true })`. | `failed` with `errorClass: "not_approved"`; no upload, no container. | 🟢 covered by vitest (`gate2-drafts.test.ts`) |
| GATE2-P02 | P1 | service (`approveGateDraft`) | Approve publishes with the cover and journals proposer and approver. | A drafted reel. | `approveGateDraft(id, "kai")`. | Container with `coverUrl`, `publishReel` called, two objects deleted, journal `drafted`, `pending`, `ok` at gate2. | 🟢 covered by vitest |
| GATE2-P03 | P1 | service (`draftPublish`) | A missing keyword warns; a missing cover refuses. | Reels without keyword, without cover. | `draftPublish(id, "now", ...)`. | `ok` with `keyword:warn`; `PUBLISH_CHECKS_FAILED`. | 🟢 covered by vitest |
| GATE2-P04 | P1 | service (`approveGateDraft`) | A caption changed after the draft refuses and keeps the draft pending with the reason. | A drafted reel, caption edited. | `approveGateDraft`. | `DRAFT_STALE`, draft `pending` with `last_error`, reel still draft. | 🟢 covered by vitest |
| GATE2-P05 | P1 | action (`schedulePublishAction`) | A 06:00 post under UTC+7 keeps its local day. | `TZ=Asia/Ho_Chi_Minh`. | `schedulePublishAction(id, "<day>T06:00")`. | `plannedDate` `<day>`, `plannedTime` `06:00`. | 🟢 covered by vitest |
| GATE2-P06 | P1 | app journey `gate2-01` | Publish sheet, Gate 2 board and approve against the fake Graph and bucket. | `gate2-lane.sh`. | Attach over MCP, Publish, Send, Today, Approve. | Fake Graph log: video and cover PUT, `media` with `cover_url`, poll, `media_publish`, both DELETEs; reel `published`. | 🟢 app journey |

## 3. browse-e2e

Retired with the web app: every browser journey and its per-row shell script. The app journey `gate2-01` (`gate2-lane.sh`) drives the publish sheet and the Gate 2 board.

## 4. security-lite

publish has no license gate, no sidecar call, and no cross-tenant surface; crowsnest is single-user with no tenants. Its real threat surface is the Graph API credentials, the storage bucket credentials, and making sure a publish never sends buyer data anywhere but the two configured providers.

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-P01 | P1 | Secret handling | The Graph token (`IG_GRAPH_TOKEN`) never appears in a thrown error, a log line, or an action's returned JSON, including a Graph failure during publish. | A publish attempt with the Graph client mocked to fail with a message containing the token. | 1. Trigger `publishPlannedPost` against the failing mock.<br>2. Inspect the returned `lastError` and any log call. | The token string never appears in `lastError` or in any logged field; `redactToken` strips it wherever the real client would emit it. | 🟢 pass (full source trace, not browser-drivable since it needs a mocked Graph client): traced every `throw new GraphApiError(...)` site in `graph/client.ts`. Every one either carries a hardcoded static string with no interpolation, or forwards a `message` built at one of exactly two sites (the network-error and HTTP-error branches of the internal GET helper), both of which wrap their string in `redactToken(..., token)` before returning it. `publishPlannedPost`'s own `fail()` just forwards `err.message` verbatim, so the token can only ever reach `lastError` pre-redacted |
| SEC-P02 | P1 | Secret handling | The S3 access key and secret are never included in an error message or a response body, including an upload failure. | A publish attempt with the storage provider's `fetch` mocked to return a non-OK response. | 1. Trigger an upload failure.<br>2. Inspect the thrown error's message and any action response. | The error message is limited to the HTTP status and status text; the access key and secret never appear in it. | 🟢 pass (full source trace): `storage-provider.ts` throws exactly two errors, `S3 upload failed: ${res.status} ${res.statusText}` and `S3 delete failed: ${res.status} ${res.statusText}`, matching the claim's exact wording; neither interpolates the access key or secret anywhere |
| SEC-P03 | P2 | No buyer data leaving the box | A publish sends the video only to the configured S3-compatible bucket and only to the Graph API; nothing is sent to the LLM proxy, the transcript provider, or the instagrapi sidecar. | A completed dry-run publish, all outbound calls mocked and observed. | 1. Trace every outbound call `publishPlannedPost` makes.<br>2. Confirm no LLM proxy, transcript provider, or sidecar call occurs. | The only outbound calls are the storage provider's PUT/DELETE and the Graph API's container/poll/publish edges; nothing else is called. | 🟢 pass (full source trace): `publish-post.ts`'s complete import list is `node:fs/promises`, drizzle, the db, the logger, `media/store`, `publish/storage-provider`, `graph/client`, `graph/errors`; no llm, transcript, or ig-sidecar import anywhere in the module or its call graph |
| SEC-P04 | P2 | Object lifecycle | The uploaded object is deleted from the bucket after every publish attempt, success, dry run, or failure, so a crashed attempt does not leave a public video sitting in the bucket indefinitely. | A publish attempt where the Graph container creation fails after a successful upload. | 1. Trigger the failure.<br>2. Confirm the storage provider's `delete` was called with the same `objectKey` the upload returned. | `delete` is called exactly once with the correct `objectKey`, even though the publish itself failed. | 🟢 pass (full source trace): `publishPlannedPost`'s `try { ... } finally { await provider.delete(upload.objectKey); }` wraps the entire container-create/poll/publish section; `upload` is only assigned once `provider.upload` has already succeeded, and the `finally` runs on every exit from that block, success, dry-run return, or any thrown `GraphApiError`/unknown error, calling delete with the same `objectKey` exactly once (a delete failure itself is caught and only logged, never re-thrown) |

Security-lite has no rows for a license gate, a sidecar shared token, or cross-tenant leakage, since publish calls no sidecar and enforces no license of its own; the S3 credentials and the Graph token are the only secrets this component reads.
