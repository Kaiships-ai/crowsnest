# Design Brief — Instagram Channel Sync (instagrapi), Gate 1

Status: **awaiting approval**. No code written yet.
Author: tech lead (Claude). Date: 2026-07-26.
Scope: replace Apify entirely with instagrapi; sync profile + all media from the last 30 days;
serve real thumbnails and playable video from our own storage; delete all seed data.

Everything in §1 was verified by reading the repo or running commands, not recalled. Commands and
their output are quoted where they are load-bearing.

---

## 1. Recon findings

### 1.1 Stack

| Thing | Value | Source |
|---|---|---|
| App | Next.js **16.2.11**, React **19.2.4**, App Router | `package.json:27,30` |
| Language | TypeScript 5, strict-ish; `@/*` → `src/*` | `tsconfig.json` |
| DB | SQLite via **better-sqlite3 13** + **drizzle-orm 0.45.2** | `package.json:21,25` |
| Migrations | drizzle-kit generate → `drizzle/*.sql`; applied by `tsx src/server/db/migrate.ts` | `package.json:10-11` |
| Tests | **vitest 4**, 27 test files, colocated `*.test.ts` + `tests/fixtures/*` | `vitest.config.ts` |
| E2E | **none — no Playwright, no browser test runner** | absence in `package.json` |
| Lint | `eslint` flat config (`eslint.config.mjs`), `next lint` not used | `package.json:9` |
| Typecheck | **no `typecheck` script**; project gate is build + lint | `package.json:5-15` |
| Runtime | node v22.23.1 | `node --version` |
| Python | system python3 **3.14.6** (too new for the stack below), `uv` present at `~/.local/bin/uv` | `python3 --version` |
| DB file | `data/crowsnest.db` (352KB, WAL mode) — `data/` is **gitignored** | `.gitignore:"data/"` |

`next.config.ts` is empty (no `images` config at all), which is why the app uses raw `<img>` rather
than `next/image` today.

**There are zero `route.ts` files in the app.** Every page is a server component under
`src/app/(shell)/`. The media-serving HTTP endpoint this work needs is entirely new surface, not a
modification. Next 16 route handlers take `params` as a **Promise** and support returning a
`ReadableStream` — read from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
per AGENTS.md.

### 1.2 Data model (current)

`src/server/db/schema.ts`, one migration `drizzle/0000_complete_morlocks.sql`. Tables:
`channels, fleets, fleet_channels, videos, channel_snapshots, video_snapshots, transcripts,
video_analyses, vault_items, scripts, saved_filters, remix_sessions, sync_jobs, app_settings`.

The two that matter:

- **`channels`** — `id` (text pk), `platform`, `handle`, `external_id`, `display_name`,
  `avatar_url`, `follower_count`, `following_count`, `media_count`, `bio`, `is_verified`,
  `sync_error`, `tracked_since`, `last_synced_at`. Unique index on `(platform, handle)`.
- **`videos`** — `id` (text pk), `channel_id` → channels ON DELETE CASCADE, `platform`,
  `external_id`, `url`, `caption`, `posted_at`, `duration_sec`, `thumbnail_url`, `video_url`,
  `view_count`, `like_count`, `comment_count`, `share_count`, `outlier_score`, `first_seen_at`,
  `last_refreshed_at`. Unique index `videos_platform_external` on `(platform, external_id)`.

`sync_jobs` is **global, not per channel**: `id, started_at, finished_at, status, stats (json),
gaps (json)`. There is no `channel_id`, no `items_seen`, no `items_created`, and no lock column.

Timestamps are **ISO-8601 strings**, not integers, throughout. New columns must match.

### 1.3 Current provider layer (all of this gets deleted)

`src/server/providers/`: `types.ts` (the `SocialProvider` contract), `registry.ts`, `apify.ts`,
`hikerapi.ts`, `ytdlp.ts`, plus a `.test.ts` for each. `registry.ts` gates the chain on env keys
`APIFY_TOKEN` / `HIKERAPI_KEY` and holds a module-level `Map` that providers self-register into.
The TDZ trap is documented in `registry.ts:3-12`: `registry.ts` must never import a provider file,
because `registry → apify → registry` is a cycle ESM hoists ahead of `const providers = new Map()`.
The side-effect imports therefore live in the consumer, `sync-engine.ts:17-18`.

**Sync call chain:** `sync-actions.ts` (`"use server"`) → `runSync()` in
`src/server/services/sync-engine.ts` → `getProviderChain()` → `provider.getProfile()` +
`provider.getRecentVideos(handle, 30)` → `upsertVideo()` (SELECT-then-INSERT/UPDATE on
`(platform, external_id)`) → `recomputeChannelScores()` → `channel_snapshots` + `video_snapshots`
inserts.

### 1.4 Gaps between what exists and what the goal requires

Verified by reading `sync-engine.ts` end to end:

| Requirement | Today | Verdict |
|---|---|---|
| Last-30-days lookback | `RECENT_VIDEOS_LIMIT = 30` **newest items**, no date boundary | missing |
| `LOOKBACK_DAYS` / `MAX_ITEMS_PER_SYNC` env | not present anywhere | missing |
| Own-storage assets | stores provider CDN URLs in `thumbnail_url`/`video_url` | **automatic fail today** |
| Playable video | **no `<video>` element exists anywhere in the app** | missing entirely |
| Carousels as children | model is one row per video, no children table | missing |
| Soft-mark deleted | no `deleted_at`/`is_deleted` column | missing |
| Idempotent upsert | exists, keyed `(platform, external_id)` — but SELECT-then-write, not atomic | partial |
| Per-asset failure isolation | per-*channel* isolation only (gaps) | partial |
| Timeouts on outbound calls | **none** on provider HTTP calls (only `execFileP` at 120s for yt-dlp) | missing |
| Concurrency lock | none — two `runSync()` calls interleave freely | missing |
| Config validated at boot | none; `process.env.X` read inline at call sites | missing |
| Structured logs | none — no logger in the repo | missing |
| Raw payload retention | none | missing |

The `catch → return []` pattern the goal forbids is not in the provider layer, but
`syncOneChannel` deliberately swallows every provider and DB error into a `gap` (`sync-engine.ts:202-206`).
That is defensible per-channel isolation and will be **kept but narrowed**: it must not swallow
programmer errors, and it must log with a typed error class.

### 1.5 The rendering path (the automatic-fail)

`src/components/feed/video-thumb.tsx:10-24` — the whole component:

```tsx
export function VideoThumb({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover"
      onError={(e) => { e.currentTarget.style.display = "none"; }} />
  );
}
```

Its own doc comment concedes the problem: *"hides itself if the remote image fails to load (provider
CDN URLs expire between syncs)"*. Call sites: `outlier-card.tsx:82`, `video-detail.tsx:249`,
`quick-preview-sheet.tsx:63`, `context-rail.tsx:34`. Avatars go straight to `AvatarImage src={channel.avatarUrl}`
in `channel-header.tsx:44`, `channel-table.tsx:75`, `feed-list-row.tsx:35`, `outlier-card.tsx:107`,
`video-detail.tsx:259`. All nine sites must move to our own media endpoint.

### 1.6 Live DB contents

```
channels: 6   videos: 110   video_snapshots: 90   sync_jobs: 11   transcripts: 11
```

| handle | followers | videos | oldest post |
|---|---|---|---|
| @buildinpublic.daily | 342,000 | 20 | 2026-04-24 |
| @aitoolsforcreators | 1,150,000 | 20 | 2026-04-24 |
| @solofounderdiary | 88,000 | 20 | 2026-04-24 |
| @shortformlab | 415,000 | 20 | 2026-04-24 |
| @kallaway | 442,288 | 30 | 2024-06-27 |
| `@https://www.instagram.com/hormozi/` | — | 0 | — |

Four of those are generated seed channels (80 videos). `@kallaway` is real. The sixth row is a
**live bug**: `addChannel` accepted a pasted URL as a handle and `normalizeHandle` merely prefixed
`@`. Handle validation is in scope.

Note `@kallaway`'s oldest post is 2024-06-27 — the current "30 newest" fetch reaches back two years.
Under a 30-day lookback the same channel yields far fewer items, which changes what the feed shows.
See open question Q4.

### 1.7 instagrapi — verified by installing it, not from docs

```
$ uv venv --python 3.12 igprobe && uv pip install instagrapi
$ uv pip show instagrapi
Name: instagrapi
Version: 2.18.9
```

Installs and imports cleanly on **Python 3.12.13**. (System Python here is 3.14.6; the service pins
3.12 via `uv`.) Verified signatures:

```
login(username=None, password=None, relogin=False, verification_code='') -> bool
user_info_by_username(username, use_cache=True) -> User
user_medias_v1(user_id, amount=0) -> List[Media]
user_medias_paginated_v1(user_id, amount=33, end_cursor='') -> Tuple[List[Media], str]
video_download_by_url(url, filename='', folder='', overwrite=True) -> Path
photo_download_by_url(url, filename='', folder='', overwrite=True) -> Path
clip_download_by_url(url, filename='', folder='') -> str
dump_settings(path) -> bool ; load_settings(path, override_app_version=False) -> Dict
set_proxy(dsn) ; set_device(device=None, reset=False, hydrate_app_profile=False)
```

`Media` model fields: `pk, id, code, taken_at, media_type, image_versions2, product_type,
thumbnail_url, location, user, comment_count, like_count, play_count, view_count, caption_text,
video_url, video_duration, resources, usertags, dimensions, has_audio, clips_metadata, …`

`Resource` (carousel child) fields: **`pk, video_url, thumbnail_url, media_type, usertags` only** —
children have no `taken_at` and no caption, so they inherit both from the parent.

**Anonymous access does not work.** Probed live:

```
$ python -c "Client().user_info_by_username_gql('kallaway')"
GQL FAIL: instagrapi.exceptions.ClientBadRequestError
400 Client Error: Bad Request for url:
https://www.instagram.com/api/v1/users/web_profile_info/?username=kallaway
```

A logged-in Instagram account is therefore **mandatory**, which makes it the ban-risk surface and
the subject of open question Q1.

Exception classes available for the error taxonomy (from `instagrapi.exceptions`): `BadPassword`,
`TwoFactorRequired`, `ChallengeRequired`, `CaptchaChallengeRequired`, `ChallengeSelfieCaptcha`,
`ChallengeUnknownStep`, `ReloginAttemptExceeded`, `LoginRequired`, `ClientLoginRequired`,
`FeedbackRequired`, `PleaseWaitFewMinutes`, `RateLimitError`, `ClientThrottledError`, `SentryBlock`,
`AccountSuspended`, `PrivateAccount`, `UserNotFound`, `MediaNotFound`, `MediaUnavailable`,
`ProxyAddressIsBlocked`, `ClientConnectionError`, `ClientRequestTimeout`, `VideoNotDownload`,
`WrongCursorError`.

---

## 2. Why instagrapi and not the official API

The Instagram **Basic Display API was shut down on 2024-12-04**. The remaining official surface is
the **Instagram Graph API**, which requires a Business/Creator account, a linked Facebook Page, a
Meta app, and App Review for each permission. Its business-discovery lookup returns only coarse
public counters for other accounts and **cannot enumerate an arbitrary creator's media** the way
this product requires; media endpoints are scoped to accounts you own.

Crowsnest's entire premise is analyzing **other creators'** reels (@kallaway et al.) — accounts we
do not own and cannot get to authorize us. The official API structurally cannot serve this product.
instagrapi is therefore chosen with eyes open, and the ToS/ban risk is documented in the README
rather than hidden. **This is a disclosed gap, not a silent one.**

---

## 3. Service boundary — Node ↔ Python

instagrapi is Python; the app is Node. Four options considered:

| Option | Verdict |
|---|---|
| **A. Long-lived Python HTTP sidecar** (FastAPI/uvicorn on localhost, holds one `Client`) | **chosen** |
| B. Fresh `python3 script.py` per call via `execFileP` | rejected |
| C. Port instagrapi's private-API protocol to TypeScript | rejected |
| D. Third-party hosted wrapper (HikerAPI etc.) | rejected |

**Why A.** The `Client` object holds the authenticated session, the pinned device profile, and
cookies. A sidecar loads settings once and reuses one warm session across an entire sync; it also
gives one place to enforce pacing (`delay_range`) and a single-flight lock. It is the only option
where "recover from an invalidated session" is a real code path rather than a re-login storm.

**Why not B.** Every invocation pays interpreter start + `load_settings` + a re-auth handshake, and
process-per-call makes rate-limit pacing and cursor state impossible to hold. It also multiplies the
login-attempt count, which is exactly what gets accounts challenged.

**Why not C.** Reimplementing a private API that drifts without notice, with no upstream to track.
Non-starter.

**Why not D.** The goal says replace Apify with instagrapi; swapping one paid black box for another
misses the point, and Kai has already refused paid vendors this project.

**Shape.** `services/ig/` — a `uv`-managed Python project pinned to `instagrapi==2.18.9` and Python
3.12, exposing a small localhost-only HTTP API:

```
GET  /health                      -> {status, logged_in, username, instagrapi_version}
POST /login                       -> {status: ok|challenge_required|two_factor_required}
POST /challenge/resolve           -> {status}
GET  /profile?handle=             -> ProfileDTO + raw payload
GET  /medias?handle=&since=&max=  -> [MediaDTO] + raw payloads, newest-first, stops at `since`
POST /download                    -> {path, bytes, content_type, sha256}
```

The sidecar **downloads assets itself** (it owns the authenticated session and the right headers)
and writes into the media root the Node app reads from. Node never sees a CDN URL.

Auth between Node and the sidecar: a shared secret (`IG_SERVICE_TOKEN`), bound to `127.0.0.1` only.
Node calls it with an `AbortSignal` timeout on **every** request.

Lifecycle: `npm run dev` does not start it; it is a separate documented process
(`npm run ig:service`). Node treats "sidecar down" as a typed, surfaced error — never as an empty
result.

---

## 4. Data model changes

All new columns are ISO-8601 **text** timestamps, matching the existing convention.

### 4.1 `videos` — modified

| Column | Type | Purpose |
|---|---|---|
| `media_type` | text NOT NULL | `photo` \| `video` \| `carousel` (derived from IG `media_type`/`product_type`) |
| `product_type` | text | `clips` (reel) \| `feed` \| `igtv` — raw IG value |
| `shortcode` | text | IG `code`, for building permalinks |
| `thumbnail_asset_id` | text → `media_assets.id` ON DELETE SET NULL | replaces `thumbnail_url` |
| `video_asset_id` | text → `media_assets.id` ON DELETE SET NULL | replaces `video_url` |
| `deleted_at` | text | soft-mark: present on IG last sync, absent now |
| `raw_payload` | text (json) | untouched instagrapi dict for drift forensics |
| `raw_fetched_at` | text | when `raw_payload` was captured |

`thumbnail_url` / `video_url` are **dropped**. Keeping them is the automatic-fail; leaving them
nullable-but-unused invites a regression. `external_id` continues to hold IG `pk` — the goal's
"idempotent upsert keyed on media pk" is satisfied by the existing unique index
`(platform, external_id)`.

### 4.2 `video_children` — new (carousels)

`id` pk · `video_id` → videos ON DELETE CASCADE · `position` int NOT NULL · `external_id` (child
`pk`) · `media_type` · `thumbnail_asset_id` · `video_asset_id` · `raw_payload`.
Unique on `(video_id, position)` **and** on `(video_id, external_id)`.

A carousel is one `videos` row plus N children — never N top-level rows, never one image.

### 4.3 `media_assets` — new (the storage table)

`id` pk · `sha256` text NOT NULL UNIQUE · `kind` (`thumbnail` \| `video` \| `avatar`) ·
`content_type` · `byte_size` int NOT NULL · `width` · `height` · `duration_sec` ·
`storage_path` text NOT NULL (relative to media root) · `source_url_hash` (sha1 of the expiring CDN
URL — for dedupe/debug; **the URL itself is not stored**) · `downloaded_at` · `last_verified_at`.

Content-addressed by sha256, so re-downloading an unchanged asset dedupes to one file, and
`byte_size` gives Gate 3 proof #5 straight from the DB.

### 4.4 `channels` — modified

Add `avatar_asset_id` → `media_assets.id`; drop `avatar_url`. Add `external_id` usage for IG user pk
(column already exists). Add `is_private`, `last_full_sync_at`.

### 4.5 `sync_jobs` — modified

Add `channel_id` (nullable — a run can span channels), `items_seen`, `items_created`,
`items_updated`, `items_failed`, `assets_downloaded`, `assets_failed`, `lookback_days`,
`error_code`, `error_message`, `heartbeat_at`. Gate 3 proofs #3 and #9 read directly off this table.

**Concurrency lock:** a partial unique index on `sync_jobs(channel_id) WHERE status = 'running'`.
A second concurrent sync for the same channel fails the insert and is reported as
`SyncAlreadyRunningError` — enforced by the database, not by an in-process mutex that a second Node
worker would not see. Stale `running` rows (`heartbeat_at` older than N minutes) are reaped at the
start of a run.

---

## 5. Media storage & download policy

**Root:** `MEDIA_ROOT`, default `data/media/` (already gitignored via `data/`).
**Layout:** `data/media/<sha256[0:2]>/<sha256>.<ext>` — content-addressed, fanned out so no directory
holds 100k entries.

**Eager vs on-demand.** Thumbnails: **eager**, downloaded during sync. They are small (~20-200KB),
every one is needed the moment the grid renders, and the CDN URL is dead within hours — on-demand
would fail exactly when the user looks at it. Videos: **on-demand by default**, eager behind
`EAGER_VIDEO_DOWNLOAD=true`. A reel is 2-15MB; 30 days of a prolific channel is gigabytes, and most
are never watched. First playback triggers a download, streams once cached.

The honest cost of on-demand video: **the IG video URL expires**, so a first playback days after
sync needs a fresh `media_info` fetch to re-resolve it. That is a real authenticated round-trip on
the user's click. Mitigation: the video endpoint re-resolves via the sidecar, downloads, then
streams — with an explicit "fetching video…" UI state rather than a spinner that lies. If Kai wants
guaranteed-instant playback, `EAGER_VIDEO_DOWNLOAD=true` is the switch (see Q3).

**Retention:** `MEDIA_RETENTION_DAYS` (default 90). A prune job deletes assets whose owning video
is soft-deleted or older than retention **and** that no other row references (sha256 dedupe means
refcount must be checked). Never deletes an asset still referenced.

**Serving:** `GET /api/media/[assetId]` — Node route handler, `runtime = 'nodejs'`.
- Validates the id against `media_assets`, resolves `storage_path`, **rejects any path escaping
  the media root** (path traversal guard), 404s on unknown id.
- `HEAD` → 200 with `Content-Length`, `Content-Type`, `ETag` (= sha256), `Accept-Ranges: bytes`.
- `GET` without `Range` → 200 full stream.
- `GET` with `Range: bytes=a-b` → **206** with `Content-Range: bytes a-b/total`, streamed via
  `createReadStream(path, {start, end})` piped into a `ReadableStream`. Malformed range → **416**
  with `Content-Range: bytes */total`.
- `Cache-Control: public, max-age=31536000, immutable` — safe because the URL is content-addressed.

This is what makes Gate 3 proof #6 (`curl -I` → 200, `curl -H 'Range: bytes=0-1023' -i` → 206) pass
for real, and it is what makes seeking work in `<video>`.

---

## 6. Sync algorithm

```
acquire lock (insert sync_jobs row; unique-partial-index enforces single-flight)
profile  = sidecar GET /profile?handle=...        (timeout)
upsert channel; download avatar -> media_assets
cursor = ''; seen = 0; boundary = now - LOOKBACK_DAYS
loop:
  page, cursor = sidecar GET /medias?handle&cursor   (newest-first, timeout)
  for media in page:
     if media.taken_at < boundary: stop_reason = 'lookback'; break loop
     if seen >= MAX_ITEMS_PER_SYNC: stop_reason = 'cap'; break loop
     upsert video (by platform+external_id) + children; store raw_payload
     enqueue thumbnail download (always) [+ video if EAGER]
     seen++
  if not cursor: stop_reason = 'exhausted'; break
  sleep jitter(300-800ms)
download assets with bounded concurrency; each failure isolated -> items_failed++, video still saved
soft-mark: videos in-window, not seen this run, not already deleted -> deleted_at = now
recompute outlier scores; write channel_snapshots + video_snapshots
finalize sync_jobs row (status, counts, stop_reason)
```

Notes:
- **Newest-first ordering is load-bearing** for the boundary break. instagrapi's `user_medias_v1`
  returns newest-first, but the handoff notes Apify returned *pinned* posts first. Pinned IG posts
  can be older than the window and would end the loop early. Mitigation: do not break on the first
  out-of-window item — break only after **3 consecutive** out-of-window items, and never treat a
  pinned item (`clips_metadata`/pin flags in the raw payload) as a boundary signal. This is
  belt-and-braces and cheap.
- Soft-delete is scoped **to the lookback window only**. Anything older is out of scope for this run
  and must not be marked deleted.
- Per-asset failure never fails the video; per-video failure never fails the channel; per-channel
  failure never fails the run. Each level increments a counter and logs.

**Scheduling.** Manual trigger (existing Sync button) plus an optional interval loop guarded by the
same DB lock. No cron daemon — this is a local-first app that is not always running. `SYNC_INTERVAL_MINUTES=0`
disables. Documented, not hidden.

---

## 7. Error taxonomy

Typed errors in `src/server/ig/errors.ts`, each with a stable `code`, an `retryable` flag, and a
user-facing message. The sidecar maps instagrapi exceptions to these codes and returns them as JSON;
Node rehydrates them.

| Code | From | Retryable | UI treatment |
|---|---|---|---|
| `IG_AUTH_REQUIRED` | `LoginRequired`, `ClientLoginRequired` | after re-login | banner: "Instagram session expired — re-authenticate" |
| `IG_BAD_CREDENTIALS` | `BadPassword`, `AccountSuspended` | no | settings error, blocks sync |
| `IG_TWO_FACTOR` | `TwoFactorRequired` | no (needs input) | prompt for 6-digit code |
| `IG_CHALLENGE` | `ChallengeRequired`, `CaptchaChallengeRequired`, `ChallengeSelfieCaptcha`, `ChallengeUnknownStep` | no (needs input) | challenge flow: choose email/SMS, enter code |
| `IG_RATE_LIMITED` | `FeedbackRequired`, `PleaseWaitFewMinutes`, `RateLimitError`, `ClientThrottledError`, `SentryBlock` | yes, backoff | "Instagram is throttling us — retrying in Nm" |
| `IG_NOT_FOUND` | `UserNotFound`, `MediaNotFound`, `MediaUnavailable` | no | per-channel gap |
| `IG_PRIVATE` | `PrivateAccount` | no | per-channel gap |
| `IG_PROXY_BLOCKED` | `ProxyAddressIsBlocked` | no | settings error |
| `IG_NETWORK` | `ClientConnectionError`, `ClientRequestTimeout` | yes | retry once, then gap |
| `IG_ASSET_DOWNLOAD` | `VideoNotDownload`, HTTP failure, zero bytes | yes | per-asset, video kept |
| `IG_DRIFT` | required field missing/wrong type in payload | no | **fails loudly**, raw payload saved |
| `IG_SERVICE_DOWN` | sidecar unreachable | yes | "Instagram service is not running" |
| `SYNC_ALREADY_RUNNING` | lock contention | n/a | "A sync is already in progress" |

**Rate-limit strategy:** exponential backoff with full jitter, base 60s, cap 30min, max 5 attempts,
persisted across restarts (`app_settings` key holding "cool down until"). A `FeedbackRequired` is
treated as serious — the run stops rather than hammering.

**Session recovery:** settings blob persisted to `IG_SESSION_PATH` (default `data/ig-session.json`,
gitignored, chmod 600). On `LoginRequired`, the sidecar retries once with `load_settings` +
`login(relogin=True)`; a second failure escalates to `IG_AUTH_REQUIRED`. Gate 3 proof #10 exercises
this by corrupting the session file.

**Drift policy:** required fields (`pk`, `code`, `taken_at`, `media_type`) missing or mistyped →
`IG_DRIFT`, loud failure, raw payload persisted. Unknown/new fields → ignored, never fatal. Optional
fields absent → null. instagrapi pinned to `==2.18.9`.

---

## 8. Env schema

Validated once at boot with zod in `src/server/config.ts`; the process **refuses to start** on a
missing or malformed required var (Gate 2 requirement). Anything reading `process.env` outside this
module is a lint-level mistake.

| Var | Req | Default | Meaning |
|---|---|---|---|
| `IG_SERVICE_URL` | yes | `http://127.0.0.1:8765` | sidecar base URL |
| `IG_SERVICE_TOKEN` | yes | — | shared secret, Node ↔ sidecar |
| `IG_USERNAME` | yes (sidecar) | — | Instagram login |
| `IG_PASSWORD` | yes (sidecar) | — | Instagram password |
| `IG_SESSION_PATH` | no | `data/ig-session.json` | persisted session blob |
| `IG_PROXY` | no | — | e.g. `http://user:pass@host:port` |
| `IG_DEVICE_SEED` | no | derived from username | pins device profile stably |
| `LOOKBACK_DAYS` | no | `30` | sync window |
| `MAX_ITEMS_PER_SYNC` | no | `200` | hard cap per channel per run |
| `MEDIA_ROOT` | no | `data/media` | asset storage root |
| `EAGER_VIDEO_DOWNLOAD` | no | `false` | download videos during sync |
| `MEDIA_RETENTION_DAYS` | no | `90` | prune threshold |
| `IG_REQUEST_TIMEOUT_MS` | no | `30000` | per sidecar call |
| `IG_DOWNLOAD_TIMEOUT_MS` | no | `120000` | per asset |
| `SYNC_INTERVAL_MINUTES` | no | `0` (off) | background loop |
| `DATABASE_URL` | no | `data/crowsnest.db` | existing |

Removed: `APIFY_TOKEN`, `APIFY_ACTOR_ID_IG_PROFILE`, `APIFY_ACTOR_ID_IG_REEL`, `HIKERAPI_KEY`.

---

## 9. What gets deleted

- `src/server/providers/apify.ts` + `apify.test.ts`, `hikerapi.ts` + `hikerapi.test.ts`,
  `registry.ts` + `registry.test.ts` (the env-gated chain is meaningless with one provider).
- `apify-client` dependency from `package.json`.
- `tests/fixtures/apify-*.json`, `tests/fixtures/hikerapi-*.json`.
- `src/server/db/seed.ts`, `src/server/db/seed-data.ts`, the `db:seed` script, and **all four seed
  channels + their 80 videos** from the live DB.
- Apify mentions in `README.md`, `docs/`, `settings-actions.ts`, `settings/page.tsx`,
  `components/settings/sync-section.tsx`.

### 9.1 Pre-audit of Gate 3 proof #12

Ran the goal's own sweep now, so the end-state justification is not a surprise:

```
$ rg -in 'mock|seed|lorem|placeholder|dummy|faker|placehold\.co|picsum' src/ --glob '!**/*.test.*' -c
src/server/db/seed.ts:17          src/components/remix/deep-link.ts:15
src/components/remix/remix-studio.tsx:14   src/server/db/seed-data.ts:4
... 27 files total
```

Classification of every hit:

| Class | Files | Disposition |
|---|---|---|
| (a) real seed generator | `server/db/seed.ts`, `server/db/seed-data.ts` | **deleted** |
| (b) domain vocabulary "seed" — remix deep-link seeding, "Seed from a Vault hook" | `remix/deep-link.ts`, `remix/remix-studio.tsx`, `remix/stage-hook.tsx`, `remix/stage-style.tsx`, `feed/[videoId]/remix/page.tsx` | **kept, justified** — this is the product's own language for pre-filling a remix stage, unrelated to fake data |
| (c) `placeholder=` form props | `ui/input.tsx`, `ui/textarea.tsx`, `ui/select.tsx`, dialogs, filter-bar, command-menu | **kept, justified** — HTML attribute |
| (d) UI placeholder thumbnail (hatch + play glyph) | `feed/outlier-card.tsx:23`, `feed/video-thumb.tsx` | **rewritten** — becomes the real empty/unavailable state |
| (e) stale comments referencing seed rows | `channels/channel-header.tsx:15`, `feed/filter-bar.tsx:44`, `queries/*`, `services/*` | **updated or removed** |

So proof #12 will not come back zero, and pretending otherwise would be dishonest: classes (b) and
(c) are legitimate English/HTML and will be justified in writing at Gate 3, exactly as the goal
permits.

`ytdlp.ts` is a judgement call — it is the keyless single-reel import and the transcription
download path, not an Apify surface. **Kept**, but the transcription path is rewired to use the
locally stored video asset instead of re-downloading from a URL. See Q5.

`SocialProvider` in `types.ts` is kept as the internal contract (one implementation:
`InstagramProvider`), because `sync-engine`, the outlier math, and the tests all speak it, and the
platform column still anticipates TikTok/YouTube.

---

## 10. UI changes

- `VideoThumb` → renders `/api/media/{thumbnailAssetId}`; states: real image, "downloading"
  (asset row exists, bytes pending), "unavailable" (download failed, with retry), and genuine empty
  (no asset — e.g. a channel never synced).
- New `VideoPlayer` — `<video controls preload="metadata">` pointed at `/api/media/{videoAssetId}`,
  with poster = thumbnail asset. On-demand path shows an explicit fetch state.
- New carousel viewer on video detail — children in `position` order, arrows, per-child image/video.
- Channel/feed: in-progress sync state driven by the `sync_jobs` row (`running` + counters), real
  error state from `error_code`, real empty state ("no posts in the last 30 days" ≠ "not synced yet"
  ≠ "sync failed" — three distinct states, not one placeholder).
- Avatars move to the media endpoint.

---

## 11. Test & proof plan

- Unit: mapper (IG payload → model) against **real captured payloads** committed as fixtures,
  boundary/pagination logic, range-header parser, path-traversal guard, config validation,
  error mapping, soft-delete selection, dedupe by sha256.
- Integration (in-memory DB, existing pattern): full sync against a stubbed sidecar; second sync
  asserts `items_created = 0`; asset failure isolation; lock contention.
- **Live integration** (opt-in via env, real account): real `@kallaway` sync, asserts
  `items_seen > 0` and `min(taken_at) >= now - 30d`.
- **E2E**: Playwright must be added (none today). Asserts a rendered thumbnail responds 200 with
  non-zero bytes, a `<video>` request returns 206 for a range, and **zero `cdninstagram.com`
  substrings in the DOM or any API response**.

Gate 3's 13 proofs map onto these; #7, #11 and #12 are `rg` sweeps run at the end.

---

## 12. Assumptions (proceeding on these unless told otherwise)

1. Single-user local-first app; no multi-tenancy, no auth on the media endpoint beyond
   localhost-only binding.
2. SQLite stays; no Postgres migration.
3. One Instagram account for all syncs (not per-channel credentials).
4. `data/media` on local disk; no S3/R2.
5. The existing outlier math, remix, transcription, and vault features stay behind the same
   contracts — this work replaces acquisition and storage, not analysis.
6. Existing real `@kallaway` rows are migrated in place (assets backfilled on next sync), not wiped
   with the seed data.
7. Photos and carousels now enter a schema built around "videos"; the table keeps its name to avoid
   a churny rename, with `media_type` distinguishing them.

---

## 13. Blocking questions — ANSWERED 2026-07-26

**Q1 — Instagram account → "Burner account, give me creds".**
Kai supplies `IG_USERNAME` / `IG_PASSWORD` for a throwaway account; they go in `.env.local`
(gitignored) and are never echoed into chat, commits, or docs. **Credentials are not yet in hand —
the build proceeds up to the point of live proof, then blocks.** Gate 3 proofs #3, #4, #5, #6, #8,
#10 are gated on this.

**Q2 — 2FA / challenge → "Settings UI flow".**
Full in-app challenge handling: login status card, challenge-method choice (email/SMS), 6-digit code
entry, 2FA code entry, live status. This is a real state machine in Settings, not a terminal prompt.
Scope accepted: sidecar exposes `/login`, `/challenge/resolve`, `/two-factor`, `/health`; Node adds
server actions + polling for status; Settings gains an "Instagram connection" section.

**Q3 — Video download policy → "On-demand (default)".**
Thumbnails eager, videos downloaded on first play, `EAGER_VIDEO_DOWNLOAD` retained as an env escape
hatch (default `false`). The first-play path re-resolves the expired IG URL through the sidecar and
shows an explicit "fetching video…" state.

**Q4 — Existing rows → "Keep visible, stop refreshing".**
Real rows older than the lookback window stay in the feed and in outlier math. They are **not**
soft-deleted (soft-delete is scoped to in-window items only, as designed in §6), **not** re-synced,
and **not** asset-backfilled. Consequence, stated plainly: the 73.2× @kallaway outlier from
2024-06 keeps its transcript, analysis, and remix session and stays visible, but its thumbnail is a
dead CDN URL — so it renders in the "unavailable" state until someone re-syncs it deliberately. A
one-shot `backfill-assets` script is listed as a recommended follow-up rather than scope creep here.

**Q5 — Scope of the purge → assumption, not asked (4-question cap).**
`yt-dlp` is **kept**. It is not an Apify surface: it powers keyless "paste a reel URL" import and
the transcription download path. "Replace Apify entirely" is read as replacing the *provider chain*,
which `yt-dlp` was never part of (`ytdlp.ts` has no `registerProvider` call). Say the word if you
want it gone too and I'll fold that in.

---

## 13b. As-built deltas (added during Gate 2)

Things that were not in the approved design and were added because building it surfaced
them. Recorded here so the brief does not quietly drift from the code.

1. **A real mapping layer in `src/server/ig/client.ts`.** The design implied the sidecar's
   JSON could be consumed directly. It cannot: the sidecar emits snake_case, and its
   profile DTO uses entirely different names (`pk`/`username`/`full_name` vs
   `externalId`/`handle`/`displayName`). The first implementation cast the response to
   the TypeScript interface, which compiles cleanly and yields `undefined` for every
   field at runtime. `mapProfile`/`mapMedia`/`mapHealth`/`mapDownload` now convert
   explicitly, and a missing **required** field raises `IG_DRIFT` instead of a silent
   null. Caught in review, not by me.
2. **New error code `IG_SERVICE_UNAUTHORIZED`.** The sidecar's 401 comes from its own
   auth guard and uses FastAPI's `{detail: …}` rather than our error envelope, so it
   degraded to `IG_UNKNOWN` and read like an Instagram problem when it is actually a
   mismatched shared secret between two of our own processes.
3. **`src/server/db/bootstrap.ts` + `npm run db:bootstrap`.** Deleting `seed.ts` also
   deleted the only source of the two built-in filter presets ("Balanced", "High
   Conviction"), which are product configuration rather than fake content. Bootstrap
   re-creates them idempotently.
4. **Asset downloads use the injected client.** `runSync` defaulted asset downloads to
   the module-level `igClient` singleton, so an injected client only covered half the
   outbound calls — a testing lie, and two paths to the same sidecar in production.
5. **Handle validation moved into `normalizeHandle`.** It now extracts the handle from a
   pasted profile URL and rejects junk. The old version simply prefixed `@`, which is how
   the live DB grew a channel named `@https://www.instagram.com/hormozi/`.
6. **Two-pass migration.** `drizzle-kit generate` demands an interactive TTY to
   disambiguate simultaneous add+drop on one table, and hangs headless. Splitting into
   `0001` (additive) and `0002` (drops) removes the ambiguity, generates without prompts,
   and preserves existing rows.
7. **The platform picker was removed from Add Channel.** It offered TikTok and YouTube
   Shorts, which have no data source at all now — picking one produced a channel row that
   could never sync. The `platform` column remains for a future second source.

## 14. Risks I am carrying

- **Ban risk is real and mine to disclose, not to minimize.** A burner account may be challenged or
  disabled during development. Mitigations: pinned device, session reuse, jittered pacing, low
  request volume, optional proxy. None of them are guarantees.
- **Private-API drift** can break mapping at any time with no deprecation notice. Mitigated by
  version pin + raw payload retention + loud `IG_DRIFT` failures.
- **On-demand video re-resolution** depends on the account still being able to fetch `media_info`
  at click time. If the account is challenged, playback of uncached video fails — the UI must say
  so rather than spin.
- **Playwright is a new dependency** and browser download on this machine is unverified.
- Proofs #10 (session invalidation + rate-limit recovery logs) will be produced by deliberately
  corrupting the session file and by forcing the backoff path; a genuine Instagram-issued
  rate-limit is not something I can summon on demand, and I will label the evidence accordingly.
