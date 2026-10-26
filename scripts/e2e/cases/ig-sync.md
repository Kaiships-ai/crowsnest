# Instagram sync cases

## Built features

ig-sync is what fills the feed. The user does not fetch a post one at a time; they track a channel, a sync runs, and the channel's recent posts, reels, videos, photos, and carousels, arrive as videos with their view, like, and comment counts and an outlier score computed against that channel's own baseline. Everything downstream (the feed, analyze, remix, plan) runs on the videos a sync wrote; ig-sync is the only writer of the `videos` table.

Instagram sync has no screen of its own. Its edges are the server actions in `src/server/actions/sync-actions.ts`, the MCP sync tools (`crowsnest_sync_selected`, `crowsnest_sync_status`, `crowsnest_sync_cancel`), and the automatic scheduler; `getFailureStrip` classifies a sync's verdict. The web app's channels board, add channel dialog, and Settings sync controls are retired with the web app; a Lead Studio board replaces them. A sync only works while the sidecar is running; with it down every sync reads local service down and no new videos arrive.

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Track a channel | Add an Instagram handle; the sidecar resolves the profile | ● | `services/sync-engine.ts` (addChannel) | none |
| 3 | Sync a channel's posts | Page recent media, upsert videos, snapshot metrics, rescore | ● | `services/sync-engine.ts` (runSync) | no live sync proven through a Kit install |
| 4 | Backfill blank view counts | Re-read the real play count via `/media-stats` where the listing returned zero | ● | `services/sync-engine.ts` (startViewCountBackfillAction) | none |
| 5 | Sync several channels at once | Start one sync covering a chosen set of channel ids | ● | `actions/sync-actions.ts` (startSyncAction), `crowsnest_sync_selected` | none |
| 6 | Manage Instagram accounts | Add accounts with their own session, cooldown, and proxy or device identity; assign channels stickily; the scheduler isolates one account's cooldown from the others | ◐ | `services/accounts.ts`; `actions/account-actions.ts` | live parallel-across-accounts execution needs per-account credentials (see multi-account.md) |
|  | TikTok / YouTube Shorts ingestion | Multi-platform tracking; the `platform` column is reserved | ○ | no backend yet | roadmap |

### Track a channel

#### Who uses it

The user or an agent, through `addChannelAction`.

#### What it does

The user types a handle (`@creator`, or bare `creator`), and confirms. The handle is normalized, and the sidecar is asked for the profile once; a resolvable handle writes a channel row with its display name, avatar, and follower count, and it appears on the Đối thủ board. Tracking a channel does not sync it: nothing runs until a sync is started separately, by the user or by the automatic pass where enabled.

#### How to access it

`addChannelAction` in `src/server/actions/sync-actions.ts`. The web app's add channel dialog and first run flow that called it are retired.

#### Business rules

- The handle is normalized before the sidecar is asked; a pasted profile URL (for example `https://www.instagram.com/creator/`) is rejected as a typo, not silently accepted or reformatted.
- The strict add path writes nothing for an unresolvable handle and returns the reason.
- Re adding a previously removed (soft deleted) channel revives the same row rather than failing on the unique index; `trackedSince` is preserved.
- Only tracked, non removed Instagram channels are ever synced; a soft removed channel is skipped so it does not resurrect on its own.
- TikTok and YouTube Shorts were never synced by the backend; the `platform` column stays in the schema for a possible future second source.

#### Limitations

- Only Instagram is ingested. TikTok/YouTube Shorts tracking is roadmap, not built.
- Adding a channel needs the sidecar reachable and logged in; with the sidecar down or unauthenticated, the add fails rather than writing a channel that can never sync.

#### User guide

Add a handle through `addChannelAction`, with or without the `@`. crowsnest checks that the handle is real before adding it, so a typo or a pasted profile link is rejected. The channel's posts arrive the next time a sync runs.

### Sync a channel's posts

#### Who uses it

The user or an agent, starting a sync through `startSyncAction` or `crowsnest_sync_selected`; or the automatic pass, where enabled.

#### What it does

A sync walks a channel newest first back through the 30 day lookback window, downloads each post's thumbnail into the app's own storage, records the metrics, and computes outlier scores. A sync is a background job, not a request that returns: the user starts it and can leave, its status lives in the `sync_jobs` row, so any caller reads the same run, and progress is readable through `getSyncProgressAction` or `crowsnest_sync_status` while it runs. On finish the job row carries a status and counts: `success` means the window was walked and at least one channel survived, `partial` means a survivor plus at least one failed channel (or a cancel that left work undone), `failed` means every channel failed. A run that fully enumerated a channel's window also soft marks posts that were in window but did not come back; that removal cascades, a saved post is deleted with it, a planned post keeps the plan but the link goes null, but a run that saw zero items refuses to read an empty fetch as deletions.

#### How to access it

`startSyncAction` (per channel ids, or the whole library with none), `crowsnest_sync_selected`, or automatic scheduling, where the interval setting is non zero. Progress reads through `getSyncProgressAction`; the result shows in the feed read and in `getFailureStrip`.

#### Business rules

- The lock is what enforces one run per channel: a second start that would overlap an in flight run is refused with "a sync is already running", not run alongside.
- The run works channels through a bounded worker pool (the `syncConcurrency` setting, default 1, clamped 1 to 16), not one channel at a time. Only one Instagram account is ever making requests either way, because the sidecar itself serializes every real call behind its own lock; the pool just lets one channel's local work (thumbnails, DB writes, scoring) overlap the next channel's fetch instead of waiting on it. At `syncConcurrency` 1 a run behaves exactly like the old one-channel-at-a-time walk.
- A channel's numbers move only from a complete pull. A walk cut after a page landed, by a failed call or a cancel, stores nothing (no profile numbers, posts, or snapshots), and the job is `partial` with the gap's reason and what was missing.
- A deep crawl stopped by the item cap resumes from a saved cursor on its next run instead of restarting from the newest post. A cancel or channel error saves no cursor, since nothing from that walk was stored. A cursor older than the lookback window is treated as stale and the next run starts fresh. Soft delete is skipped on a resumed run, since it only walked the remainder below its cursor, not the whole window. A cap that trips on the run's very first page (which has no request cursor of its own to re-fetch that page with) falls back to the page's own next-page cursor instead of stranding it, so a pathologically low `maxItemsPerSync` still makes forward progress on the next run rather than re-capping the same head of the page forever.
- A repeat sync of an already synced channel stops paging as soon as a page comes back with zero new posts, since Instagram returns newest first and everything below is already known; the run stops with reason `upToDate` instead of walking the rest of the window. This early stop is only allowed while the channel's last full walk (`lastFullSyncAt`) is within `syncMetricsFreshnessHours` (default 12 hours, env `SYNC_METRICS_FRESHNESS_HOURS`, DB overridable), the guarantee that no in window post's view or like snapshot goes stale for longer than that window; once the window lapses, the next sync walks the whole lookback range again and refreshes every snapshot. It never fires on a resumed run, which is deliberately re walking known posts to reach the un fetched ones below its cursor.
- Failure is isolated and counted at each level: a dead thumbnail costs one asset, a malformed post costs one item, and only an upstream failure on the profile or media call fails the whole channel, recorded as a gap with the channel's handle, the error code, and that code's class (transient, auth, challenge, or fatal).
- Pinned posts do not stop the walk early: they come back first and out of chronological order, so the lookback boundary stops only after 3 consecutive out of window items, and a pinned item never counts toward that streak.
- Carousels are one `videos` row with `video_children` rows in payload order; a child inherits the parent's date and caption rather than inventing its own.
- View counts need a second call: the listing endpoint returns `play_count: 0` for other creators' reels, so the real number comes from a per reel `/media-stats` call in the enrichment pass, off unless a per channel budget is set, and it runs before scoring so the number reaches the score in the same sync.
- A zero is "not disclosed", never a real zero: persisting a literal zero once turned a 2.27M view reel into 0 and would zero every outlier score, so a zero never overwrites a stored count.
- Only thumbnails download during a sync; the video file is fetched on first play (via a fresh `/resolve-media`) unless `EAGER_VIDEO_DOWNLOAD` is set, because Instagram's CDN URLs expire within hours.
- Stop is co operative: `cancelSyncAction` sets `cancel_requested` on the job row, the engine stops at the next page or channel boundary, keeps the channels already finished, stores nothing from the walk it cut, and does not kill the process, which would leave the lock held. A cancel deliberately skips the enrichment pass so no more authenticated requests are spent on a run nobody is waiting for.
- A session that goes stale mid run triggers exactly one re login using the stored settings and one retry; a second failure is `IG_AUTH_REQUIRED` and the channel becomes a gap that needs a reconnect.
- A rate limit mid run returns `IG_RATE_LIMITED` with the wait Instagram computed; the engine backs off (capped at 5 minutes) or fails the channel and lets the user retry.
- A stale `running` row with no heartbeat is reaped to `failed`/`SYNC_ABANDONED`, releasing the lock and raising an SLA notification, so a crashed run does not hold the lock forever.

#### Limitations

- The sidecar must be running. If it is unreachable (port 8765 down) a sync cannot run at all and `getFailureStrip` reads `service_down`.
- The feed reflects the last sync, not the live state of Instagram: with the sidecar not running, no new videos arrive and the feed goes stale rather than erroring.
- A sync is not undoable. Soft delete is reversible only in that a post reappearing on Instagram is un deleted rather than duplicated on a later sync; there is no per run rollback.
- No live sync has been proven to complete end to end with real credentials through a Kit install.
- The concurrency a given run actually used is not shown anywhere; `sync_jobs` does not persist it, so a reload cannot tell whether a run pipelined 2 channels or was pinned to 1 (tracked as a backlog issue).

#### User guide

Once a channel is tracked, its posts arrive through a sync. Start one through `startSyncAction` or `crowsnest_sync_selected`, or let the automatic schedule run it. The caller can leave once a sync starts; it keeps running and its progress is read from `sync_jobs`. When it finishes, the channel's recent posts are in the feed read, ranked by how far each beats that channel's own typical performance.

### Backfill blank view counts

#### Who uses it

The user or an agent, through `startViewCountBackfillAction`.

#### What it does

A backfill is the same sync job machinery pointed at every tracked channel's already stored posts that are missing a real view count, re reading them through the view count enrichment call instead of walking a new lookback window. It runs, is tracked, and can be watched the same way an ordinary sync is, through the `sync_jobs` row.

#### How to access it

`startViewCountBackfillAction` in `src/server/actions/sync-actions.ts`. The web app's Settings button is retired.

#### Business rules

- A backfill is a `sync_jobs` row like any other run; it refuses to start rather than queue while an ordinary sync is already running, so the two never race on the same lock.
- The same "zero is not disclosed" rule applies: a backfill never overwrites a stored count with a zero.

#### Limitations

- Needs the sidecar reachable and logged in, the same as any other sync.
- Only fills in counts that are genuinely missing; it does not re verify counts that already have a value.

#### User guide

If some posts are missing view counts, run `startViewCountBackfillAction`. It re checks Instagram for the real number on posts that never got one and updates them in place, tracked in `sync_jobs` like an ordinary sync.

### Sync several channels at once

#### Who uses it

The user or an agent, when they want to refresh a chosen set of channels in one action.

#### What it does

`startSyncAction(channelIds)` starts a single sync scoped to exactly those channel ids; `crowsnest_sync_selected` does the same over MCP. It is the same run a per-channel sync starts, only with more than one id, so progress, the lock, cancel, and the failure classification all behave the same. The web app's board selection mode is retired with the web app.

#### Business rules

- Only the given channel ids are synced; the selected path never falls back to a whole-library sweep.
- The same single-flight lock applies: if a sync is already running, the start is refused with "a sync is already running", rather than queued.

#### Limitations

- One sync runs at a time, so a selected start while a sync is in flight cannot start a second overlapping run.

### Manage Instagram accounts

#### Who uses it

An operator running more than one burner Instagram profile, who wants some channels synced under one identity and others under another.

#### What it does

Models each Instagram account as a first-class row with its own session, cooldown clock, and proxy or device identity. Channels are assigned to an account stickily, so a channel always syncs under the same identity. A sync groups the channels by account, and a paused or cooling-down account is skipped while every other account still runs, so one account's rate-limit never stops the others.

#### How to access it

`addAccountAction`, `setAccountStatusAction`, and `removeAccountAction` in `src/server/actions/account-actions.ts`. The web app's Accounts section is retired.

#### Business rules

- The first account added is the default; exactly one account is the default, enforced by a partial unique index. A channel with no assignment syncs under the default.
- A password is sealed by the Keychain keyed `IG_PASSWORD::<accountId>`, never on the account row.
- A cooldown or failure sets only that account's `cooldownUntil`; the scheduler (`planAccountSync`) skips it and runs the rest. Removing a non-default account unassigns its channels back to the default.

#### Limitations

- v0.3 runs accounts sequentially with isolated per-account state. It does not yet run live bounded-parallel traffic across separate sidecars; that needs live per-account credentials to verify and is the documented next step. Within an account, the sidecar's process-global lock still serializes every call.

#### User guide

Add an account with a label and username through `addAccountAction` (a password and proxy are optional). The first one becomes the default. Pause an account to skip it on the next sync, or remove a non-default one to send its channels back to the default. See [multi-account](../../../documents/architecture/data.md) for the operational detail and safety limits.

### Edge cases

- **The sidecar must start, or the whole feature is dark.** The sidecar exits 78 on a bad or half-set credential pair (`IG_USERNAME` without `IG_PASSWORD`) and launchd restarts it, so port 8765 never comes up and every sync reads local service down. `kai kit init` now refuses to write an unpaired credential, and `kai doctor` reports the pairing.
- **Only Instagram is ingested.** The backend never synced TikTok or YouTube Shorts; the `platform` column stays in the schema for a future second source.
- **Carousels are one post, not many.** A carousel is a single `videos` row with `video_children` rows in payload order; a child inherits the parent's date and caption rather than inventing its own.
- **Pinned posts do not stop the walk.** They come back first and out of chronological order, so the lookback boundary stops only after 3 consecutive out of window items and never counts a pinned item toward that streak. This exact bug once soft deleted 8 live posts.
- **Two callers or a double action on the same record.** Two callers can both try to start a sync; the database lock lets at most one win per overlapping scope, and the loser is told a sync is already running.
- **A post deleted from Instagram is not noticed instantly.** Soft delete only runs on a full walk (stop reason `lookback` or `exhausted`, not resumed); the incremental `upToDate` stop never soft deletes, since it never asked about most of the window. A post the creator removed from Instagram is caught on the channel's next full walk, which is at most `syncMetricsFreshnessHours` (default 12 hours) away, not on the sync that happens to run right after the deletion.
- **A resumed crawl only sees its own remainder.** A run that continues from a saved cursor walks only the posts below where the prior run stopped, never the ones above it, so it cannot tell which older in window posts vanished; soft delete is skipped on that run even if it finishes the window. A cursor left over from a long-abandoned crawl (older than the lookback window) is ignored and the next run starts fresh instead of resuming a boundary that no longer covers today's window.
- **A backing service fails mid action.** The sidecar going down mid run fails the outstanding call as `IG_SERVICE_DOWN` (one quick retry, since it may be mid restart); Instagram rate limiting or a network failure surface as their own codes on the affected channel's gap. Nothing partial is left half written; a post is upserted whole or its failure is counted and skipped.

## ig-sync: test cases

How to run these: the sidecar must be up. From the repo root, `pnpm run ig:service` starts it (the wrapper loads `.env.local` and execs the module); it binds `127.0.0.1:8765` only. `.env.local` needs `IG_SERVICE_TOKEN` (at least 16 chars, shared with Node) and, for anything past `/health`, a real `IG_USERNAME`/`IG_PASSWORD` for a burner account, never one you care about; the account can be challenged or banned. Do the first login with the `curl` sequence in `services/ig/README.md` (`/login`, then `/two-factor` or `/challenge/resolve` as asked). Offline unit and integration tests run with `uv run pytest` in `services/ig/` (150+, no network) and `vitest` for the Node suite, covering `sync-engine` (including the worker pool and cursor resume), `sync-batch`, `ig/errors`, `ig/client`, `sync-actions`, and `queries/runs` against a temporary SQLite database. Cases marked `live` in the Needs column need a real Instagram account and cannot be exercised offline; they are the burner-holder's steps.

Result markers: 🟢 ran and passed, 🔴 ran and failed, 🟡 blocked on a dependency the sandbox lacks (named). `not run` means the case is written but its verification has not run yet.

## 1. behavior

Retired with the web app (the add channel dialog, channels board, progress panel, failure strip, and Settings sync controls no longer exist): BEH-01 through BEH-08. Their server claims are covered in section 2: handle rejection and revive by ACTION-02, cancel by ACTION-13, the selected-scope lock by ACTION-12.

## 2. route and action

| ID | P | Layer | Claim | Setup | Call | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ROUTE-01 | P1 | API route (`services/ig/crowsnest_ig/app.py :: /health`) | `/health` answers when not logged in (HTTP 200, `logged_in: false`), and `can_login` reports credentials-present separately from `logged_in`. | Sidecar up with a valid token, no session yet. | `curl -s localhost:8765/health -H "X-IG-Token: $T"`. | HTTP 200 with `logged_in: false`; `can_login` is true only when both `IG_USERNAME` and `IG_PASSWORD` are set. | 🟢 covered by vitest (green) |
| ACTION-01 | P1 | server action (`src/server/actions/sync-actions.ts :: startSyncAction`) | With the sidecar stopped, the call fails `IG_SERVICE_DOWN` (unreachable), never an empty result; a timeout is `IG_NETWORK`. | Sidecar not running. | `startSyncAction()`. | The action returns an error result with `IG_SERVICE_DOWN`; no `sync_jobs` row is left `running`. | 🟢 covered by vitest (green) |
| ACTION-02 | P1 | server action (`src/server/actions/sync-actions.ts :: addChannelAction`) | Re-adding a previously removed channel revives the same soft-deleted row rather than failing on the unique index; `trackedSince` is preserved. | A soft-removed `channels` row for a handle. | `addChannelAction(handle)`. | The existing row is un-deleted and refreshed, not duplicated; `deletedAt` reads back null and `trackedSince` is unchanged. | 🟢 covered by vitest (green) |
| ACTION-03 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A sync walks newest-first back to the 30-day `LOOKBACK_DAYS` boundary; the stop is a date, and `MAX_ITEMS_PER_SYNC` (200) is only a cap. | live | A tracked channel with posts spanning more than 30 days. | `runSync({ channelIds: [id] })`. | Posts inside the window are created in `videos`; `stopReason` is `lookback` or `exhausted`, not `cap`, on a normal channel. | 🟢 covered by vitest (green) |
| ACTION-04 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | Pinned posts do not stop the walk early; the boundary stops only after 3 consecutive out-of-window items, and a pinned item never counts toward the streak. | live | A channel with pinned posts older than the window plus recent in-window posts. | `runSync({ channelIds: [id] })`. | The recent in-window posts are all created; `itemsSeen` is not 0. Guards the 8-lost-posts regression. | 🟢 covered by vitest (green) |
| ACTION-05 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A carousel is one `videos` row with `video_children` rows in order; children inherit the parent's date and caption. | live | A channel with a carousel post. | `runSync({ channelIds: [id] })`, then read the carousel's row and children. | One `videos` row, N `video_children` rows keyed on position; no child is a separate top-level post. | 🟢 covered by vitest (green) |
| ACTION-06 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A second consecutive sync of the same channel is idempotent: `itemsCreated` is 0, existing rows updated in place. | A channel already synced once. | `runSync({ channelIds: [id] })` a second time. | `itemsCreated` is 0; no duplicate `videos` or `video_children` rows. | 🟢 covered by vitest (green) |
| ACTION-07 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | View-count enrichment reads the real play count from the per-reel `/media-stats` call, because the listing endpoint returns 0 for other creators' reels; it runs before scoring. | live | `viewCountEnrichPerChannel` greater than 0, a channel with reels. | `runSync({ channelIds: [id] })`, then read `videos.viewCount` and `videos.outlierScore` for the newest reels. | The reels carry non-zero counts and scores that reflect them, written in the same sync. | 🟢 covered by vitest (green) |
| ACTION-08 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A zero or withheld metric is treated as "not disclosed" and never overwrites a stored count. | A video already carrying a real view count; a sync where the listing returns 0 for it. | `runSync({ channelIds: [id] })` again. | The stored count survives; it is not zeroed. Guards the 2.27M-to-0 regression. | 🟢 covered by vitest (green) |
| ACTION-09 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A fully-enumerated window soft-marks in-window posts that did not come back, cascading their saved posts and nulling planned-post links; a run that saw zero items refuses to. | live | A channel with a saved post whose source was deleted on Instagram; separately, a channel whose fetch returns empty. | `runSync` on each. | First: the missing post's `deletedAt` is set, its `saved_posts` row is gone, a `planned_posts` row's `sourceVideoId` reads null. Second: nothing soft-deleted. | 🟢 covered by vitest (green) |
| ACTION-10 | P2 | server action (`src/server/services/sync-engine.ts :: recomputeChannelScores`) | Scores are computed against each channel's own baseline and written on every sync; a settings change to scoring takes effect on the next sync. | Two channels of different sizes, each synced. | `recomputeChannelScores(channelId)` on each. | Each channel's `outlierScore` values are relative to its own median, not a global one. | 🟢 covered by vitest (green) |
| ACTION-11 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`) | Only thumbnails download during a sync; video is on-demand on first play unless `EAGER_VIDEO_DOWNLOAD` is set. Assets are content-addressed and deduped. | Default config. | `runSync({ channelIds: [id] })`, then a second run over the same channel. | Thumbnails present in `media_assets`, no video rows; identical re-downloads dedupe on `sha256`. | 🟢 covered by vitest (green) |
| ACTION-12 | P1 | server action (`src/server/actions/sync-actions.ts :: startSyncAction`, `cancelSyncAction`) | The detached start returns a job id the moment the lock is won; a second overlapping start is refused with `SYNC_ALREADY_RUNNING`, not run alongside. | A running sync. | `startSyncAction()` for a library sync, then again for an overlapping channel set. | The first returns a job id quickly; the second is refused with `SYNC_ALREADY_RUNNING`. | 🟢 covered by vitest (green) |
| ACTION-13 | P1 | server action (`src/server/actions/sync-actions.ts :: cancelSyncAction`) | Cancel is co-operative: the run stops at the next page/channel boundary, keeps finished channels, stores nothing from the cut walk, and skips the enrichment and analyze/idea passes; `stopReason` is `cancelled`. | A running multi-channel sync. | `cancelSyncAction(jobId)` mid-run. | The run ends at a boundary; finished channels' `videos` rows stay and the cut channel's do not; `status` is `partial` if work was left, `success` if the cancel arrived too late. | 🟢 covered by vitest (green) |
| ACTION-14 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | Status means what it says: `partial` requires a survivor or a channel whose pull was cut after a page landed; every channel failing before a page is `failed`, carrying the first gap's code. | A run where every channel errors, and one where one of two errors. | `runSync` over both scenarios. | All-fail returns `status: "failed"` with `errorCode` set; one-of-two returns `status: "partial"` with the survivor's videos counted. | 🟢 covered by vitest (green) |
| ACTION-15 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`, the reaper) | A stale `running` row with no heartbeat is reaped to `failed`/`SYNC_ABANDONED`, releasing the lock and raising an SLA notification; a live run that finishes after being reaped records counters but does not overwrite the reaper's verdict. | A `sync_jobs` row with `status: "running"` and an old `heartbeatAt`. | Simulate a stale heartbeat, run the reaper pass, then let the original run try to finalize. | The stale row is reaped to `failed`; the finishing run logs that it was reaped rather than overwriting `status` back to `success`. | 🟢 covered by vitest (green) |
| ACTION-16 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`) | An expired session mid-run triggers exactly one re-login and one retry; a second failure is `IG_AUTH_REQUIRED` and the channel becomes a gap that needs a reconnect. | live | A session invalidated during a call. | `runSync({ channelIds: [id] })` while the session is stale. | One recovery attempt is logged; on a second failure the channel's gap carries `IG_AUTH_REQUIRED`. | 🟢 covered by vitest (green) |
| ACTION-17 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`) | A rate limit returns `IG_RATE_LIMITED` with Instagram's own `retry_after_sec`; the engine backs off up to 5 minutes or fails the channel, and a cooldown deadline persists next to the session file across a restart. | live | A burner Instagram account throttled. | `runSync` until throttled, then restart the sidecar and try again. | The strip shows cooling-down (with a countdown only if Instagram supplied one); the restart does not immediately hammer Instagram again. | 🟢 covered by vitest (green) |
| ACTION-18 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`) | Per-level failure isolation: a dead thumbnail costs one asset, a malformed post costs one item, and only a profile/media call failure fails the whole channel. | A channel with one unwritable post and one dead thumbnail. | `runSync({ channelIds: [id] })`. | `assetsFailed`/`itemsFailed` increment by one each; the channel still finishes and other posts land. | 🟢 covered by vitest (green) |
| ACTION-19 | P2 | mapper (`src/server/ig/client.ts :: mapMedia`, `mapProfile`) | A required field (`pk`, `code`, `taken_at`, `media_type`) missing or mistyped raises `IG_DRIFT` with the raw payload; an unknown new field is ignored; a present-null optional count is not drift. | `uv run pytest` in `services/ig/` and the Node mapper tests. | Run the offline suites. | Drift cases raise `IG_DRIFT`; unknown fields pass; a present null follower count degrades to null, not a failure. | 🟢 covered by vitest (green) |
| ACTION-20 | P3 | API route (`services/ig/crowsnest_ig/app.py`) | A routing 404 from the sidecar is `IG_ROUTE_NOT_FOUND`, distinct from a deleted media's `IG_NOT_FOUND`, so an old sidecar is not mistaken for a run of deleted posts. | Sidecar up, valid token. | `curl` a path the running sidecar does not serve. | `IG_ROUTE_NOT_FOUND`, not `IG_NOT_FOUND`. | 🟢 covered by vitest (green) |
| ACTION-21 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A bounded worker pool (`syncConcurrency`) pipelines channels without producing concurrent Instagram traffic; every channel still completes, counters stay correct, and at `syncConcurrency` 1 the run is byte for byte the old sequential walk. | Several tracked channels, a stub `IgClient`. | `runSync({ concurrency: 2 })`, then `runSync({ concurrency: 1 })`. | Both runs finish with the same total counters and no cross-channel corruption; the `concurrency: 1` run processes channels in the same order the array was given. | 🟢 covered by vitest (green) |
| ACTION-22 | P1 | server action (`src/server/services/sync-engine.ts :: runSync`) | A sync stopped mid window by the item cap persists a resume cursor on `channels`; the next run continues from it instead of re-walking from the newest post, and re-fetches only the stopped page's own tail on a cap. | A channel with more posts than a deliberately small `maxItems`. | `runSync({ channelIds: [id], maxItems: N })` to force a `cap` stop, then `runSync({ channelIds: [id] })` again with the default cap. | The first run sets `channels.syncCursor`/`syncBoundary`/`syncCursorAt`/`syncCursorRunId`; the second run does not re-fetch page 1 from the top, all in-window posts eventually land, and soft-delete is skipped on the resumed run. | 🟢 covered by vitest (green) |
| ACTION-23 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`) | A resume cursor older than the lookback window is ignored; the next run does a fresh walk instead of resuming a boundary that no longer covers today's window. | A channel with a persisted cursor whose `syncCursorAt` predates the lookback window. | `runSync({ channelIds: [id] })`. | The run starts from page 1 with a freshly computed boundary, not the stale saved one. | 🟢 covered by vitest (green) |
| ACTION-24 | P2 | pure function (`src/server/ig/errors.ts :: classifyIgError`) | Every `IgErrorCode` maps to exactly one of `transient`/`auth`/`challenge`/`fatal`; a channel gap carries that class. | Offline unit test. | `classifyIgError(code)` over every `IG_ERROR_CODES` entry. | The retryable codes classify `transient`, credential codes classify `auth`, challenge/two-factor codes classify `challenge`, everything else classifies `fatal`. | 🟢 covered by vitest (green) |
| ACTION-25 | P2 | server action (`src/server/services/sync-batch.ts :: insertVideoSnapshots`, called from `runSync`) | A page's `video_snapshots` rows are written in one multi-row insert; a poison row in the batch falls back to inserting the page one row at a time so it costs one item, not the page. | A page of N items where one snapshot row cannot be inserted. | `runSync({ channelIds: [id] })`. | N-1 snapshot rows land in one batched insert's worth of work; the poison row's own item is counted in `itemsFailed`, and the rest of the page's videos are unaffected. | 🟢 covered by vitest (green) |
| ACTION-26 | P2 | query (`src/server/queries/runs.ts :: getLastRunHealth`) | The most recent sync run's health, excluding backfill rows, with honest nulls when the database has never synced. | A fresh database with no `sync_jobs` rows; separately, a database with one finished sync run. | `getLastRunHealth()`. | Fresh database: `lastStatus` is null and every timing is null, not a fabricated zero-duration success. Finished run: the real status, timings, and counts come back; a running view-count backfill row is not returned as "the last sync". | 🟢 covered by vitest (green) |
| ACTION-27 | P2 | server action (`src/server/services/sync-engine.ts :: runSync`, `storedThumbs`) | A re-sync fetches only thumbnails the app does not hold yet: known posts and carousel slides keep their stored thumbnail, and a thumbnail that failed on the previous sync is retried. | A channel synced once with one post's thumbnail download failing and one carousel with two slides. | Sync the same page again with a client that records every download. | The second sync downloads only the avatar and the one thumbnail that failed before; all three posts count as updated. | 🟢 covered by vitest (green) |

Not checkable by hand:

- Any live Instagram behavior beyond what a burner account can exercise on demand: a real `/login`, a challenge or two-factor round trip, a genuine Instagram-issued rate limit, real `/profile` and `/medias` payloads, and a real CDN asset download. These are unverified end to end per `documents/architect/shared/packaging-and-release.md`; the buyer test left the Instagram fields blank.
- Whether a Kit-installed sidecar under launchd actually completes a live sync, untested, and currently blocked by the empty-`IG_PASSWORD` onboarding bug.
- The SMS-preference challenge branch in the sidecar has never run against Instagram.
- Whether a reaper and a finishing live run reliably race in production, as opposed to the seeded/simulated form in ACTION-15.

## 3. browse-e2e

Retired with the web app: E2E-01 through E2E-08. No browser journey exists until a Lead Studio board is built.

## 4. security-lite

| ID | P | Threat | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | P1 | Secret handling | The sidecar refuses to start on a missing or empty required config value, exit 78 `EX_CONFIG`, rather than booting half-configured. | `.env.local` with `IG_SERVICE_TOKEN` unset or under 16 chars. | 1. `pnpm run ig:service`. | The process exits 78 with a message naming the bad variable; port 8765 never opens. | 🟡 blocked: terminal-only, requires starting the sidecar process with a broken config; out of scope for a browser QA pass and the sidecar's current state must not be changed |
| SEC-02 | P1 | Secret handling | (confirmed bug) An empty `IG_PASSWORD` with a set `IG_USERNAME` refuses to start, "IG_USERNAME and IG_PASSWORD must be set together", exit 78, and launchd crash-loops it. | `.env.local` with `IG_USERNAME=burner` and `IG_PASSWORD=` (length 0), the exact state `kai kit init` wrote. | 1. Start the sidecar (or `kai up`).<br>2. Check port 8765 and the log. | The sidecar exits 78, port 8765 never comes up, and every sync reads local-service-down. This is the shipped onboarding blocker; the fix is in `src/kai-cli/kai.ts`, not the sidecar; `config.py` is proven correct. | 🟡 blocked: terminal-only, requires restarting the sidecar with a specific `.env.local`; out of scope for a browser QA pass |
| SEC-03 | P1 | Sidecar shared token | Every data route requires `X-IG-Token`; a missing or wrong token is refused, and a mismatch between the two processes surfaces on the Node side as its own error, not an Instagram error. | Sidecar up. | 1. Call `/profile?handle=x` with no token.<br>2. Call it again with a wrong token. | 401 `{"error":{"code":"IG_UNAUTHORIZED", ...}}` both times; the Node client maps a 401 to `IG_SERVICE_UNAUTHORIZED`, never treating it as an Instagram-side failure. | 🟢 live: `/profile` with no token returned 401, with a wrong token 401, and `/health` with the real token 200 |
| SEC-04 | P2 | Secret handling | A non-loopback `IG_SERVICE_HOST` is refused at boot; the service binds loopback only, so nothing off the machine can reach it even with the token. | `IG_SERVICE_HOST=0.0.0.0`. | 1. Start the sidecar. | It refuses at boot with the loopback-only message; port 8765 never opens on a non-loopback interface. | 🟡 blocked: terminal-only, requires restarting the sidecar with `IG_SERVICE_HOST=0.0.0.0`; out of scope for a browser QA pass |

Security-lite has no rows for a license gate or cross-tenant leakage: ig-sync has no license check of its own, and crowsnest is single-user with no tenants. "No buyer data leaving the box" is covered indirectly by SEC-04 (loopback binding); ig-sync's only outbound call is to Instagram itself, the intended destination for channel data, so there is no separate leak path to test.
