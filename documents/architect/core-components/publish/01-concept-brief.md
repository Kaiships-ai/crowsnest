# publish: concept brief

`documents/architect/core-components/publish/`

Status: shipped. The instagrapi fallback path is a seam only, off by default and unbuilt; launchd hardening for the scheduler is not built; each is tracked in the backlog.

## 1. What it is

publish is the schedule-and-auto-publish machinery behind a planned post on `/mine`: attach an mp4, write a caption, pick a schedule time, and either let an in-process scheduler publish it to the creator's real own Instagram channel at that time, or publish it immediately. It extends the same `planned_posts` row the [mine](../mine/01-concept-brief.md) calendar already owns, widening its `state` column with two in-flight values, `publishing` and `failed`, on top of the `draft` / `scheduled` / `published` states mine already had.

The publish path is the official Instagram Graph API against the creator's own account, the same credentials `.env.local`'s `IG_GRAPH_TOKEN` / `IG_GRAPH_USER_ID` already provide for mine's read-only Insights. It is deliberately not the instagrapi sidecar that reads other creators' channels for the feed: that sidecar drives a throwaway burner account's private-API session and this path posts to the creator's real one, so the two are kept on separate transports, separate credentials, and separate error hierarchies on purpose.

## 2. Why it exists

Planning a post on `/mine` used to end at a title, a date, and an optional script, an intention with no mechanism. publish is the mechanism: it turns a scheduled plan into an actual Reel on the creator's own channel, without the creator opening Instagram, without a second tool, and without touching the burner account the rest of crowsnest studies competitors through.

The design is built around one honesty rule: nothing here ever fakes a publish. If the storage bucket or the Graph token is not configured, the schedule surface still saves the video and caption but names exactly what is missing and refuses to offer Schedule or Publish now. Outside production, a publish runs the whole real path (upload, Reel container creation, polling) but skips only the final publish call, so the flow can be rehearsed and evidenced without ever touching the live account by accident.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Publish lifecycle | The five real states a planned post's `state` column can hold once it carries a video: `draft`, `scheduled`, `publishing`, `published`, `failed`. `missed` stays a sixth, derived-only state, computed on read exactly as mine already computes it; it is never stored and a stored `publishing`/`failed` row is never re-derived into it. |
| The atomic claim | The scheduler's whole no-double-publish guarantee: a single `UPDATE planned_posts SET state='publishing' WHERE id=? AND state='scheduled'`. A result of zero rows changed means another tick, or `publishNowAction`, already claimed that row; the caller simply skips it rather than locking anything. |
| Claimed flag | `publishPlannedPost(id, { claimed })` only acts on a row already sitting in `publishing` when `claimed` is true. A caller that just won the atomic claim above passes `claimed: true`; anything else that finds a row already `publishing` (a stale row from a process that died mid-publish) no-ops instead of risking a second post to Instagram. |
| Public-URL storage provider | The Graph API publishes a Reel by fetching it from a public https URL, not a binary upload. `getStorageProvider()` returns an `S3StorageProvider` (Cloudflare R2 or AWS S3, hand-rolled SigV4 presigned PUT/DELETE, no AWS SDK dependency) when all five `S3_*` variables are set, or `null` when any is missing. The uploaded object is deleted again once the Graph container has consumed its URL, whether the publish succeeded, failed, or was a dry run. |
| Dry run | `PUBLISH_DRY_RUN` defaults on outside `NODE_ENV=production`. A dry-run publish runs the entire real path, upload, container creation, and polling, and stops just short of the final publish call; the row is written `published` with `dryRun: true` rather than left hanging, so a rehearsed run and a real one leave the same shape of evidence. |
| Backoff retry | A `failed` row under `DEFAULT_MAX_ATTEMPTS` (3) is re-armed to `scheduled` at a backed-off `scheduledAt` by the scheduler's own tick: 1 minute after the first failure, 5 after the second, 15 after the third and every attempt after that. A row at or above the cap stays `failed`, a terminal state a human resolves with Retry. |
| Error class | Every failure writes a stable `errorClass` (`no_video`, `no_bucket`, `storage`, plus the Graph client's own `auth` / `container` / `timeout` / `rate_limit` / `invalid_request` / `unknown`) alongside a human-readable `lastError`, never a bare exception message the UI would have to parse. `invalid_request` is a non-transient 4xx Instagram rejected outright (code 100, a bad `video_url` or caption); like `auth` and `container` it is never retried automatically. A 4xx Meta marks `is_transient: true`, or code 1, 2, or 9007 (media not ready), is `unknown`, and a throttle (code 4, 17, 32, 613, or 80000 to 80014, even as HTTP 400) is `rate_limit`; both are retried. |

## 4. How it fits in the system

publish does not have its own route. It lives on the Dashboard's Calendar tab (`/?tab=calendar`): the calendar's day panel and the publish dialog are new UI on top of the existing planner, and every write goes through `planned_posts`, the same table mine already owned. `CalendarTab` (`src/components/mine/calendar-tab.tsx`) computes whether the bucket and the Graph token are configured once per page load and passes both flags, plus the resolved dry-run flag, down into `MineCalendar`.

An in-process scheduler, booted once in `server.ts` alongside the existing MCP HTTP wiring, ticks on an interval (default 30 seconds, `PUBLISH_SCHEDULER_INTERVAL_MS` to override) and is the only thing in crowsnest that calls Instagram's Graph publish edges on a timer rather than in response to a click. It shares the Graph client, the token, and the error hierarchy that mine's read-only Insights panel already uses; it shares nothing with the instagrapi sidecar ig-sync depends on.

## 5. Dependency map

### Upstream (what publish depends on)

| Dependency | Why |
| --- | --- |
| `planned_posts` (owned jointly with mine) | The one table this component reads and writes: `videoAssetId`, `caption`, `scheduledAt`, `idempotencyKey`, `attemptCount`, `lastError`, `errorClass`, `publishedAt`, `dryRun`, plus the widened `state` column. |
| The content-addressed media store (`src/server/media/store.ts`, `getAssetStore`) | `uploadPlanVideoAction` writes the uploaded mp4 through the same store that owns every other downloaded or generated asset; publish adds no new media infrastructure. |
| `.env.local` credentials (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`) | Read by `src/server/graph/client.ts`, the same client mine's Insights panel already uses. A missing or invalid value is exactly what `isGraphConfigured()` and the not-configured surfaces check for. |
| `.env.local` storage credentials (`S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`, optional `S3_REGION`) | Read directly by `src/server/publish/storage-provider.ts`, not through the validated config schema in `src/server/config.ts`; a missing one is what `getStorageProvider()` returning `null` checks for. |
| mine's calendar and dialog shell (`src/components/mine/mine-calendar.tsx`, `GraphConnectPanel`'s not-configured pattern) | Hosts the publish dialog and the lifecycle states on the calendar cell and the day detail panel; publish adds the dialog and confirm flows, not the page frame. |

### Downstream (what depends on publish)

| Consumer | What it reads |
| --- | --- |
| mine's calendar cell and day panel | The widened `PlannedPostState`, `attemptCount`, `errorClass`, `lastError`, and `dryRun` fields, to render scheduled/publishing/failed/published states without owning any of the writes itself. |
| crowsnest_plans (an external MCP-facing read) | The new publish state values pass through read-only; nothing on that side triggers a publish. |

### External

| Dependency | Role |
| --- | --- |
| Instagram Graph API | Creates a Reel media container against a public video URL, polls it to `FINISHED`, then publishes it, through `src/server/graph/client.ts`. The same official, token-authenticated transport mine's Insights already uses, entirely separate from the instagrapi sidecar. |
| An S3-compatible bucket (Cloudflare R2 by default, or AWS S3) | Stages the mp4 at a public URL the Graph API can fetch from, then is deleted from immediately after. No other part of crowsnest writes to this bucket. |

## 6. Boundaries

publish owns the publish lifecycle on `planned_posts` (the columns beyond title/note/date/script that mine already owned), the storage provider seam, the Graph container/publish calls, the in-process scheduler, the six lifecycle actions (`uploadPlanVideoAction`, `setPlanCaptionAction`, `schedulePublishAction`, `cancelScheduledPublishAction`, `publishNowAction`, `retryFailedPublishAction`), and the publish dialog plus the shared `ConfirmDialog`. It does not own the calendar grid, the day detail panel's non-publish fields, the plan-creation dialog, or the reconciliation prompt; those stay [mine](../mine/01-concept-brief.md)'s, and publish only adds new rendering branches inside them for the lifecycle states. It does not own the Instagram Graph client itself (`src/server/graph/client.ts` and `graph-actions.ts` are shared with mine's read-only Insights panel, extended here with the container/publish edges); it does not own the instagrapi sidecar or any tracked-channel table ig-sync writes. There is no fallback to the instagrapi burner-account path yet; the plan that shipped this component named it explicitly out of Round 0 scope, tracked in the GitHub backlog (label `backlog`).
