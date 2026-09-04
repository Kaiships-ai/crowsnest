# ig-sync: architecture

`documents/architect/core-components/ig-sync/`

Status: shipped and in daily use, blocked for buyer installs by an onboarding bug that writes an empty `IG_PASSWORD`.

## 1. Module structure

### The Python sidecar (`services/ig/`)

| File | Export | Role |
| --- | --- | --- |
| `crowsnest_ig/app.py` | FastAPI app: `/health`, `/login`, `/challenge/resolve`, `/two-factor`, `/login-by-session`, `/logout`, `/profile`, `/medias`, `/resolve-media`, `/media-stats`, `/download` | The HTTP surface. `require_token` guards every route but `/health` with a constant time compare of `X-IG-Token`; every failure renders as `{"error": {...}}`, never a silently empty result. |
| `crowsnest_ig/config.py` | `Config`, `load_env_file` | Loads and validates the environment once at import. `load_env_file` parses `.env.local` in Python, never by sourcing a shell script, because a real password can contain a quote, `$`, or a backtick. Refuses to start on a bad or missing required value. |
| `crowsnest_ig/session.py` | `SessionManager` | The one long lived, authenticated `instagrapi` client behind a re entrant lock, with login, challenge, and two factor brokering plus one shot session recovery. |
| `crowsnest_ig/mapping.py` | `apply_lookback`, `children_from_media` | DTO mapping, the 3 consecutive lookback boundary, and carousel child extraction. |
| `crowsnest_ig/media.py` | download helpers | Content addressed download into `MEDIA_ROOT`. |
| `crowsnest_ig/ratelimit.py` | backoff and cooldown helpers | Backoff pacing and a cooldown deadline persisted next to the session file. |
| `crowsnest_ig/errors.py` | `IgError` and the `IG_*` taxonomy | Maps instagrapi exceptions onto crowsnest's typed error codes. |
| `crowsnest_ig/device.py` | device pinning | Keeps one stable device profile per session, so the client does not look like a different device on every call. |
| `crowsnest_ig/logging.py` | redacting structured logger | Structured logs with secrets redacted before they are written. |
| `README.md` | (docs) | The operator's reference: the ToS and ban warning, the env schema, the endpoint contracts, and the error code table. |

### The Node side that talks to it (`src/server/`)

| File | Export | Role |
| --- | --- | --- |
| `ig/client.ts` | `igClient`, `mapMedia`, `mapProfile`, `IgProfile`, `IgMedia`, `IgMediasPage`, `IgHealth` | The HTTP client for the sidecar. Every call has a timeout (`AbortSignal.timeout`); a failure is a typed `IgError`, never `[]`. The wire mappers are the boundary where snake_case JSON becomes the TypeScript shape and a missing required field becomes a loud `IG_DRIFT`. `mapHealth` is an internal helper, not exported. |
| `ig/errors.ts` | `IgError`, `IG_ERROR_CODES`, `fromEnvelope`, `SyncAlreadyRunningError`, `classifyIgError`, `IgErrorClass` | The error envelope decoder, the typed error taxonomy, and the `transient`/`auth`/`challenge`/`fatal` classification that the sync engine's retry logic and the run-detail UI both read. |
| `ig/assets.ts` | `ensureAsset`, `tryEnsureAsset` | Downloads a thumbnail, avatar, or video into the app's own media store, content addressed by sha256. |
| `services/sync-engine.ts` | `runSync`, `addChannel`, `requestCancel`, `recomputeChannelScores`, `normalizeHandle` | The sync itself: locking, a bounded worker pool over channels, per channel page walk with cursor resume, upsert, carousel children, soft delete, the view count enrichment pass, and outlier rescoring. |
| `services/sync-batch.ts` | `insertVideoSnapshots`, `VideoSnapshotInsert` | Batches a page's `video_snapshots` rows into one multi-row insert. `runSync` falls back to inserting the page one row at a time when the batch throws, so a single poison row costs one item, not the whole page. |
| `actions/sync-actions.ts` | `startSyncAction`, `startViewCountBackfillAction`, `getSyncProgressAction`, `getChannelSyncProgressAction`, `cancelSyncAction`, `addChannelAction`, `getLatestSyncJob` | The thin `"use server"` wrappers the UI calls. |
| `queries/runs.ts` | `getLastRunHealth`, `LastRunHealth` | The most recent sync run's health (status, timings, counts, gaps, whether it is stalled), excluding backfill rows; returns honest nulls when the database has never synced. Feeds the dashboard and the planned `crowsnest_metrics` MCP tool; has no page consumer yet. |
| `config.ts` | `IG_SERVICE_URL`, `LOOKBACK_DAYS`, `MAX_ITEMS_PER_SYNC`, `SYNC_CONCURRENCY`, `SYNC_MAX_RETRIES`, `SYNC_RETRY_BASE_MS`, `EAGER_VIDEO_DOWNLOAD` | The Node side env defaults: `IG_SERVICE_URL` (`http://127.0.0.1:8765`), `LOOKBACK_DAYS` (30), `MAX_ITEMS_PER_SYNC` (200), `SYNC_CONCURRENCY` (2, clamped 1 to 16, DB-overridable through the `syncConcurrency` setting), `SYNC_MAX_RETRIES` (3), `SYNC_RETRY_BASE_MS` (1000), `EAGER_VIDEO_DOWNLOAD` (false). |
| `../cli/service-darwin.ts` | LaunchAgent management | Keeps the sidecar (and the Next server) alive across a reboot; `scripts/ig-service.sh` is the wrapper that loads `.env.local` and execs the module. |

`importReelByUrl` (also in `sync-engine.ts`) and its `importReelAction` wrapper fetch a single reel through the yt-dlp provider (`src/server/providers/ytdlp.ts`), not through this sidecar. It writes into the same `videos` table with the same upsert shape, but it is a feed owned import path, not an ig-sync feature; see [feed](../feed/01-concept-brief.md).

## 2. ER diagram

```mermaid
erDiagram
    CHANNELS ||--o{ VIDEOS : "channel_id"
    CHANNELS |o--o{ SYNC_JOBS : "channel_id"
    CHANNELS ||--o{ CHANNEL_SNAPSHOTS : "channel_id"
    MEDIA_ASSETS |o--o{ CHANNELS : "avatar_asset_id"
    MEDIA_ASSETS |o--o{ VIDEOS : "thumbnail_asset_id"
    MEDIA_ASSETS |o--o{ VIDEOS : "video_asset_id"
    MEDIA_ASSETS |o--o{ VIDEO_CHILDREN : "thumbnail_asset_id"
    MEDIA_ASSETS |o--o{ VIDEO_CHILDREN : "video_asset_id"
    VIDEOS ||--o{ VIDEO_CHILDREN : "video_id"
    VIDEOS ||--o{ VIDEO_SNAPSHOTS : "video_id"

    CHANNELS {
        string id PK
        string platform UK "composite with handle"
        string handle UK "composite with platform"
        string avatar_asset_id FK
        boolean is_own UK "partial, unique where is_own = true"
        string sync_error
        string sync_cursor "resume cursor for an interrupted deep crawl"
        string sync_cursor_run_id
        string deleted_at
    }
    VIDEOS {
        string id PK
        string channel_id FK
        string platform UK "composite with external_id"
        string external_id UK "composite with platform"
        string thumbnail_asset_id FK
        string video_asset_id FK
        integer view_count
        real outlier_score
        string deleted_at
    }
    VIDEO_CHILDREN {
        string id PK
        string video_id FK, UK "composite with position, and with external_id"
        integer position UK "composite with video_id"
        string external_id UK "composite with video_id"
        string thumbnail_asset_id FK
        string video_asset_id FK
    }
    MEDIA_ASSETS {
        string id PK
        string sha256 UK
        string kind
        string storage_path
    }
    CHANNEL_SNAPSHOTS {
        string id PK
        string channel_id FK
        string captured_at
        real median_views
    }
    VIDEO_SNAPSHOTS {
        string id PK
        string video_id FK
        string captured_at
        integer view_count
    }
    SYNC_JOBS {
        string id PK
        string channel_id FK "null means a whole library run"
        string lock_key UK "partial, unique where status = running"
        string status
        string stop_reason
    }
```

## 3. Indexes

| Table | Index | Notes |
| --- | --- | --- |
| media_assets | media_assets_sha256 | Unique on `sha256`; a re download of identical bytes collapses to one row and one file, so cache headers can be immutable. |
| channels | channels_platform_handle | Unique on `(platform, handle)`; one row per platform handle. |
| channels | channels_single_own | Partial unique on `is_own` where `is_own = true`; at most one channel can be flagged as the user's own. |
| videos | videos_platform_external | Unique on `(platform, external_id)`; the idempotent upsert key a sync writes through. |
| videos | videos_channel_posted | Plain index on `(channel_id, posted_at)`; backs a single channel's post history in date order. |
| videos | videos_outlier_score | Plain index on `outlier_score`; backs the feed's score sort. |
| videos | videos_view_count | Plain index on `view_count`; backs the feed's unscoped views sort, which has no leading `channel_id` filter. |
| videos | videos_posted_at | Plain index on `posted_at`; backs the feed's unscoped recent sort, kept separate from `videos_channel_posted` because that one only serves an `ORDER BY posted_at` when a `channel_id` equality filter is also present. |
| video_children | video_children_video_position | Unique on `(video_id, position)`; keeps a carousel's children in order and upserts idempotently by position. |
| video_children | video_children_video_external | Unique on `(video_id, external_id)`; idempotent child upsert keyed on Instagram's own child id. |
| sync_jobs | sync_jobs_lock_running | Partial unique on `lock_key` where `status = 'running'`; the single flight lock a sync run holds. `lock_key` is a channel id for a per channel run or the literal `__library__` for a whole library run, because SQLite treats NULLs as distinct in a unique index and a nullable `channel_id` would not have locked two library runs against each other. |
| sync_jobs | sync_jobs_started | Plain index on `started_at`; orders the job history. |

`channel_snapshots` and `video_snapshots` carry no indexes beyond their primary key; both are written once per sync and read by channel id or video id through the existing `videos_channel_posted`/foreign key path.

## 4. Data flow

**One session, over localhost.** The sidecar holds exactly one authenticated `instagrapi` `Client`. It is the only process in crowsnest that logs in to Instagram or ever sees an Instagram CDN URL. The Next.js app reaches it at `IG_SERVICE_URL` (default `http://127.0.0.1:8765`), sending the shared secret `IG_SERVICE_TOKEN` as an `X-IG-Token` header on every request; the sidecar binds loopback only and refuses any other host at boot. Credentials (`IG_USERNAME`, `IG_PASSWORD`) are read by the sidecar process alone from `.env.local` and are never sent to or rendered by the app.

**A sync run** (`runSync` in `sync-engine.ts`):

1. **Acquire the DB lock.** An `IMMEDIATE` SQLite transaction checks for an overlapping `running` job and inserts a `sync_jobs` row. Concurrency is settled by the database, not an in process flag: two runs may hold locks only when their channel sets are disjoint, because two runs on one channel corrupt each other's soft delete.
2. **Per channel, through a bounded worker pool** (`syncConcurrency`, default 2, env `SYNC_CONCURRENCY`, DB-overridable, clamped 1 to 16): fetch the profile (`GET /profile`), download the avatar, then page the media newest first (`GET /medias`) until the lookback boundary. The sidecar still serializes every real Instagram call behind its own process-global lock (`SessionManager` in `session.py`), so raising the pool size never produces concurrent Instagram traffic; it only overlaps one channel's local work (thumbnail download, DB writes, scoring) with the next channel's fetch. At `syncConcurrency = 1` a single worker drains the channel list in order, the same as the old sequential walk. The stop condition is a date (`LOOKBACK_DAYS`, default 30), not a count; `MAX_ITEMS_PER_SYNC` (default 200) is only a safety cap. Pinned posts appear first and out of order, so the walk stops only after 3 consecutive out of window items, and a pinned item never counts toward that streak. A channel resumes from a persisted cursor (`channels.syncCursor`/`syncBoundary`/`syncCursorAt`/`syncCursorRunId`) when a prior run left it mid-window (item cap, cancel, or a channel error) and that cursor is younger than the lookback window; otherwise the walk starts fresh from the top.
3. **Upsert each post** keyed on `(platform, external_id)`. Carousels are one `videos` row with `video_children` rows, not separate posts. Thumbnails download into the app's own media store; video is on demand on first play unless `EAGER_VIDEO_DOWNLOAD` is set. A page's `video_snapshots` rows are written in one multi-row insert (`insertVideoSnapshots`) rather than one per item; if the batch throws, the page falls back to inserting one row at a time so a single poison row costs one item, not the rest of the page.
4. **Soft delete** in window posts that did not come back this run, but only when the run actually enumerated the whole window (`stop_reason` lookback or exhausted), saw at least one item, and was not itself resumed from a cursor. A resumed run only walked the remainder below its cursor, never the posts above it, so it cannot tell which of those are gone; a run that saw zero items refuses to interpret an empty fetch as deletions.
5. **View count enrichment** (off unless `viewCountEnrichPerChannel` is greater than zero): the listing endpoint returns `play_count: 0` for other creators' reels, so the newest N `clips` are re read one at a time through `POST /media-stats` (`media_info_v1`) to get the real number.
6. **Rescore**: `recomputeChannelScores` reads `videos.view_count`, computes each post's outlier score against the channel's own baseline, and writes a `channel_snapshots` row. Auto analyze and idea generation for new top outliers run last, and never throw.
7. **Finalize** the job row, but only if this run still owns it (a reaper may have declared it dead). Status is `success`, `partial` (a survivor plus a gap, or a cancel that left work undone), or `failed` (every channel failed). A channel gap's error code is classified by `classifyIgError` into `transient`, `auth`, `challenge`, or `fatal`; only `transient` was worth retrying, and the run-detail view shows the class next to the gap.

**Asset serving.** Downloaded bytes are content addressed (`<sha256[0:2]>/<sha256>.<ext>` under `MEDIA_ROOT`), deduped, and served by the app so the browser never renders a signed Instagram URL that expires within hours. `POST /resolve-media` re resolves a single post's currently valid URLs before an on demand video download.

**Detached start.** `startSyncAction` returns the moment the lock is won (job id in hand, via `onJobStarted`) and lets the run finish under Next's `after()`, so the browser never holds a POST open for a minutes long sync. Progress and cancel both go through the `sync_jobs` row: `getSyncProgressAction` polls it, `cancelSyncAction` sets `cancel_requested`, and the engine notices co operatively at the next page or channel boundary, keeping everything already committed.

## 5. Sequence: one sync pass

```mermaid
sequenceDiagram
    actor UI as Channels board or settings
    participant Action as startSyncAction
    participant Worker as runSync
    participant Sidecar
    participant DB

    UI->>Action: startSyncAction(channelIds)
    activate Action
    Action->>Worker: runSync(channelIds, onJobStarted)
    activate Worker
    Worker->>DB: **Check for an overlapping running job** (syncJobs)<br/>params:{ lockKey }
    DB-->>Worker: Return {SyncJob} or null<br/>params:{ lockKey, status }
    alt lock already held
        Worker-->>Action: Return error that a sync is already running<br/>params:{ code: "SYNC_ALREADY_RUNNING" }
        Action-->>UI: Return error response that a sync is already running<br/>params:{ code: "SYNC_ALREADY_RUNNING" }
    end
    Worker->>DB: **Insert the running job row inside an IMMEDIATE transaction** (syncJobs)<br/>params:{ id: jobId, lockKey, status: "running" }
    DB-->>Worker: Return {SyncJob}<br/>params:{ id: jobId }
    Worker-->>Action: onJobStarted(jobId)
    Action-->>UI: Return success response that the sync started<br/>params:{ jobId }
    deactivate Action

    Worker->>DB: **Load the channels to sync** (channels)<br/>params:{ platform: "instagram", deletedAt: null }
    DB-->>Worker: Return {Channel}[]<br/>params:{ count }

    loop each channel, bounded worker pool sized by syncConcurrency
        Worker->>Sidecar: **Fetch the channel profile**<br/>params:{ handle: Channel.handle }
        Sidecar-->>Worker: Return {IgProfile}<br/>params:{ followerCount }
        Worker->>Sidecar: **Page the media, newest first, until the lookback boundary**<br/>params:{ handle: Channel.handle, since: boundary, cursor: Channel.syncCursor }
        Sidecar-->>Worker: Return {IgMedia}[]<br/>params:{ page }
        loop each media item
            Worker->>DB: **Upsert the post** (videos)<br/>params:{ platform, externalId: IgMedia.pk, channelId: Channel.id }
            DB-->>Worker: Return {Video}<br/>params:{ id }
        end
        Worker->>DB: **Record the page's metrics in one batched insert** (videoSnapshots)<br/>params:{ videoId: Video.id, viewCount, likeCount }
        DB-->>Worker: Return {VideoSnapshot}[]<br/>params:{ count }
        opt window fully enumerated
            Worker->>DB: **Soft delete in window posts not seen this run** (videos)<br/>params:{ channelId: Channel.id, deletedAt: now }
            DB-->>Worker: Return count deleted<br/>params:{ deleted }
        end
        opt view count enrichment budget set
            Worker->>Sidecar: **Re read the real view count, one call per reel**<br/>params:{ mediaId }
            Sidecar-->>Worker: Return {IgMediaStats}<br/>params:{ viewCount }
            Worker->>DB: **Update the count, a zero never overwrites a stored count** (videos)<br/>params:{ id, viewCount }
            DB-->>Worker: Return {Video}<br/>params:{ id }
        end
        Worker->>DB: **Recompute outlier scores against this channel's own baseline** (videos)<br/>params:{ channelId: Channel.id }
        DB-->>Worker: Return {Video}[]<br/>params:{ count }
        Worker->>DB: **Write this channel's snapshot** (channelSnapshots)<br/>params:{ channelId: Channel.id, medianViews }
        DB-->>Worker: Return {ChannelSnapshot}<br/>params:{ id }
        Worker->>DB: **Flush progress for pollers** (syncJobs)<br/>params:{ id: jobId, channelsDone, itemsSeen }
        DB-->>Worker: Return {SyncJob}<br/>params:{ id: jobId }
    end

    Worker->>DB: **Finalize the job, only if this run still owns the row** (syncJobs)<br/>params:{ id: jobId, status, stopReason }
    DB-->>Worker: Return {SyncJob} or null<br/>params:{ id: jobId }
    deactivate Worker
```

## 6. Key decisions

- **Python sidecar, not in process.** instagrapi is Python, and its `Client` holds the session, the pinned device profile, and the cookie jar. A process per call design would re authenticate constantly, and a storm of logins is exactly what gets an account challenged. A long lived sidecar is the only shape where one warm session, request pacing, and session recovery are real code paths. (Concept brief; `services/ig/README.md`.)
- **instagrapi despite the ToS risk.** Instagram's Basic Display API shut down 2024-12-04 and the Graph API cannot enumerate an arbitrary creator's media. instagrapi drives the private mobile API, which is against Instagram's Terms and can get the account rate limited, challenged, or banned, a disclosed trade off, which is why it is meant for a burner account. This also replaced a paid vendor (Apify) so the product depends on no third party.
- **A failure is never an empty result.** Both the sidecar and the Node client return a typed `IG_*` error and let the caller decide. An empty list on error would silently bury a channel.
- **Zero means not disclosed, not zero.** Instagram returns `play_count: 0`/`view_count: 0` for other creators' reels in many contexts. Taking that literally once zeroed a genuine 2.27M view reel and would drive every outlier score to zero, so a zero is mapped to null and never overwrites a count already stored.
- **Drift is a decision, not a surprise.** instagrapi is pinned `==2.18.9`; required fields (`pk`, `code`, `taken_at`, `media_type`) missing or mistyped raise `IG_DRIFT` with the raw payload; unknown new fields are ignored.
- **Config refuses to boot half configured.** The sidecar exits 78 (`EX_CONFIG`) on any bad or missing required value rather than answering requests it cannot honor. `IG_USERNAME` and `IG_PASSWORD` must be set together, the failure mode the onboarding bug below trips.
- **Loopback only, shared secret authenticated.** The sidecar refuses a non loopback `IG_SERVICE_HOST`, and `IG_SERVICE_TOKEN` (min 16 chars) is the only thing between a local process and the Instagram session. The session blob is written mode 0600.
- **Bounded concurrency over channels, not full parallelism.** `session.py`'s `SessionManager` holds one process-global re entrant lock and enforces its cooldown inside it, so every real Instagram call is already serialized regardless of how many Node requests arrive. Raising `syncConcurrency` therefore cannot create concurrent Instagram traffic; the win is pipelining one channel's local work against the next channel's fetch. Default 2, not 1 or unbounded, so a run gets that overlap without pretending the sidecar's lock is not the real ceiling.
- **Resume cursor lives on `channels`, not a new run-scoped table.** An interrupted deep crawl (item cap, cancel, or a channel error) needs to remember exactly one thing across runs: where to continue. Four nullable columns on the row a sync already reads and writes is smaller than a new table, and a TTL guard (the cursor must be younger than the lookback window) keeps a long-abandoned crawl from resuming a boundary that no longer covers today's window.
- **Batched snapshot inserts, with a per-row fallback.** A page's `video_snapshots` rows go in one multi-row insert instead of one per item. If the batch throws, the page retries one row at a time so a single poison row costs one item, not the rest of the page, the same failure-isolation guarantee the per-item upsert already made.

## 7. Open, not verified

- **The sidecar won't start onboarding bug** (`evidence/10-onboarding-bugs.md`, BUG 1): `kai kit init`'s masked `IG_PASSWORD` prompt returned empty on a real TTY, so `.env.local` was written with `IG_PASSWORD=` (length 0). The sidecar then refuses to start, `IG_USERNAME and IG_PASSWORD must be set together`, exit 78 `EX_CONFIG`, and launchd crash loops it, so port 8765 never comes up and IG sync is dead for every buyer. The root cause is in the CLI prompt (`src/cli/kai.ts`), not the sidecar; `config.py` is proven correct. This is a hard blocker for the IG half of the product.
- **No live sync has been proven end to end.** Per `documents/architect/shared/packaging-and-release.md`, a Kit install has not been shown to complete a live Instagram sync with real credentials; the buyer test that exercised the installer left the Instagram fields blank.
- **Live only paths are untested offline** (`services/ig/README.md`): a real `/login`, challenge or two factor round trip, a genuine Instagram issued rate limit, and a real CDN asset download. The SMS preference challenge branch in particular has never run against Instagram.
- **Performance, measured deterministically; live numbers still pending.** `scripts/bench-sync-concurrency.ts` runs the real engine against a stub sidecar. Two findings. First, the real win is fewer requests, not more workers: a repeat sync of an unchanged channel (5 pages of 6 posts) drops from 37 Instagram requests and 1615 ms to 9 requests and 393 ms once the incremental walk stops at the first all known page, a 76 percent request cut. Second, concurrency barely moves wall clock on today's single session sidecar: a 5 channel sync at `syncConcurrency` 1 versus 2 is 1.02x, because every Instagram call queues behind the sidecar's one process global lock (the model that lets calls overlap shows 1.67x, the ceiling a future per session sidecar would reach). The knob is safe and future proofing, not a win now. A live before and after on the throwaway account against real channels is still queued behind the shared sidecar window and is not recorded here yet.
