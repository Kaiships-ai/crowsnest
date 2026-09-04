# ig-sync: concept brief

`documents/architect/core-components/ig-sync/`

Status: shipped and in daily use, blocked for buyer installs by an onboarding bug that writes an empty `IG_PASSWORD`.

## 1. What it is

ig-sync is a localhost-only Python service (`services/ig/`) built on `instagrapi`, holding one long-lived authenticated Instagram session that the Next.js app talks to over HTTP, authenticated with a shared secret (`IG_SERVICE_TOKEN`). It is the only thing in crowsnest that ever logs in to Instagram or sees an Instagram CDN URL. For each tracked channel it syncs the profile plus every post from the last 30 days (`LOOKBACK_DAYS`, a hard cap of `MAX_ITEMS_PER_SYNC` per run), downloads thumbnails and, on demand, video, and writes them into the app's own storage so the app never renders a signed Instagram URL that will expire within hours. Carousels are stored as one video row with child rows, not as separate posts. A sync that finds a post no longer on the source soft marks it deleted rather than removing the row, so anything built on top of it (a saved post, a planned post) degrades gracefully instead of losing its link outright. ig-sync is the only writer of the `videos` table.

A run works multiple channels through a bounded worker pool sized by the `syncConcurrency` setting, not a strict one-at-a-time loop. The sidecar still serializes every real Instagram call behind one process-global lock, so raising that pool never produces concurrent Instagram traffic; it only overlaps one channel's local work (thumbnail download, DB writes, scoring) with the next channel's fetch. An interrupted deep crawl, one stopped by the item cap, a cancel, or a channel error, persists where it stopped on the `channels` row and resumes from there on the next run instead of restarting from the newest post.

## 2. Why it exists

crowsnest's whole purpose is analyzing other creators' reels, accounts crowsnest does not own and cannot get authorized for. Instagram's official Graph API only exposes another account's coarse public counters, not the view and play counts the product is built around, and the Basic Display API that once served this need was shut down in 2024. instagrapi, which drives Instagram's private mobile API, is therefore the only path that can enumerate an arbitrary creator's media at all, chosen with the trade off stated plainly rather than hidden: it is against Instagram's Terms of Service, and the logged in account can be rate limited, challenged, or permanently banned, which is why it is meant to run against a throwaway account, not one the user cares about. A previous provider (Apify) was replaced entirely by this sidecar so the product does not depend on a paid third party scraping vendor either.

Being Python while the app is Node is a real service boundary decision, not an accident: a long lived sidecar process is the only shape where one warm authenticated session, request pacing, and recovering from an invalidated session are real code paths, rather than every call paying a fresh login's risk of getting the account flagged.

## 3. Key concepts

| Concept | Description |
| --- | --- |
| Session | The one long lived, authenticated `instagrapi` client the sidecar holds behind a lock (`session.py`, `SessionManager`). Login, two factor, and challenge handling all feed this one client; there is never more than one. |
| Sidecar | The Python FastAPI process in `services/ig/`, bound to loopback only, that owns Instagram authentication and every private API call. The Next.js app never talks to Instagram directly. |
| Shared token | `IG_SERVICE_TOKEN`, sent as the `X-IG-Token` header on every sidecar call. It is the only thing standing between a local process and the live Instagram session; a missing or wrong token is refused. |
| Burner account | The Instagram account the sidecar logs in as, set by `IG_USERNAME`/`IG_PASSWORD` in `.env.local`. It is meant to be a throwaway account, never the user's own, because it can be rate limited, challenged, or banned. |
| Lookback window | The 30 day (`LOOKBACK_DAYS`) boundary a sync walks back to, newest post first. It is a date, not a count; `MAX_ITEMS_PER_SYNC` (200) is only a safety cap, and the walk stops only after 3 consecutive out of window items so pinned posts do not end it early. |
| Incremental walk | A repeat sync of an already synced channel stops paging as soon as a page comes back with zero new posts, since Instagram returns newest first and everything below is already known; the run stops with reason `upToDate`. This early stop only fires while the channel's last full walk (`lastFullSyncAt`) is within `syncMetricsFreshnessHours` (default 12, env `SYNC_METRICS_FRESHNESS_HOURS`, DB overridable), so no in window post's view or like snapshot goes stale past that window, and never fires on a resumed run. Because the sidecar holds one session and sleeps 1 to 3s between every call, fewer requests, not more workers, is what shortens a sync; the deterministic benchmark measures a repeat sync at 9 requests instead of 37, a 76 percent cut. |
| Outlier score input | The view, like, comment, and share counts a sync writes onto each `videos` row. `recomputeChannelScores` reads them to compute a post's score against its own channel's baseline; ig-sync produces the numbers the feed's ranking is built on, it does not compute the ranking itself. |
| Concurrency knob | `syncConcurrency` (env `SYNC_CONCURRENCY`, DB-overridable, default 2, clamped 1 to 16) bounds how many channels a sync run works on at once. The sidecar's own process-global lock still serializes every real Instagram call, so this only overlaps a channel's local work with the next channel's fetch. At 1 a run is the old sequential walk. |
| Resume cursor | Four columns on `channels` (`syncCursor`, `syncBoundary`, `syncCursorAt`, `syncCursorRunId`) that let an interrupted deep crawl continue where it stopped instead of restarting newest first. Set on an item cap, a cancel, or a channel error; cleared once a run fully enumerates the lookback window. A cursor older than the lookback window is ignored, and the next run does a fresh walk. |
| Error class | `classifyIgError` sorts an `IgErrorCode` into `transient`, `auth`, `challenge`, or `fatal`. Only `transient` is retried; `auth`/`challenge` become a gap the UI can offer a re-login on instead of silently retrying. |

## 4. How it fits in the system

ig-sync sits between Instagram and the app's own SQLite database. Nothing else in crowsnest talks to Instagram, and nothing else writes the `videos`, `video_children`, `video_snapshots`, or `channel_snapshots` tables. Everything downstream, the feed, analyze, remix, the vault, planned posts, reads what a sync already wrote and never calls the sidecar itself. When the sidecar is down, those surfaces keep working on the videos already there; the feed simply goes stale rather than erroring. A sync is a background job, not a request that returns: the user starts it (or it runs on its own) from the channels board, a channel's page, or settings, and its status lives in the `sync_jobs` row so a reload or another tab reads the same run. The shell's failure strip is where a sync's verdict surfaces app wide.

## 5. Dependency map

### Upstream (what ig-sync depends on)

| Dependency | Why |
| --- | --- |
| SQLite database via drizzle (`src/server/db`) | Every table ig-sync reads and writes: `channels`, `videos`, `video_children`, `media_assets`, `video_snapshots`, `channel_snapshots`, `sync_jobs`. |
| App settings (`app_settings` table, DB over env over default) | Lookback days, item cap, retry counts, and the view count enrichment budget; a change takes effect on the next sync without a restart. |
| Next.js server actions and `after()` | The detached execution shape a sync needs so a browser POST does not hold open for a minutes long run. |
| `.env.local` credentials | `IG_USERNAME`, `IG_PASSWORD`, and `IG_SERVICE_TOKEN`, read by the sidecar process alone; the app never sees the burner account's password. |
| launchd, via `src/cli/service-darwin.ts` and `scripts/ig-service.sh` | Keeps the sidecar process (and the Next server) alive across a reboot. |

### Downstream (what depends on ig-sync)

| Consumer | What it reads |
| --- | --- |
| feed | The videos and outlier scores a sync wrote; the feed's only source of new posts. |
| analyze | Operates on the videos and downloaded thumbnails a sync produced. |
| remix, the vault, planned posts | Reference videos and thumbnails a sync wrote; a soft delete cascades into a deleted saved post and a nulled planned post link. |
| channels board and channel detail | Reads the last stored sync per channel, not a live call. |
| Shell failure strip (`shared/status-and-failures.md`) | Classifies the latest sync into local service down, session expired, cooling down, no network, partial sync, or sync failed. |
| Background jobs (`shared/background-jobs.md`) | Owns the user visible model of the sidecar sync as one of its two background job types. |

### External

| Dependency | Role |
| --- | --- |
| instagrapi (pinned `==2.18.9`) | The Python library that drives Instagram's private mobile API; the only thing that can enumerate an arbitrary creator's media. |
| Instagram itself | The one external service reached, only through the sidecar; an unofficial private API, against Instagram's Terms of Service. |
| FastAPI and uvicorn | The sidecar's HTTP surface. |
| launchd (macOS) | The service manager that restarts the sidecar and keeps it running across reboots. |

## 6. Boundaries

ig-sync owns Instagram authentication (including two factor and challenge handling), fetching a channel's profile and recent media, downloading the assets it needs into the app's own media storage, and reporting a typed error (never a silent empty result) when it cannot reach Instagram or its own session has gone stale. It does not own the burner account's credentials reaching the app: `IG_USERNAME` and `IG_PASSWORD` are read by the sidecar process only and are never sent to or rendered by the Next.js app. It does not cover the user's own channel: a separate, proposed Graph API path for that account was designed but never built, is a different identity entirely, and by design must never share code or an environment variable prefix with this sidecar. Whether a given sync run actually completes against a live Instagram account with real credentials is called out as unverified in [packaging and release](../../shared/packaging-and-release.md); the buyer test that exercised the Kit installer left the Instagram fields blank.
