# ig-sync: feature description

## Sync a tracked channel

### Summary

ig-sync is what fills the feed. The user does not fetch a post one at a time; they track a
channel, a sync runs, and the channel's recent posts — reels, videos, photos, and carousels
— arrive as videos with their view, like, and comment counts and an outlier score computed
against that channel's own baseline. Everything downstream (the feed, analyze, remix, plan)
runs on the videos a sync wrote; ig-sync is the only writer of the `videos` table.

The work happens in a local Python sidecar (`services/ig/`) that holds one authenticated
Instagram session and answers the Next.js app over localhost on port 8765, authenticated by
the shared secret `IG_SERVICE_TOKEN`. The sidecar is the only thing in crowsnest that logs
in to Instagram or sees an Instagram CDN URL. It runs under launchd, reading `IG_USERNAME`
and `IG_PASSWORD` from `.env.local` — credentials the app itself never sees.

A sync is a background job, not a request that returns. The user starts it (or it runs on
its own) and can leave; its status lives in the `sync_jobs` row, so a reload or another tab
reads the same run. The feed reflects the last sync, not the live state of Instagram: when
the sidecar is not running, no new videos arrive and the feed goes stale rather than
erroring, and every downstream action still works on the videos already there.

Technical note: ig-sync has no page of its own the way analyze does. Its user-facing edges
are the add-channel dialog, the channels board, the settings sync controls, and the shell's
failure strip. This document describes the sync behaviour those surfaces drive; the surfaces
themselves are owned by their own components.

Dependency worth stating first, because it is the difference between the feature working and
not existing at all: the sidecar must start, and it only starts when onboarding wrote
`IG_PASSWORD` correctly. A known onboarding bug (`evidence/10-onboarding-bugs.md`) wrote an
**empty** password, and the sidecar then refuses to start — exit 78 `EX_CONFIG`, launchd
crash-loops it, port 8765 never comes up. When that happens every sync fails with the local-
service-down verdict and no new videos ever arrive. That is the standing precondition behind
every state below.

### The simple case

The user opens the add-channel dialog, types a handle (`@creator`, or bare `creator`), and
confirms. The handle is normalised — a pasted profile URL is rejected as a typo, not
silently accepted — and the sidecar is asked for the profile once; a resolvable handle
writes a channel row with its display name, avatar, and follower count, and it appears on the
channels board. A sync then walks that channel newest-first back through the 30-day lookback
window, downloads each post's thumbnail into the app's own storage, records the metrics, and
computes outlier scores. When it finishes, the channel's recent posts are in the feed, ranked
by how far each beats its channel's own median, and the settings page shows the last sync's
counts.

While the run is in flight the shell's progress panel tells the story — which channel, how
many items seen and created — and steps aside for the failure strip only once the run ends.
On success the strip is quiet; on trouble it carries one verdict (below).

### The interaction, event by event

```
stateDiagram-v2
    [*] --> idle : sidecar up, nothing running
    idle --> running : start a sync (manual, or automatic)
    running --> success : whole window walked, at least one survivor
    running --> partial : some channels failed, or a late cancel left work undone
    running --> failed : every channel failed, or the run itself threw
    running --> cancelled : user asked to stop
    idle --> serviceDown : sidecar unreachable (port 8765 down)
    serviceDown --> idle : sidecar started
```

#### Arrive

A channel is tracked before any sync of it runs. The add-channel dialog resolves the profile
through the sidecar; the first-run onboarding path is deliberately lenient and writes a thin
channel row even when the profile fetch fails (onboarding collects handles before the login
step), while the add-channel dialog is strict and rejects an unresolvable handle as a likely
typo. The channels board and channel detail page read the last stored sync, not a live call,
so they render whatever the database holds.

#### Leave without acting

Tracking a channel does not sync it, and opening a page does not start anything. Nothing runs
until a sync is started — by the user from settings or a channel, or by the automatic pass
where enabled. Leaving records nothing.

#### Begin acting

Starting a sync wins the database lock and hands back a job id immediately; the run then
finishes detached under the server's `after()`, so the browser never holds the request open
for a minutes-long sync. The lock is what enforces one run per channel: a second start that
would overlap is refused with "a sync is already running", not run alongside.

#### While acting

The run walks channels sequentially — one Instagram account is making these requests, and
parallel bursts are what trip rate limiting, so the pacing is the point. It flushes progress
to the `sync_jobs` row at each page and channel boundary (and mid-page if it goes quiet too
long), so any poller — the tab that started it, another tab, a reload — reads live counts.
Failure is isolated and counted at each level: a dead thumbnail costs one asset, a malformed
post costs one item, and only an upstream failure on the profile or media call fails the
whole channel, recorded as a gap with the channel's handle and the error code.

#### Finish

On finish the job row is written with a status and counts. `success` means the window was
walked and at least one channel survived; `partial` means a survivor plus at least one failed
channel (or a cancel that left work undone); `failed` means every channel failed. The feed,
scores, and settings summary reflect whatever landed. A run that fully enumerated a channel's
window also soft-marks posts that were in-window but did not come back — that removal
cascades (a saved post is deleted with it; a planned post keeps the plan but the link goes
null) — but a run that saw zero items refuses to read an empty fetch as deletions.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (channel tracked, own vs reference) | Only tracked, non-removed Instagram channels are synced; a soft-removed channel is skipped so it does not resurrect. The library run walks every tracked channel; a per-channel run walks one. | A channel removed mid-run is simply not revisited; a video removed by soft-delete cascades its saved post and nulls a planned post's link. |
| Attached data present or absent (session, credentials) | `/health` reports `can_login` (both `IG_USERNAME` and `IG_PASSWORD` present) separately from `logged_in`, so Settings can tell "no credentials yet" from "credentials present but logged out". No credentials means the sidecar boots and serves `/health` but cannot sync. | A session that goes stale mid-run triggers exactly one re-login using the stored settings and one retry; a second failure is `IG_AUTH_REQUIRED` and the channel becomes a gap that says "reconnect in settings". |
| External service availability (sidecar, Instagram) | If the sidecar is unreachable (port 8765 down — the onboarding-bug case), a sync cannot run and the strip reads local-service-down. If Instagram is rate-limiting, a cooldown deadline persists next to the session file and the strip shows a countdown only when Instagram supplied one. | A rate limit mid-run returns `IG_RATE_LIMITED` with the wait Instagram computed; the engine backs off (capped at 5 min) or fails the channel and lets the user retry. A network failure is retried while `retryable` says it is worth it, then fails that channel. |
| Keyboard shortcut in play | None. ig-sync has no keyboard affordance; its controls are ordinary buttons on the board, settings, and the failure strip. | None. |

### Cancel and interrupt

| Event | Before commit (nothing running) | While in flight (a sync running) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; no run is in flight. | Stop sets `cancel_requested` on the job row. The engine is co-operative: it stops at the next page or channel boundary, keeping everything already committed, and does **not** kill the process (which would leave the lock held). A cancel deliberately skips the enrichment and analyze/idea passes so no more authenticated requests are spent on a run nobody is waiting for. `stop_reason` reads `cancelled`; status is `partial` if work was left undone, `success` if the cancel arrived too late to stop anything. |
| Navigate away mid action | Leaving records nothing. | The run is detached, so it keeps going server-side; its verdict is read from `sync_jobs` on the next navigation. The progress panel is live view state and does not survive the leave. |
| Reload or tab or window closed | Nothing is saved. | The run continues under the server. A reload re-reads the running job (or the most recent finished one) from the database, so a fresh tab picks up a run another tab started rather than showing nothing. |
| A backing service fails mid action | The strip already shows the standing verdict — local-service-down when the sidecar is not running. | The sidecar going down mid-run fails the outstanding call as `IG_SERVICE_DOWN` (one quick retry, since it may be mid-restart); Instagram rate-limiting or a network failure surface as their own codes on the affected channel's gap. Nothing partial is left half-written. |
| The target record changes underneath | A channel removed between tracking and sync is skipped. | A channel removed mid-run is not revisited. A post that vanished from Instagram this run is soft-marked deleted, only if the whole window was enumerated. |
| A background job finishes or fails on its own | The stale-lock reaper marks a `running` row with no heartbeat as `failed`/`SYNC_ABANDONED` and raises an SLA notification, so a crashed run does not hold the lock forever. | If a reaper takes a live run's row while it is still working, the run finalizes only if it still owns the row; otherwise it records its counters but leaves the reaper's verdict, and logs that two runs were racing. |
| A second tab or a double action on the same record | Two tabs can both try to start; the database lock lets at most one win per overlapping scope, and the loser is told "a sync is already running". | A double start is refused by the lock, not run twice. Two runs on one channel is a corruption case the `IMMEDIATE`-transaction lock exists to prevent. |

After any interrupt the sync's row reflects exactly what the database holds. There is never a
half-written video: a post is upserted whole or its failure is counted and skipped.

### Interactions with other systems

Persistence and autosave. There is no autosave; a sync writes durable rows as it goes
(`videos`, `video_children`, `video_snapshots`, `channel_snapshots`, and the `sync_jobs`
progress row). Downloaded assets are content-addressed and deduped, so a re-download of
identical bytes reuses the same file. A metric Instagram withheld (null, or a zero read as
"not disclosed") never erases a count already stored.

History and undo. A sync is not undoable. Soft-delete is reversible only in that a post
reappearing on Instagram is un-deleted rather than duplicated on a later sync. There is no
per-run rollback; the `sync_jobs` row is the record that a run happened.

Navigation and refresh. Pages render on the server and re-read on navigation, so a channel's
last-sync figures and the feed update on the next load, not live. The failure strip is read
once per server render and freshened by the live sync poll while the shell is mounted.

Background jobs and the sidecar. ig-sync **is** the sidecar sync — the writer of the feed
and the source of the outlier scoring input. It is owned in full by
[background jobs](../../shared/background-jobs.md); the sync window and retry behaviour are
environment/settings defaults (30-day lookback, 200-item cap, 3 retries), not user-facing
promises. The cook run is a separate background job and shares none of this path.

External services. The one external dependency is Instagram, reached only through the local
sidecar. Its degradation is summarised in
[external services](../../shared/external-services.md): a down sidecar means a stale feed, an
expired session means "reconnect in settings", a rate limit means a cooldown. None of these
takes down the rest of the app.

Status and failures. A sync's verdict surfaces in the shell **failure strip**
([status and failures](../../shared/status-and-failures.md)), which classifies the latest
sync into local-service-down, session-expired, cooling-down, no-network, partial-sync, or
sync-failed, each with the one recovery action the user can take. ig-sync has no in-page
failure surface of its own; a healthy run stale feed shows only as posts that stop arriving.

Configuration and settings. Credentials (`IG_USERNAME`, `IG_PASSWORD`, `IG_SERVICE_TOKEN`)
and the sidecar URL/port are environment configuration read by the sidecar and the app; the
lookback days, item cap, retry counts, and the view-count enrichment budget are settings with
DB-over-env-over-default precedence, so a change takes effect on the next sync without a
restart. The outlier scoring options (baseline method, window, minimum posts, views floor)
are read once per rescore from settings.

### Edge cases

- **The sidecar must start, or the whole feature is dark.** The onboarding bug that writes an
  empty `IG_PASSWORD` (`evidence/10-onboarding-bugs.md`) makes the sidecar exit 78 and
  launchd crash-loop it; port 8765 never comes up, and every sync reads local-service-down.
  This is the single most consequential dependency and the known hard blocker for buyers.
- **Only Instagram is ingested.** The add-channel dialog once offered TikTok and YouTube
  Shorts chips, but the backend could never sync them, so choosing either produced a channel
  row that silently never updated. The chips were removed (`OBS-3` in the backlog); the
  `platform` column stays in the schema for a future second source. TikTok/YouTube Shorts
  ingestion is roadmap, not built.
- **Carousels are one post, not many.** A carousel is a single `videos` row with
  `video_children` rows in payload order; a child inherits the parent's date and caption
  rather than inventing its own.
- **Pinned posts do not stop the walk.** They come back first and out of chronological order,
  so the lookback boundary stops only after 3 consecutive out-of-window items and never
  counts a pinned item toward that streak. This exact bug once soft-deleted 8 live posts.
- **View counts need a second call.** The listing endpoint returns `play_count: 0` for other
  creators' reels, so the real number comes from a per-reel `/media-stats` call in the
  enrichment pass; it is off unless a per-channel budget is set, and it runs before scoring
  so the number reaches the score in the same sync.
- **A zero is "not disclosed", never a real zero.** Persisting a literal zero once turned a
  2.27M-view reel into 0 and would zero every outlier score, so a zero never overwrites a
  stored count.
- **On-demand video.** Only thumbnails download during a sync; the video file is fetched on
  first play (via a fresh `/resolve-media`) unless `EAGER_VIDEO_DOWNLOAD` is set, because
  Instagram's CDN URLs expire within hours.
