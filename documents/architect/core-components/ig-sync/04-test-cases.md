# ig-sync: test cases

How to run these: the sidecar must be up. From the repo root, `npm run ig:service` starts it
(the wrapper loads `.env.local` and execs the module); it binds `127.0.0.1:8765` only.
`.env.local` needs `IG_SERVICE_TOKEN` (≥16 chars, shared with Node) and, for anything past
`/health`, a real `IG_USERNAME`/`IG_PASSWORD` for a **burner** account — never one you care
about; the account can be challenged or banned. Do the first login with the `curl` sequence
in `services/ig/README.md` (`/login`, then `/two-factor` or `/challenge/resolve` as asked).
For the app side, start the dev server and open `http://localhost:3001`. Offline unit tests
run with `uv run pytest` in `services/ig/` (150+, no network) and the Node suite covers
`sync-engine`, `ig/client`, and `sync-actions`. Cases marked **live** need a real Instagram
account and cannot be exercised offline; they are the burner-holder's steps.

## Sidecar boot and health

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IGSYNC-01 | P1 | env | The sidecar refuses to start on a missing/empty required value, exit 78 `EX_CONFIG`, rather than booting half-configured. | `.env.local` with `IG_SERVICE_TOKEN` unset or under 16 chars. | 1. `npm run ig:service`. | The process exits 78 with a message naming the bad variable; 8765 never opens. | not run |
| IGSYNC-02 | P1 | env | (BUG 1, onboarding) An **empty** `IG_PASSWORD` with a set `IG_USERNAME` refuses to start — "IG_USERNAME and IG_PASSWORD must be set together", exit 78, launchd crash-loops it. | `.env.local` with `IG_USERNAME=burner` and `IG_PASSWORD=` (length 0), the exact state `kai kit init` wrote. | 1. Start the sidecar (or `kai up`).<br>2. Check port 8765 and the log. | Record what happens: the sidecar exits 78, 8765 never comes up, and every sync reads local-service-down. This is the shipped onboarding blocker (`evidence/10-onboarding-bugs.md`); the fix is in `src/cli/kai.ts`, not the sidecar. (confirmed bug) | not run |
| IGSYNC-03 | P1 | token | `/health` answers when NOT logged in (HTTP 200, `logged_in: false`) and is Node's liveness probe; `can_login` reports credentials-present separately from `logged_in`. | Sidecar up with a valid token, no session yet. | 1. `curl -s localhost:8765/health -H "X-IG-Token: $T"`. | HTTP 200 with `logged_in: false`, and `can_login` true only when both `IG_USERNAME` and `IG_PASSWORD` are set. | not run |
| IGSYNC-04 | P1 | token | Every data route requires `X-IG-Token`; a missing or wrong token is `IG_UNAUTHORIZED` (401), and a mismatch between the two processes surfaces as `IG_SERVICE_UNAUTHORIZED` on the Node side, not an Instagram error. | Sidecar up. | 1. Call `/profile?handle=x` with no token, then a wrong token. | 401 `{"error":{"code":"IG_UNAUTHORIZED"...}}` both times; the app maps a 401 to `IG_SERVICE_UNAUTHORIZED`. | not run |
| IGSYNC-05 | P2 | host | A non-loopback `IG_SERVICE_HOST` is refused at boot; the service binds loopback only. | `IG_SERVICE_HOST=0.0.0.0`. | 1. Start the sidecar. | It refuses at boot with the loopback-only message. | not run |
| IGSYNC-06 | P2 | token | With the sidecar stopped, an app-side call fails `IG_SERVICE_DOWN` (unreachable), never an empty list; a timeout is `IG_NETWORK`. | Sidecar not running. | 1. Trigger a sync from the app. | The run fails and the strip reads local-service-down; no empty result is returned. | not run |

## Add and track a channel

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IGSYNC-07 | P1 | live | The add-channel dialog resolves the profile once and writes a channel with display name, avatar, and follower count; the handle is normalised (`@name` or `name`). | Sidecar logged in. | 1. Open the add-channel dialog, enter `@creator`, confirm. | The channel appears on the board with its real profile; the sidecar was asked exactly once. | not run |
| IGSYNC-08 | P1 | mouse | A pasted profile URL is rejected as a typo, not silently accepted or prefixed. | — | 1. Enter `https://www.instagram.com/creator/` in the strict add-channel dialog. | The dialog rejects it with the IgError message; no broken channel row is written. | not run |
| IGSYNC-09 | P2 | live | The strict add-channel path throws on an unresolvable handle and writes nothing; the lenient first-run path writes a thin row with `syncError` set so onboarding can collect handles before login. | Sidecar reachable but the handle does not exist. | 1. Add a nonexistent handle from the dialog.<br>2. Add one during first-run onboarding. | Dialog: nothing written, reason shown. Onboarding: a thin channel row with `syncError`. | not run |
| IGSYNC-10 | P2 | live | Re-adding a previously removed channel revives the same soft-deleted row rather than failing on the unique index; `trackedSince` is preserved. | A soft-removed channel. | 1. Add the same handle again. | The row is un-deleted and refreshed; it reappears on the board. | not run |

## Sync a channel

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IGSYNC-11 | P1 | live | A sync walks newest-first back to the 30-day `LOOKBACK_DAYS` boundary; the stop is a date, and `MAX_ITEMS_PER_SYNC` (200) is only a cap. | A tracked channel with posts spanning >30 days. | 1. Start a sync and let it finish. | Posts inside the window are created; `stop_reason` is `lookback` (or `exhausted`), not `cap`, on a normal channel. | not run |
| IGSYNC-12 | P1 | live | Pinned posts do not stop the walk early; the boundary stops only after 3 consecutive out-of-window items, and a pinned item never counts toward the streak. | A channel with pinned posts older than the window (e.g. one pinning old reels) plus recent in-window posts. | 1. Sync it. | The recent in-window posts are all created; `itemsSeen` is not 0. (Guards the 8-lost-posts regression.) | not run |
| IGSYNC-13 | P1 | live | A carousel is one `videos` row with `video_children` rows in order; children inherit the parent's date and caption. | A channel with a carousel post. | 1. Sync it.<br>2. Inspect the carousel's row and children. | One video row, N child rows keyed on position; no child is a separate top-level post. | not run |
| IGSYNC-14 | P1 | seed | A second consecutive sync of the same channel is idempotent: `itemsCreated` = 0, existing rows updated in place. | A channel already synced once. | 1. Sync it again. | `itemsCreated` is 0; no duplicate videos or children. | not run |
| IGSYNC-15 | P1 | live | View-count enrichment reads the real play count from the per-reel `/media-stats` call, because the listing endpoint returns 0 for other creators' reels; it runs before scoring. | `viewCountEnrichPerChannel` > 0, a channel with reels. | 1. Sync it.<br>2. Read the newest reels' view counts and outlier scores. | The reels carry non-zero counts and scores that reflect them, in the same sync. | not run |
| IGSYNC-16 | P1 | seed | A zero or withheld metric is treated as "not disclosed" and never overwrites a stored count. | A video already carrying a real view count; a sync where the listing returns 0 for it. | 1. Re-sync. | The stored count survives; it is not zeroed. (Guards the 2.27M→0 regression.) | not run |
| IGSYNC-17 | P1 | live | A fully-enumerated window soft-marks in-window posts that did not come back, cascading their saved posts and nulling planned-post links; a run that saw zero items refuses to. | A channel with a saved post whose source was deleted on Instagram; separately, a channel whose fetch returns empty. | 1. Sync the first.<br>2. Force an empty fetch on the second. | First: the missing post is soft-deleted, its saved post gone, a planned post's link null. Second: nothing soft-deleted, logged as refusing to read empty as deletions. | not run |
| IGSYNC-18 | P2 | seed | Scores are computed against each channel's own baseline and written on every sync; a settings change to scoring takes effect on the next sync. | Two channels of different sizes. | 1. Sync both.<br>2. Compare outlier scores. | Each channel's scores are relative to its own median, not a global one. | not run |
| IGSYNC-19 | P2 | seed | Only thumbnails download during a sync; video is on-demand on first play unless `EAGER_VIDEO_DOWNLOAD` is set. Assets are content-addressed and deduped. | Default config. | 1. Sync a channel.<br>2. Check the media store and a second sync's asset counts. | Thumbnails present, no video files; identical re-downloads dedupe (`deduped: true`). | not run |

## Concurrency, cancel, and failure

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IGSYNC-20 | P1 | seed | The detached start returns a job id the moment the lock is won; a second overlapping start is refused with `SYNC_ALREADY_RUNNING`, not run alongside. | A running sync. | 1. Start a library sync.<br>2. Start another sync covering an overlapping channel. | The first returns a job id fast; the second is refused with its code. | not run |
| IGSYNC-21 | P1 | seed | Cancel is co-operative: the run stops at the next page/channel boundary keeping committed work, and skips the enrichment and analyze/idea passes; `stop_reason` is `cancelled`. | A running multi-channel sync. | 1. Click Stop mid-run. | The run ends at a boundary; committed videos stay; status is `partial` if work was left, `success` if the cancel arrived too late. | not run |
| IGSYNC-22 | P1 | seed | Status means what it says: `partial` requires a survivor; every channel failing is `failed`, carrying the first gap's code. | A run where every channel errors, and one where one of two errors. | 1. Force both scenarios. | All-fail → `failed` with a code; one-of-two → `partial` with the survivor counted. | not run |
| IGSYNC-23 | P2 | seed | A stale `running` row with no heartbeat is reaped to `failed`/`SYNC_ABANDONED`, releasing the lock and raising an SLA notification; a live run that finishes after being reaped records counters but does not overwrite the reaper's verdict. | A `running` row with an old `heartbeat_at`. | 1. Start a run; simulate a stale heartbeat and a reaper pass. | The stale row is reaped; a finishing run logs `sync.finalize.reaped` rather than resurrecting `success`. | not run |
| IGSYNC-24 | P2 | live | An expired session mid-run triggers exactly one re-login and one retry; a second failure is `IG_AUTH_REQUIRED` and the channel becomes a gap that says "reconnect in settings". | A session invalidated during a call. | 1. Sync while the session is stale. | One recovery attempt, logged; on a second failure the channel gaps with the reconnect recovery. | not run |
| IGSYNC-25 | P2 | live | A rate limit returns `IG_RATE_LIMITED` with Instagram's own `retry_after_sec`; the engine backs off up to 5 min or fails the channel, and a cooldown deadline persists next to the session file across a restart. | A burner Instagram issues a throttle. | 1. Sync until throttled.<br>2. Restart the sidecar. | The strip shows cooling-down (with a countdown only if Instagram supplied one); the restart does not immediately hammer Instagram. | not run |
| IGSYNC-26 | P2 | seed | Per-level failure isolation: a dead thumbnail costs one asset, a malformed post costs one item, and only a profile/media call failure fails the whole channel. | A channel with one unwritable post and one dead thumbnail. | 1. Sync it. | `assetsFailed`/`itemsFailed` increment; the channel still finishes and other posts land. | not run |

## Drift and mapping

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IGSYNC-27 | P2 | unit | A required field (`pk`, `code`, `taken_at`, `media_type`) missing or mistyped raises `IG_DRIFT` with the raw payload; an unknown new field is ignored; a present-null optional count is not drift. | `uv run pytest` and the Node mapper tests. | 1. Run the offline suites. | Drift cases raise `IG_DRIFT`; unknown fields pass; a present null follower count degrades to null, not a failure. | not run |
| IGSYNC-28 | P3 | unit | A routing 404 from the sidecar is `IG_ROUTE_NOT_FOUND`, distinct from a deleted media's `IG_NOT_FOUND`, so an old sidecar is not mistaken for a run of deleted posts. | Call a path the running sidecar does not serve. | 1. Hit a nonexistent route with a valid token. | `IG_ROUTE_NOT_FOUND`, not `IG_NOT_FOUND`. | not run |

Not checkable by hand (or offline):

- Any live Instagram behaviour — a real `/login`, a challenge or 2FA round-trip, a genuine
  Instagram-issued rate limit, real `/profile` and `/medias` payloads, and a real CDN asset
  download. These need the burner credentials and are unverified end to end per
  `documents/architect/shared/packaging-and-release.md`; the buyer test left the Instagram
  fields blank.
- Whether a Kit-installed sidecar under launchd actually completes a live sync — untested,
  and currently blocked by the empty-`IG_PASSWORD` onboarding bug (IGSYNC-02).
- The SMS-preference challenge branch in the sidecar has never run against Instagram.
- Whether a reaper and a finishing live run reliably race in production, as opposed to the
  seeded/simulated form in IGSYNC-23.
