# Publish

Publish is the schedule-and-auto-publish machinery behind a planned post. The creator attaches an mp4 (with its cover), writes a caption, and sends the reel to Gate 2 from its Plan card, picking a time or right after approval. Approving the draft on the Gate 2 board either arms the reel for an in-process scheduler or publishes it at once to their own Instagram channel. It extends the `planned_posts` row that mine already owns; the publish sheet and the Gate 2 board are described in [boards](boards.md).

The publish path is the official Instagram Graph API on the creator's own account. It is deliberately separate from the instagrapi sidecar that reads other creators' channels: different transport, different credentials, different error hierarchy, so the real account never touches the private API.

## Data it holds
- `planned_posts` (shared with mine), in `src/server/db/schema.ts`. Publish owns the columns `video_asset_id`, `cover_asset_id`, `published_media_id` (Instagram's media id of the published reel), `caption`, `scheduled_at`, `idempotency_key`, `attempt_count`, `last_error`, `error_class`, `published_at`, `dry_run`, and the `publishing` and `failed` values of `state`.
- `media_assets` holds the uploaded mp4 through `video_asset_id` and its cover png through `cover_asset_id` (nullable references; the table belongs to the media store).
- `gate_drafts` rows with tool `publish_reel` (owned by [mcp](mcp.md)): the approval a publish needs. Input `{ postId, at, videoAssetId, caption, coverAssetId, keyword }`, where `at` is `now` or a local `YYYY-MM-DDTHH:mm`.
- Unique index `planned_posts_idempotency_key` on `idempotency_key` (`postId:scheduledAt`).
- Environment only, no settings screen: `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`, optional `S3_REGION`, `PUBLISH_DRY_RUN`, `PUBLISH_SCHEDULER_INTERVAL_MS`.

## Boundaries
- Owns: the Gate 2 publish drafts and their checks (`src/server/services/gate2-drafts.ts`), the lifecycle on `planned_posts` (`draft`, `scheduled`, `publishing`, `published`, `failed`; `missed` is derived on read and never stored), `src/server/services/publish-post.ts`, `src/server/services/publish-scheduler.ts`, `src/server/publish/storage-provider.ts`, the Reels container and publish calls in `src/server/graph/client.ts`, and the six lifecycle actions in `src/server/actions/planned-post-actions.ts`.
- Called by: the Gate 2 bridge calls `getPublishChecks`, `draftPublish`, `approveGateDraft` and `rejectGateDraft`; `startJobs` in `src/server/start.ts`, which starts the scheduler once (from headless `server.ts`, or in the app only when `LEAD_STUDIO_PUBLISH_JOBS=1`); `crowsnest_plans` reads the new states read-only.
- Calls: the Instagram Graph API (create Reel container, poll, publish); an S3-compatible bucket (Cloudflare R2 by default) for a public URL; the content-addressed media store (`getAssetStore().put`) for uploads.
- Does not own: plan creation, reconciliation (mine), the Graph client's read-only Insights calls, or the instagrapi sidecar. There is no instagrapi fallback.

## Invariants
- Nothing publishes without Kai's approval. `publishPlannedPost` first looks for an `approved` `publish_reel` draft whose `postId`, `videoAssetId`, `caption` and `coverAssetId` all equal the row's; with none it writes `failed` with `errorClass` `not_approved` and uploads nothing. This covers the scheduler, `publishNowAction` and headless `server.ts` alike. A video, caption or cover changed after approval needs a new draft.
- A draft runs five checks (`publishChecks`): video, caption, keyword, time and cover. A missing keyword, or a keyword not on caption line 1, is a warning; every other missing check refuses the draft (`PUBLISH_CHECKS_FAILED`). One pending publish draft per reel (`DRAFT_EXISTS`); an armed, publishing or published reel takes none (`PLAN_LOCKED`).
- Approve marks the draft `approved` with `decided_by` and `decided_at` before it runs, because publish reads that row. It then re-checks the reel against the draft (`DRAFT_STALE` when the video, caption or cover changed) and calls `publishNowAction` for `now` or `schedulePublishAction` for a time. A refusal or failure puts the draft back to `pending` with `last_error`. Each decision is journaled at gate `gate2` with the draft id: `pending` then `ok`, `error` or `rejected`.
- The cover is the cook's `<name>-cover.png` beside `<name>.mp4`: `attachPlanVideo` stores it as `cover_asset_id`, or clears it when the video has none. Publish uploads it next to the video and passes its public URL as `cover_url`; both objects are deleted after the attempt.
- No double publish, and only an armed due row publishes. The scheduler claims a row with one `UPDATE ... SET state='publishing' WHERE id=? AND state='scheduled' AND scheduledAt IS NOT NULL AND scheduledAt <= now`; zero rows changed means skip, so a row cancelled or moved to a later day after the batch select is never claimed. `publishNowAction` claims with the same shape over `draft`, `scheduled`, `failed`. No lock table (`publish-scheduler.ts`, `planned-post-actions.ts`).
- `publishPlannedPost(id, { claimed })` acts on a `publishing` row only when `claimed` is true, and is idempotent on rows already `published` or `failed` (`publish-post.ts`).
- Crash recovery. Each tick reaps `publishing` rows whose `updatedAt` is older than `PUBLISHING_STALE_MS` (20 minutes) with a guarded re-claim. `publishPlannedPost` heartbeats `updatedAt` between steps and on every container poll attempt (30 attempts, 2 seconds apart), so a live publish is never reaped. The object upload itself has no internal heartbeat, so one pathologically slow upload could still be reclaimed.
- Retry is scheduler policy only. A `failed` row under `DEFAULT_MAX_ATTEMPTS` (3) is re-armed to `scheduled` after a backoff of 1, 5, then 15 minutes (`defaultBackoffMs`). At the cap it stays `failed` until a human retries it. Only `RETRYABLE_ERROR_CLASSES` (`rate_limit`, `timeout`, `storage`, `unknown`) are re-armed; `no_video`, `no_bucket`, `auth`, `container`, and `invalid_request` stay `failed` at once.
- Every failure writes a stable `errorClass` (`not_approved`, `no_video`, `no_bucket`, `storage`, `auth`, `container`, `timeout`, `rate_limit`, `invalid_request`, `unknown`) plus a human-readable `lastError`. The mapping lives in `src/server/graph/client.ts` and `errors.ts`.
- Dry run runs upload, container creation, and polling for real and skips only the final publish call. The row is written `published` with `dryRun` set. It defaults on when `PUBLISH_DRY_RUN` is unset and `NODE_ENV` is not production (`envDefaultsDryRun` in `publish-post.ts`).
- The uploaded bucket object is deleted in a `finally` for success, dry run, and failure. A delete failure is logged and never flips the result.
- The bucket upload streams the file (sha256 by stream, then a PUT piped over `node:http(s)`), never through `fetch`, so a large reel is never buffered whole (`storage-provider.ts`).
- Preconditions are checked in order before any row changes: plan exists, schedule time valid and in the future, video attached, caption written, bucket configured, Graph configured. Each refusal has its own code (`PLAN_NO_VIDEO`, `PLAN_NO_CAPTION`, `PLAN_NO_BUCKET`, `PLAN_NO_GRAPH`, and so on). Not-configured is a refusal, never faked as success.
- Uploads are mp4 only, non-empty, at most 200 MB, with an `ftyp` box at offset 4 (`checkVideoFile` in `src/server/media/video-file.ts`). The upload action and the MCP `crowsnest_attach_video` tool both attach through `attachPlanVideo` there, which refuses a `publishing` or `published` plan with `PLAN_LOCKED`; the stored video of such a plan cannot be replaced. The upload action checks size, emptiness, and that the plan exists and takes a video before it writes the upload to a temp file. The same bytes on two plans share one `media_assets` row (sha256 dedupe in `asset-store.ts`). Captions are trimmed and capped at 2200 characters (`planned-post-actions.ts`).
- `schedulePublishAction` keeps `plannedDate` and `plannedTime` in sync with `scheduledAt`, both on the local wall clock, so a 06:00 post under UTC+7 keeps its own day. Migration `0042_gate2_publish` re-dated armed rows written with the UTC day.
- The SigV4 signing in `storage-provider.ts` is hand-rolled (no AWS SDK dependency); a wrong signature is a silent 403, so the file is tested in `storage-provider.test.ts`.
- The scheduler starts only through `startJobs` (`src/server/start.ts`), guarded so a start failure never stops the other jobs, and never runs under tests or the CLI. Ticks run every 30 seconds, at most 10 due rows per tick, behind a reentrancy guard.

## Where to look
- `src/server/services/publish-scheduler.ts` (tick, claim, reap, backoff)
- `src/server/services/publish-post.ts` (one publish attempt, heartbeat, dry run)
- `src/server/publish/storage-provider.ts`
- `src/server/graph/client.ts` (`createReelContainer`, `pollReelContainer`, `publishReel`)
- `src/server/actions/planned-post-actions.ts` (six lifecycle actions)
- `src/server/services/gate2-drafts.ts` (checks, drafts, approve and reject)
- `src/server/start.ts`
