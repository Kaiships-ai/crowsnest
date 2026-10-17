# Publish

Publish is the schedule-and-auto-publish machinery behind a planned post on the dashboard Calendar tab (`/?tab=calendar`). The creator attaches an mp4, writes a caption, and either picks a time for an in-process scheduler to post it to their own Instagram channel, or publishes at once. It extends the `planned_posts` row that the mine calendar already owns; it adds no route of its own.

The publish path is the official Instagram Graph API on the creator's own account. It is deliberately separate from the instagrapi sidecar that reads other creators' channels: different transport, different credentials, different error hierarchy, so the real account never touches the private API.

## Data it holds
- `planned_posts` (shared with mine), in `src/server/db/schema.ts`. Publish owns the columns `video_asset_id`, `caption`, `scheduled_at`, `idempotency_key`, `attempt_count`, `last_error`, `error_class`, `published_at`, `dry_run`, and the `publishing` and `failed` values of `state`.
- `media_assets` holds the uploaded mp4 through `video_asset_id` (nullable reference; the table belongs to the media store).
- Unique index `planned_posts_idempotency_key` on `idempotency_key` (`postId:scheduledAt`).
- Environment only, no settings screen: `IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`, optional `S3_REGION`, `PUBLISH_DRY_RUN`, `PUBLISH_SCHEDULER_INTERVAL_MS`.

## Boundaries
- Owns: the lifecycle on `planned_posts` (`draft`, `scheduled`, `publishing`, `published`, `failed`; `missed` is derived on read and never stored), `src/server/services/publish-post.ts`, `src/server/services/publish-scheduler.ts`, `src/server/publish/storage-provider.ts`, the Reels container and publish calls in `src/server/graph/client.ts`, the six lifecycle actions in `src/server/actions/planned-post-actions.ts`, `src/components/mine/publish-dialog.tsx`, and `src/components/mine/confirm-dialog.tsx`.
- Called by: the calendar day panel and publish dialog (`src/components/mine/mine-calendar.tsx`, `calendar-tab.tsx`); `server.ts`, which starts the scheduler once; `crowsnest_plans` reads the new states read-only.
- Calls: the Instagram Graph API (create Reel container, poll, publish); an S3-compatible bucket (Cloudflare R2 by default) for a public URL; the content-addressed media store (`getAssetStore().put`) for uploads.
- Does not own: the calendar grid, plan creation, reconciliation (mine), the Graph client's read-only Insights calls, or the instagrapi sidecar. There is no instagrapi fallback.

## Invariants
- No double publish. The scheduler claims a row with one `UPDATE ... SET state='publishing' WHERE id=? AND state='scheduled'`; zero rows changed means skip. `publishNowAction` claims with the same shape over `draft`, `scheduled`, `failed`. No lock table (`publish-scheduler.ts`, `planned-post-actions.ts`).
- `publishPlannedPost(id, { claimed })` acts on a `publishing` row only when `claimed` is true, and is idempotent on rows already `published` or `failed` (`publish-post.ts`).
- Crash recovery. Each tick reaps `publishing` rows whose `updatedAt` is older than `PUBLISHING_STALE_MS` (20 minutes) with a guarded re-claim. `publishPlannedPost` heartbeats `updatedAt` between steps and on every container poll attempt (30 attempts, 2 seconds apart), so a live publish is never reaped. The object upload itself has no internal heartbeat, so one pathologically slow upload could still be reclaimed.
- Retry is scheduler policy only. A `failed` row under `DEFAULT_MAX_ATTEMPTS` (3) is re-armed to `scheduled` after a backoff of 1, 5, then 15 minutes (`defaultBackoffMs`). At the cap it stays `failed` until a human clicks Retry. Only `RETRYABLE_ERROR_CLASSES` (`rate_limit`, `timeout`, `storage`, `unknown`) are re-armed; `no_video`, `no_bucket`, `auth`, `container`, and `invalid_request` stay `failed` at once.
- Every failure writes a stable `errorClass` (`no_video`, `no_bucket`, `storage`, `auth`, `container`, `timeout`, `rate_limit`, `invalid_request`, `unknown`) plus a human-readable `lastError`. The mapping lives in `src/server/graph/client.ts` and `errors.ts`.
- Dry run runs upload, container creation, and polling for real and skips only the final publish call. The row is written `published` with `dryRun` set. It defaults on when `PUBLISH_DRY_RUN` is unset and `NODE_ENV` is not production (`envDefaultsDryRun` in `publish-post.ts`; `CalendarTab` shows the same decision in the dialog banner).
- The uploaded bucket object is deleted in a `finally` for success, dry run, and failure. A delete failure is logged and never flips the result.
- The bucket upload streams the file (sha256 by stream, then a PUT piped over `node:http(s)`), never through `fetch`: Next's dev fetch patch hex-encodes a whole request body into a cache key and ran the server out of heap on a 76 MB reel (`storage-provider.ts`).
- Preconditions are checked in order before any row changes: plan exists, schedule time valid and in the future, video attached, caption written, bucket configured, Graph configured. Each refusal has its own code (`PLAN_NO_VIDEO`, `PLAN_NO_CAPTION`, `PLAN_NO_BUCKET`, `PLAN_NO_GRAPH`, and so on). Not-configured is shown and disabled, never faked as success.
- Uploads are mp4 only, non-empty, at most 200 MB; captions are trimmed and capped at 2200 characters (`planned-post-actions.ts`).
- `schedulePublishAction` keeps `plannedDate` and `plannedTime` in sync with `scheduledAt` so the plan still renders in the month grid.
- The SigV4 signing in `storage-provider.ts` is hand-rolled (no AWS SDK dependency); a wrong signature is a silent 403, so the file is tested in `storage-provider.test.ts`.
- The scheduler starts only from `server.ts`, guarded so a start failure never stops the HTTP server, and never runs under tests or the CLI. Ticks run every 30 seconds, at most 10 due rows per tick, behind a reentrancy guard.
- Known duplicate: `MAX_PUBLISH_ATTEMPTS` in `mine-calendar.tsx` repeats `DEFAULT_MAX_ATTEMPTS` and can drift.

## Where to look
- `src/server/services/publish-scheduler.ts` (tick, claim, reap, backoff)
- `src/server/services/publish-post.ts` (one publish attempt, heartbeat, dry run)
- `src/server/publish/storage-provider.ts`
- `src/server/graph/client.ts` (`createReelContainer`, `pollReelContainer`, `publishReel`)
- `src/server/actions/planned-post-actions.ts` (six lifecycle actions)
- `src/components/mine/publish-dialog.tsx`, `mine-calendar.tsx`
