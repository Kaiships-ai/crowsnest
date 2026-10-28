# Instagram sync

Instagram sync fills the feed. A localhost-only Python sidecar (`services/ig/`, built on `instagrapi`) holds one authenticated Instagram session. The Next.js app calls it over HTTP to fetch each tracked channel's profile and posts from the last 30 days, then stores the metadata and thumbnails in its own database and media folder. It serves the operator who tracks other creators' accounts, and it is the only writer of the `videos` table.

The sidecar exists because only `instagrapi` (Instagram's private mobile API) can list an arbitrary creator's media. It is against Instagram's Terms of Service and the logged-in burner account can be rate limited, challenged, or banned. A long-lived process is the only shape where one warm session, request pacing, and session recovery are real code paths.

## Data it holds

Tables are defined in `src/server/db/schema.ts`.

- `channels`: tracked handles. Sync state lives here: the resume cursor (`syncCursor`, `syncBoundary`, `syncCursorAt`, `syncCursorRunId`), `lastFullSyncAt`, `lastSuccessfulSyncAt`, `syncError`, and `accountId` for multi-account assignment.
- `videos`, `video_children`: one row per post, carousel slides as child rows. Soft delete via `deletedAt`.
- `video_snapshots`, `channel_snapshots`: one metrics row per post and per channel for each sync.
- `media_assets`: content-addressed downloads (thumbnails, avatars, video), unique on `sha256`.
- `sync_jobs`: one row per run (status, counts, gaps, `cancelRequested`, heartbeat). It doubles as the lock and the progress channel.
- `ig_accounts`: burner accounts with cooldown, proxy, and device seed. Operational detail is in the multi-account doc.
- Settings (`app_settings`, DB over env over default): `syncConcurrency`, `syncMetricsFreshnessHours`, `viewCountEnrichPerChannel`, `syncCadenceMinutes`. Env defaults live in `src/server/config.ts` (`LOOKBACK_DAYS` 30, `MAX_ITEMS_PER_SYNC` 200, `SYNC_CONCURRENCY` 1, `SYNC_METRICS_FRESHNESS_HOURS` 12, `SYNC_MAX_RETRIES` 3).
- Sidecar env (`.env.local`, read only by the sidecar): `IG_USERNAME`, `IG_PASSWORD`, `IG_SERVICE_TOKEN`. The app never sees the burner password.

## Boundaries

- Owns: `services/ig/crowsnest_ig/` (FastAPI app, `SessionManager`, mapping, media download, rate limit, typed errors), `src/server/ig/` (HTTP client, error taxonomy, asset download), `src/server/services/sync-engine.ts`, `sync-batch.ts`, `sync-scheduler.ts`, `src/server/actions/sync-actions.ts`, `src/server/services/accounts.ts`.
- Called by: the channels board, channel detail, and Settings (via `startSyncAction`), the in-process scheduler started from `server.ts`, and the `crowsnest_sync_*` MCP tools. Feed, analyze, remix, vault, and planned posts only read what a sync wrote and never call the sidecar.
- Calls: the sidecar at `IG_SERVICE_URL` (default `http://127.0.0.1:8765`) with the `X-IG-Token` header; Instagram only through the sidecar; launchd keeps the sidecar alive (see [kit](kit.md)).
- Does not own: single-reel import by URL (`importReelByUrl`, yt-dlp, a feed path), the user's own channel metrics (Graph API), or the outlier ranking (it writes the counts that `recomputeChannelScores` scores).

## Invariants

- One session, one lock. Every real Instagram call is serialized behind the process-global lock in `crowsnest_ig/session.py`, so `syncConcurrency` only overlaps a channel's local work (thumbnails, DB writes, scoring) with the next channel's fetch. It never produces concurrent Instagram traffic.
- The sidecar binds loopback only, compares `X-IG-Token` in constant time, and refuses to boot on a bad or missing required value (exit 78). `IG_USERNAME` and `IG_PASSWORD` must be set together (`crowsnest_ig/config.py`). The session file is mode 0600.
- A failure is never an empty result. Sidecar and client return a typed `IG_*` error (`src/server/ig/errors.ts`). `classifyIgError` maps it to `transient`, `auth`, `challenge`, or `fatal`, and only `transient` is retried.
- An expired session is `IG_AUTH_REQUIRED` (401), never `IG_NETWORK`. The sidecar maps `LoginRequired`, `ClientUnauthorizedError`, and a bare `ClientError` whose message carries `login_required` to it (`classify` in `crowsnest_ig/errors.py`). On the Node side a 401 keeps the code in its error envelope; only a 401 whose code the client does not know (the sidecar's own `IG_UNAUTHORIZED` token guard, or no envelope) becomes `IG_SERVICE_UNAUTHORIZED` (`request` in `src/server/ig/client.ts`).
- The launcher passes the saved `IG_SESSIONID` to the sidecar (`src/server/sidecar/control.ts`). At boot a sidecar with no live session adopts it on a background thread, so `/health` answers meanwhile; a refused id is logged as `session.boot_adopt_failed`.
- A missing required payload field raises `IG_DRIFT`; unknown fields are ignored. `instagrapi` is pinned (`services/ig/pyproject.toml`).
- Zero means not disclosed. Instagram returns `play_count: 0` for other creators' reels, so `src/server/ig/client.ts` maps zero to null and a zero never overwrites a stored count. Real counts come from the optional `/media-stats` enrichment pass, which runs before scoring.
- One run per scope, settled by the database. `sync_jobs_lock_running` is a partial unique index on `lock_key` where `status = 'running'`; the key is a channel id, `__library__`, or `__backfill__`. An `IMMEDIATE` transaction takes the lock, and a run with no heartbeat is reaped to `failed` with `SYNC_ABANDONED` (`reapStaleLocks`).
- The lookback window is a date, not a count. `MAX_ITEMS_PER_SYNC` is only a cap. The walk stops after 3 consecutive out-of-window items and a pinned item never counts toward that streak (`crowsnest_ig/mapping.py`, `apply_lookback`).
- A repeat sync stops with `upToDate` at the first page with no new posts, but only while `lastFullSyncAt` is within `syncMetricsFreshnessHours`, and never on a resumed run.
- Soft delete only after a full enumeration. A post is marked deleted only when the run stopped on `lookback` or `exhausted`, saw at least one item, and was not resumed from a cursor. The `upToDate` stop never soft deletes.
- A channel's numbers move only from a complete pull. The walk fetches the profile and every media page before it writes or downloads anything: the avatar and missing thumbnails download inside the store, after the pull is known complete; `storeChannelPull` takes a `CompletePull` (`src/server/lib/pull-result.ts`), so a partial pull cannot reach it. A walk cut after a page landed (a call failing, or a cancel) stores nothing, and its gap carries `partial: true` and `missing`.
- Resume cursor on `channels`, not a new table. Only a cap persists where the crawl stopped: a cancel or channel error stores nothing, so there is nothing to resume below. A cursor older than the lookback window is ignored. A cap on the very first page falls back to that page's own next-page cursor so the next run advances.
- Failure isolation: a dead thumbnail costs one asset, a bad post one item, and only a profile or media call failure fails the channel (recorded as a gap). A channel's `video_snapshots` go in one batched insert and fall back to row-by-row if it throws (`sync-batch.ts`).
- Cancel is cooperative: `cancelRequested` is read at the next page or channel boundary, so the lock is never orphaned. Channels already finished stay; the channel whose walk was cut stores nothing.
- `lastSuccessfulSyncAt` is the only trusted completion time. `lastSyncedAt` is written with the profile, once the pull is complete. A scheduled sweep (`skipFreshWithinMinutes`) never skips a channel that has never synced cleanly.
- Automatic sync is one in-process interval (`sync-scheduler.ts`), gated on the newest `sync_jobs` row and `syncCadenceMinutes` (0 disables). A manual sync also defers the next scheduled one.
- Only thumbnails download during a sync. Video downloads on first play through a fresh `/resolve-media`, because CDN URLs expire in hours, unless `EAGER_VIDEO_DOWNLOAD` is set.
- Multi-account is sequential across accounts. `planAccountSync` groups channels by account and skips a paused or cooling-down one without stopping the rest. Live parallel traffic across accounts is not built.

## Where to look

- `services/ig/crowsnest_ig/app.py` and `session.py`: sidecar routes and session lifecycle. `services/ig/README.md` holds the endpoint contracts and error table.
- `src/server/services/sync-engine.ts` (`runSync`, `addChannel`, `recomputeChannelScores`): the sync.
- `src/server/ig/client.ts` and `errors.ts`: wire mapping and error classes.
- `src/server/actions/sync-actions.ts`: start, progress, cancel, backfill.
- `src/server/services/sync-scheduler.ts` and `accounts.ts`: scheduling and accounts.
- `scripts/bench-sync-concurrency.ts`: deterministic benchmark against a stub sidecar.
