# ig-sync: architecture

## Key files

### The Python sidecar (`services/ig/`)

- `services/ig/crowsnest_ig/app.py`: the FastAPI surface. One `require_token`
  dependency guards every data route with a constant-time compare of the `X-IG-Token`
  header; `/health` is the one route that answers without a session. Endpoints:
  `/login`, `/challenge/resolve`, `/two-factor`, `/login-by-session`, `/logout`,
  `/profile`, `/medias`, `/resolve-media`, `/media-stats`, `/download`. Every failure
  is rendered as `{"error": {...}}`; nothing here converts a failure into an empty list.
- `services/ig/crowsnest_ig/config.py`: environment loaded and validated once at import.
  `load_env_file()` parses `.env.local` in Python (never by sourcing a shell script,
  because a real password contains a quote, `$`, or a backtick). `_build()` refuses to
  start on a bad value. `IG_USERNAME`/`IG_PASSWORD` must be set together; `IG_SERVICE_HOST`
  must be loopback; `IG_SERVICE_TOKEN` must be at least 16 chars.
- `services/ig/crowsnest_ig/session.py`: `SessionManager`, the one long-lived
  authenticated `instagrapi` client behind a re-entrant lock, with login/challenge/2FA
  brokering and one-shot session recovery.
- `services/ig/crowsnest_ig/mapping.py`: DTO mapping, the 3-consecutive lookback boundary
  (`apply_lookback`), and carousel `children_from_media`.
- `services/ig/crowsnest_ig/media.py`: content-addressed download into `MEDIA_ROOT`.
- `services/ig/crowsnest_ig/ratelimit.py`, `errors.py`, `device.py`, `logging.py`:
  backoff/cooldown, the instagrapi-exception → `IG_*` taxonomy, device pinning, and the
  redacting structured logger.
- `services/ig/README.md`: the operator's reference — the ToS/ban warning, the env schema,
  the endpoint contracts, and the error-code table.

### The Node side that talks to it (`src/server/`)

- `src/server/ig/client.ts`: the HTTP client for the sidecar. Every call has a timeout
  (`AbortSignal.timeout`); a failure is a typed `IgError`, never `[]`. The wire mappers
  (`mapMedia`, `mapProfile`, `mapHealth`, …) are the boundary where snake_case JSON
  becomes the TypeScript shape and a missing required field becomes a loud `IG_DRIFT`.
- `src/server/ig/errors.ts`, `src/server/ig/assets.ts`: the error envelope decoder and
  `tryEnsureAsset`, which downloads a thumbnail/avatar/video into the app's own media store.
- `src/server/services/sync-engine.ts`: the sync itself — locking, per-channel page walk,
  upsert, carousel children, soft-delete, the view-count enrichment pass, and outlier
  rescoring. Also `addChannel`, `importReelByUrl`, and `requestCancel`.
- `src/server/actions/sync-actions.ts`: the thin `"use server"` wrappers — `startSyncAction`,
  `getSyncProgressAction`, `getChannelSyncProgressAction`, `cancelSyncAction`,
  `addChannelAction`, `importReelAction`, `getLatestSyncJob`.
- `src/server/config.ts`: the Node-side env defaults — `IG_SERVICE_URL`
  (`http://127.0.0.1:8765`), `LOOKBACK_DAYS` (30), `MAX_ITEMS_PER_SYNC` (200),
  `SYNC_MAX_RETRIES` (3), `SYNC_RETRY_BASE_MS` (1000), `EAGER_VIDEO_DOWNLOAD` (false).
- `src/app/(shell)/channels/page.tsx` and `[channelId]/page.tsx`: the kanban board and
  channel detail — where a user tracks a channel and reads its last sync.
- `src/components/channels/add-channel-dialog.tsx`: the add-a-channel dialog.
- `src/cli/service-darwin.ts`: LaunchAgent management that keeps the sidecar (and the Next
  server) alive across a reboot; `scripts/ig-service.sh` is the wrapper that loads
  `.env.local` and execs the module.

## Data flow

**One session, over localhost.** The sidecar holds exactly one authenticated `instagrapi`
`Client`. It is the only process in crowsnest that logs in to Instagram or ever sees an
Instagram CDN URL. The Next.js app reaches it at `IG_SERVICE_URL` (default
`http://127.0.0.1:8765`), sending the shared secret `IG_SERVICE_TOKEN` as an `X-IG-Token`
header on every request; the sidecar binds loopback only and refuses any other host at boot.
Credentials (`IG_USERNAME`, `IG_PASSWORD`) are read by the sidecar process alone from
`.env.local` and are never sent to or rendered by the app.

**A sync run** (`runSync` in `sync-engine.ts`, design brief §6):

1. **Acquire the DB lock.** An `IMMEDIATE` SQLite transaction checks for an overlapping
   `running` job and inserts a `sync_jobs` row. Concurrency is settled by the database, not
   an in-process flag: two runs may hold locks only when their channel sets are disjoint,
   because two runs on one channel corrupt each other's soft-delete.
2. **Per channel, sequentially** (one account making requests, paced to avoid a rate-limit
   burst): fetch the profile (`GET /profile`), download the avatar, then page the media
   newest-first (`GET /medias`) until the lookback boundary. The stop condition is a **date**
   (`LOOKBACK_DAYS`, default 30), not a count; `MAX_ITEMS_PER_SYNC` (default 200) is only a
   safety cap. Pinned posts appear first and out of order, so the walk stops only after **3
   consecutive** out-of-window items, and a pinned item never counts toward that streak.
3. **Upsert each post** keyed on `(platform, external_id)`. Carousels are one `videos` row
   with `video_children` rows, not separate posts. Thumbnails download into the app's own
   media store; video is on-demand on first play unless `EAGER_VIDEO_DOWNLOAD` is set. A
   `video_snapshots` row records the metrics seen this run.
4. **Soft-delete** in-window posts that did not come back this run — but only when the run
   actually enumerated the whole window (`stop_reason` lookback or exhausted) and saw at
   least one item. A run that saw zero items refuses to interpret an empty fetch as deletions.
5. **View-count enrichment** (off unless `viewCountEnrichPerChannel` > 0): the listing
   endpoint returns `play_count: 0` for other creators' reels, so the newest N `clips` are
   re-read one at a time through `POST /media-stats` (`media_info_v1`) to get the real number.
6. **Rescore**: `recomputeChannelScores` reads `videos.view_count`, computes each post's
   outlier score against the channel's own baseline, and writes a `channel_snapshots` row.
   Auto-analyze and idea-generation for new top outliers run last, and never throw.
7. **Finalize** the job row — but only if this run still owns it (a reaper may have declared
   it dead). Status is `success`, `partial` (a survivor plus a gap, or a cancel that left
   work undone), or `failed` (every channel failed).

**Asset serving.** Downloaded bytes are content-addressed (`<sha256[0:2]>/<sha256>.<ext>`
under `MEDIA_ROOT`), deduped, and served by the app so the browser never renders a signed
Instagram URL that expires within hours. `POST /resolve-media` re-resolves a single post's
currently-valid URLs before an on-demand video download.

**Detached start.** `startSyncAction` returns the moment the lock is won (job id in hand,
via `onJobStarted`) and lets the run finish under Next's `after()`, so the browser never
holds a POST open for a minutes-long sync. Progress and cancel both go through the
`sync_jobs` row: `getSyncProgressAction` polls it, `cancelSyncAction` sets
`cancel_requested`, and the engine notices co-operatively at the next page or channel
boundary, keeping everything already committed.

## Decisions

- **Python sidecar, not in-process.** instagrapi is Python, and its `Client` holds the
  session, the pinned device profile, and the cookie jar. A process-per-call design would
  re-authenticate constantly, and a storm of logins is exactly what gets an account
  challenged. A long-lived sidecar is the only shape where one warm session, request pacing,
  and session recovery are real code paths. (Concept brief; `services/ig/README.md`.)
- **instagrapi despite the ToS risk.** Instagram's Basic Display API shut down 2024-12-04
  and the Graph API cannot enumerate an arbitrary creator's media. instagrapi drives the
  private mobile API, which is against Instagram's Terms and can get the account rate-limited,
  challenged, or banned — a disclosed trade-off, which is why it is meant for a **burner**
  account. This also replaced a paid vendor (Apify) so the product depends on no third party.
- **A failure is never an empty result.** Both the sidecar and the Node client return a typed
  `IG_*` error and let the caller decide. An empty list on error would silently bury a channel.
- **Zero means "not disclosed", not zero.** Instagram returns `play_count: 0` /
  `view_count: 0` for other creators' reels in many contexts. Taking that literally once
  zeroed a genuine 2.27M-view reel and would drive every outlier score to zero, so a zero is
  mapped to null and never overwrites a count already stored.
- **Drift is a decision, not a surprise.** instagrapi is pinned `==2.18.9`; required fields
  (`pk`, `code`, `taken_at`, `media_type`) missing or mistyped raise `IG_DRIFT` with the raw
  payload; unknown new fields are ignored.
- **Config refuses to boot half-configured.** The sidecar exits `78` (`EX_CONFIG`) on any bad
  or missing required value rather than answering requests it cannot honour. `IG_USERNAME`
  and `IG_PASSWORD` must be set together — the failure mode the onboarding bug below trips.
- **Loopback only, shared-secret authenticated.** The sidecar refuses a non-loopback
  `IG_SERVICE_HOST`, and `IG_SERVICE_TOKEN` (min 16 chars) is the only thing between a local
  process and the Instagram session. The session blob is written mode 0600.

## Open, not verified end to end

- **The sidecar-won't-start onboarding bug** (`evidence/10-onboarding-bugs.md`, BUG 1): `kai
  kit init`'s masked `IG_PASSWORD` prompt returned empty on a real TTY, so `.env.local` was
  written with `IG_PASSWORD=` (length 0). The sidecar then refuses to start —
  `"IG_USERNAME and IG_PASSWORD must be set together"`, exit 78 `EX_CONFIG` — and launchd
  crash-loops it, so port 8765 never comes up and IG sync is dead for every buyer. The root
  cause is in the CLI prompt (`src/cli/kai.ts`), not the sidecar; `config.py` is proven
  correct. This is a hard blocker for the IG half of the product.
- **No live sync has been proven end to end.** Per
  `documents/architect/shared/packaging-and-release.md`, a Kit install has not been shown to
  complete a live Instagram sync with real credentials; the buyer test that exercised the
  installer left the Instagram fields blank.
- **Live-only paths are untested offline** (`services/ig/README.md`): a real `/login`,
  challenge or 2FA round-trip, a genuine Instagram-issued rate limit, and a real CDN asset
  download. The SMS-preference challenge branch in particular has never run against Instagram.
