# ig-sync: feature description

ig-sync is what fills the feed. The user does not fetch a post one at a time; they track a channel, a sync runs, and the channel's recent posts, reels, videos, photos, and carousels, arrive as videos with their view, like, and comment counts and an outlier score computed against that channel's own baseline. Everything downstream (the feed, analyze, remix, plan) runs on the videos a sync wrote; ig-sync is the only writer of the `videos` table.

The work happens in a local Python sidecar (`services/ig/`) that holds one authenticated Instagram session and answers the Next.js app over localhost on port 8765, authenticated by the shared secret `IG_SERVICE_TOKEN`. The sidecar is the only thing in crowsnest that logs in to Instagram or sees an Instagram CDN URL. It runs under launchd, reading `IG_USERNAME` and `IG_PASSWORD` from `.env.local`, credentials the app itself never sees.

ig-sync has no page of its own the way analyze does. Its user facing edges are the add channel dialog, the channels board, and the settings sync controls; the surfaces themselves are owned by their own components, and the shell's failure strip is where a sync's verdict surfaces app wide.

Dependency worth stating first, because it is the difference between the features below working and not existing at all: the sidecar must start, and it only starts when onboarding wrote `IG_PASSWORD` correctly. A known onboarding bug wrote an empty password, and the sidecar then refuses to start, exit 78 `EX_CONFIG`, launchd crash loops it, port 8765 never comes up. When that happens every sync fails with the local service down verdict and no new videos ever arrive. That is the standing precondition behind every feature below.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Track a channel | Add an Instagram handle; the sidecar resolves the profile | ● | `services/sync-engine.ts` (addChannel) | none |
| 3 | Sync a channel's posts | Page recent media, upsert videos, snapshot metrics, rescore | ● | `services/sync-engine.ts` (runSync) | onboarding empty IG_PASSWORD blocks buyer installs |
| 4 | Backfill blank view counts | Re-read the real play count via `/media-stats` where the listing returned zero | ● | `services/sync-engine.ts` (startViewCountBackfillAction) | none |
|  | TikTok / YouTube Shorts ingestion | Multi-platform tracking; the `platform` column is reserved | ○ | no backend yet | roadmap |

## 2. Track a channel

### Who uses it

The user, from the add channel dialog on the channels board, or the first run onboarding flow.

### What it does

The user types a handle (`@creator`, or bare `creator`), and confirms. The handle is normalized, and the sidecar is asked for the profile once; a resolvable handle writes a channel row with its display name, avatar, and follower count, and it appears on the channels board. Tracking a channel does not sync it: nothing runs until a sync is started separately, by the user or by the automatic pass where enabled.

### How to access it

The "Add channel" trigger on the channels board opens the add channel dialog. The same underlying write also runs, more leniently, during first run onboarding, where a thin channel row is written even before the sidecar has logged in.

### Business rules

- The handle is normalized before the sidecar is asked; a pasted profile URL (for example `https://www.instagram.com/creator/`) is rejected as a typo, not silently accepted or reformatted.
- The add channel dialog is strict: an unresolvable handle writes nothing and shows the reason. The first run onboarding path is deliberately lenient and writes a thin channel row even when the profile fetch fails, because onboarding collects handles before the login step runs.
- Re adding a previously removed (soft deleted) channel revives the same row rather than failing on the unique index; `trackedSince` is preserved.
- Only tracked, non removed Instagram channels are ever synced; a soft removed channel is skipped so it does not resurrect on its own.
- TikTok and YouTube Shorts were once offered as add channel choices, but the backend could never sync them, so the chips were removed; the `platform` column stays in the schema for a possible future second source.

### Limitations

- Only Instagram is ingested. TikTok/YouTube Shorts tracking is roadmap, not built.
- Adding a channel needs the sidecar reachable and, for the strict dialog path, logged in; with the sidecar down or unauthenticated, the add fails rather than writing a channel that can never sync.

### User guide

To start tracking a creator, open the Channels board and click Add channel. Type their Instagram handle, with or without the `@`, and confirm. crowsnest checks that the handle is real before adding it, so a typo or a pasted profile link is rejected rather than silently creating a channel that will never load. Once added, the channel appears on the board; its posts arrive the next time a sync runs.

## 3. Sync a channel's posts

### Who uses it

The user, starting a sync manually from the channels board, a channel's detail page, or settings; or the automatic pass, where enabled, starting one on its own.

### What it does

A sync walks a channel newest first back through the 30 day lookback window, downloads each post's thumbnail into the app's own storage, records the metrics, and computes outlier scores. A sync is a background job, not a request that returns: the user starts it and can leave, its status lives in the `sync_jobs` row, so a reload or another tab reads the same run, and progress is visible in the shell's progress panel while it runs. On finish the job row carries a status and counts: `success` means the window was walked and at least one channel survived, `partial` means a survivor plus at least one failed channel (or a cancel that left work undone), `failed` means every channel failed. A run that fully enumerated a channel's window also soft marks posts that were in window but did not come back; that removal cascades, a saved post is deleted with it, a planned post keeps the plan but the link goes null, but a run that saw zero items refuses to read an empty fetch as deletions.

### How to access it

A "Sync" action on the channels board (per channel or for the whole library) or on a channel's detail page; automatic scheduling, where the interval setting is non zero, starts a sync on its own. Progress shows in the shell's progress panel; the result shows in the feed, the channel's last sync summary, and the failure strip if something went wrong.

### Business rules

- The lock is what enforces one run per channel: a second start that would overlap an in flight run is refused with "a sync is already running", not run alongside.
- The run works channels through a bounded worker pool (the `syncConcurrency` setting, default 2, clamped 1 to 16), not one channel at a time. Only one Instagram account is ever making requests either way, because the sidecar itself serializes every real call behind its own lock; the pool just lets one channel's local work (thumbnails, DB writes, scoring) overlap the next channel's fetch instead of waiting on it. At `syncConcurrency` 1 a run behaves exactly like the old one-channel-at-a-time walk.
- An interrupted deep crawl, stopped by the item cap, a cancel, or a channel error, resumes from a saved cursor on its next run instead of restarting from the newest post. A cursor older than the lookback window is treated as stale and the next run starts fresh. Soft delete is skipped on a resumed run, since it only walked the remainder below its cursor, not the whole window.
- A repeat sync of an already synced channel stops paging as soon as a page comes back with zero new posts, since Instagram returns newest first and everything below is already known; the run stops with reason `upToDate` instead of walking the rest of the window. This early stop is only allowed while the channel's last full walk (`lastFullSyncAt`) is within `syncMetricsFreshnessHours` (default 12 hours, env `SYNC_METRICS_FRESHNESS_HOURS`, DB overridable), the guarantee that no in window post's view or like snapshot goes stale for longer than that window; once the window lapses, the next sync walks the whole lookback range again and refreshes every snapshot. It never fires on a resumed run, which is deliberately re walking known posts to reach the un fetched ones below its cursor.
- Failure is isolated and counted at each level: a dead thumbnail costs one asset, a malformed post costs one item, and only an upstream failure on the profile or media call fails the whole channel, recorded as a gap with the channel's handle, the error code, and that code's class (transient, auth, challenge, or fatal).
- Pinned posts do not stop the walk early: they come back first and out of chronological order, so the lookback boundary stops only after 3 consecutive out of window items, and a pinned item never counts toward that streak.
- Carousels are one `videos` row with `video_children` rows in payload order; a child inherits the parent's date and caption rather than inventing its own.
- View counts need a second call: the listing endpoint returns `play_count: 0` for other creators' reels, so the real number comes from a per reel `/media-stats` call in the enrichment pass, off unless a per channel budget is set, and it runs before scoring so the number reaches the score in the same sync.
- A zero is "not disclosed", never a real zero: persisting a literal zero once turned a 2.27M view reel into 0 and would zero every outlier score, so a zero never overwrites a stored count.
- Only thumbnails download during a sync; the video file is fetched on first play (via a fresh `/resolve-media`) unless `EAGER_VIDEO_DOWNLOAD` is set, because Instagram's CDN URLs expire within hours.
- Stop is co operative: a Stop action sets `cancel_requested` on the job row, the engine stops at the next page or channel boundary, keeps everything already committed, and does not kill the process, which would leave the lock held. A cancel deliberately skips the enrichment and analyze/idea passes so no more authenticated requests are spent on a run nobody is waiting for.
- A session that goes stale mid run triggers exactly one re login using the stored settings and one retry; a second failure is `IG_AUTH_REQUIRED` and the channel becomes a gap that says "reconnect in settings".
- A rate limit mid run returns `IG_RATE_LIMITED` with the wait Instagram computed; the engine backs off (capped at 5 minutes) or fails the channel and lets the user retry.
- A stale `running` row with no heartbeat is reaped to `failed`/`SYNC_ABANDONED`, releasing the lock and raising an SLA notification, so a crashed run does not hold the lock forever.

### Limitations

- The sidecar must be running. If it is unreachable (port 8765 down, including the onboarding bug case) a sync cannot run at all and the strip reads local service down.
- The feed reflects the last sync, not the live state of Instagram: with the sidecar not running, no new videos arrive and the feed goes stale rather than erroring.
- A sync is not undoable. Soft delete is reversible only in that a post reappearing on Instagram is un deleted rather than duplicated on a later sync; there is no per run rollback.
- No live sync has been proven to complete end to end with real credentials through a Kit install; see [architecture](02-architecture.md#open-not-verified).
- The concurrency a given run actually used is not shown anywhere; `sync_jobs` does not persist it, so a reload cannot tell whether a run pipelined 2 channels or was pinned to 1 (see [backlog](05-backlog-to-enhance.md)).
- An item cap hit on the very first page has no request cursor to resume from, so a pathologically low `maxItemsPerSync` can strand that page's own tail until a later full walk clears it (see [backlog](05-backlog-to-enhance.md)).

### User guide

Once a channel is tracked, its posts arrive through a sync. Start one from the channels board, a channel's own page, or the sync controls in Settings, or let the automatic schedule run it for you if you turned that on. You can leave the page once a sync starts; it keeps running and you can check its progress from the shell's progress panel or come back later. When it finishes, the channel's recent posts show up in the feed, ranked by how far each beats that channel's own typical performance. If something goes wrong, for example the local service is down or Instagram is rate limiting, the failure strip at the top of the app tells you what happened and what to do about it.

## 4. Backfill blank view counts

### Who uses it

The user, from the Settings sync section.

### What it does

A backfill is the same sync job machinery pointed at every tracked channel's already stored posts that are missing a real view count, re reading them through the view count enrichment call instead of walking a new lookback window. It runs, is tracked, and can be watched the same way an ordinary sync is, through the `sync_jobs` row and the Runs screen.

### How to access it

The "Backfill blank view counts" button in Settings, under the sync section.

### Business rules

- A backfill is a `sync_jobs` row like any other run; it refuses to start rather than queue while an ordinary sync is already running, so the two never race on the same lock.
- The same "zero is not disclosed" rule applies: a backfill never overwrites a stored count with a zero.

### Limitations

- Needs the sidecar reachable and logged in, the same as any other sync.
- Only fills in counts that are genuinely missing; it does not re verify counts that already have a value.

### User guide

If some posts in your feed are missing view counts, open Settings, find the sync section, and click Backfill blank view counts. It re checks Instagram for the real number on posts that never got one and updates them in place. You can follow its progress from the Runs screen, the same way you would an ordinary sync.

## 5. Interactions with other systems

Persistence and autosave. There is no autosave; a sync writes durable rows as it goes (`videos`, `video_children`, `video_snapshots`, `channel_snapshots`, and the `sync_jobs` progress row). Downloaded assets are content addressed and deduped, so a re download of identical bytes reuses the same file. A metric Instagram withheld (null, or a zero read as "not disclosed") never erases a count already stored.

Navigation and refresh. Pages render on the server and re read on navigation, so a channel's last sync figures and the feed update on the next load, not live. The failure strip is read once per server render and freshened by the live sync poll while the shell is mounted.

Background jobs and the sidecar. ig-sync is the sidecar sync, the writer of the feed and the source of the outlier scoring input. It is owned in full by [background jobs](../../shared/background-jobs.md); the sync window, concurrency, and retry behavior are environment/settings defaults (30 day lookback, 200 item cap, concurrency 2, 3 retries), not user facing promises. `getLastRunHealth` (`queries/runs.ts`) reads the last sync run's status, timings, and counts for a future dashboard and the planned `crowsnest_metrics` MCP tool; it has no page reading it yet.

External services. The one external dependency is Instagram, reached only through the local sidecar. Its degradation is summarized in [external services](../../shared/external-services.md): a down sidecar means a stale feed, an expired session means "reconnect in settings", a rate limit means a cooldown. None of these takes down the rest of the app.

Status and failures. A sync's verdict surfaces in the shell failure strip ([status and failures](../../shared/status-and-failures.md)), which classifies the latest sync into local service down, session expired, cooling down, no network, partial sync, or sync failed, each with the one recovery action the user can take. ig-sync has no in page failure surface of its own; a healthy run gone stale shows only as posts that stop arriving.

Configuration and settings. Credentials (`IG_USERNAME`, `IG_PASSWORD`, `IG_SERVICE_TOKEN`) and the sidecar URL/port are environment configuration read by the sidecar and the app; the lookback days, item cap, retry counts, and the view count enrichment budget are settings with DB over env over default precedence, so a change takes effect on the next sync without a restart. The outlier scoring options (baseline method, window, minimum posts, views floor) are read once per rescore from settings.

## 6. Edge cases

- **The sidecar must start, or the whole feature is dark.** The onboarding bug that writes an empty `IG_PASSWORD` makes the sidecar exit 78 and launchd crash loop it; port 8765 never comes up, and every sync reads local service down. This is the single most consequential dependency and the known hard blocker for buyers.
- **Only Instagram is ingested.** The add channel dialog once offered TikTok and YouTube Shorts chips, but the backend could never sync them, so choosing either produced a channel row that silently never updated. The chips were removed (`OBS-3` in the backlog); the `platform` column stays in the schema for a future second source.
- **Carousels are one post, not many.** A carousel is a single `videos` row with `video_children` rows in payload order; a child inherits the parent's date and caption rather than inventing its own.
- **Pinned posts do not stop the walk.** They come back first and out of chronological order, so the lookback boundary stops only after 3 consecutive out of window items and never counts a pinned item toward that streak. This exact bug once soft deleted 8 live posts.
- **A second tab or a double action on the same record.** Two tabs can both try to start a sync; the database lock lets at most one win per overlapping scope, and the loser is told a sync is already running.
- **A post deleted from Instagram is not noticed instantly.** Soft delete only runs on a full walk (stop reason `lookback` or `exhausted`, not resumed); the incremental `upToDate` stop never soft deletes, since it never asked about most of the window. A post the creator removed from Instagram is caught on the channel's next full walk, which is at most `syncMetricsFreshnessHours` (default 12 hours) away, not on the sync that happens to run right after the deletion.
- **A resumed crawl only sees its own remainder.** A run that continues from a saved cursor walks only the posts below where the prior run stopped, never the ones above it, so it cannot tell which older in window posts vanished; soft delete is skipped on that run even if it finishes the window. A cursor left over from a long-abandoned crawl (older than the lookback window) is ignored and the next run starts fresh instead of resuming a boundary that no longer covers today's window.
- **A backing service fails mid action.** The sidecar going down mid run fails the outstanding call as `IG_SERVICE_DOWN` (one quick retry, since it may be mid restart); Instagram rate limiting or a network failure surface as their own codes on the affected channel's gap. Nothing partial is left half written; a post is upserted whole or its failure is counted and skipped.
