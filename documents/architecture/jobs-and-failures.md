# Jobs and failures

Work that outlives a single request runs inside the Next server as timers and detached runs. This page lists those jobs and then the surfaces that report on them: the failure strip, the Runs screens, notifications, toasts and the remix run log.

## Data it holds

- `sync_jobs`: one row per sync run per channel, or per library sweep (`channel_id` null, `lock_key` `__library__`). Holds status (running, success, partial, failed), counters (seen, created, updated, failed, deleted), `heartbeat_at`, a stop reason and the `gaps` JSON listing channels it could not cover.
- `frame_pass_jobs`: one row per frame-pass run with the same lock and heartbeat pattern.
- `remix_runs`: append-only log of each remix generation attempt, written on success and on failure.
- `planned_posts`: the publish job's state (`scheduled`, `publishing`, `published`, `failed`), `attempt_count`, `last_error`, `idempotency_key`.
- `log_events`: stored info, warn and error events from backend, frontend and sidecar, already redacted, capped at 50000 rows and pruned oldest first (`src/server/logs/store.ts`).
- `notifications`: stored alerts of kind `run_failed`, `run_finished` or `sla_breach`, with `read_at`.

A "Run" is not a table. `src/server/queries/runs.ts` unifies `sync_jobs` and `remix_runs` into one read for the Runs list and detail pages.

## Boundaries

- Owns: `src/server/services/sync-engine.ts`, `sync-scheduler.ts`, `publish-scheduler.ts`, `own-measure-scheduler.ts`, `frame-pass-runner.ts`, `src/server/runs/sla.ts`, `src/server/notifications/`, `src/server/logs/`, `src/server/queries/failure-surface.ts`, `src/components/sync/`, `src/components/runs/`.
- Called by: `server.ts` (boots the three schedulers), server actions (manual sync, cancel, retry), the shell layout (failure strip), `/api/runs/stream` (server-sent events refreshed every 2 seconds).
- Calls: the Instagram sidecar, the Graph API, the local `claude` CLI (frame pass). See [external-services](external-services.md).

## The jobs

| Job | Trigger | Single-flight guard | Recovery |
| --- | --- | --- | --- |
| Sync (channel or library sweep) | Manual action, or the sync scheduler when `syncCadenceMinutes` has elapsed since the newest `sync_jobs` row (0 disables it; tick every 60 s) | Partial unique index `sync_jobs_lock_running` on `lock_key` where status is running | A running row silent for 10 times `SYNC_STALL_SECONDS` (90 s) is reaped as stuck and raises an `sla_breach` notification. The UI treats a run as dead after the stall threshold. |
| Publish | Publish scheduler, tick every 30 s, or an immediate publish | Atomic `UPDATE ... WHERE state='scheduled'` claim. A tick that changes 0 rows lost the race. | A failed post under 3 attempts is re-armed with backoff. A row stuck in `publishing` past 20 minutes without a heartbeat is re-claimed. |
| Own-channel measurement | Own-measure scheduler, hourly tick (first tick 30 s after boot), or a manual action | Reentrancy guard in the process; due posts are derived from stored captures | Budget of 150 Graph calls per scheduled run, 190 for a manual full run. Posts under 72 hours old are measured hourly, older posts daily. Snapshots are appended, never overwritten. |
| Frame pass | Manual action | Partial unique index `frame_pass_jobs_lock_running` | A running row with a heartbeat older than 120 s is reaped. |

Behavior the user can depend on:

- The feed reflects the last sync, not live Instagram. With the sidecar down, no new videos arrive and the feed goes stale rather than erroring. Save, remix and plan keep working on what is there.
- A sync that no longer sees a post soft-deletes it (`deletedAt`). The row, its analysis, saved post and planned posts stay.
- A sync runs in the background and does not block the user. A sync is not undoable; a user can request cancel (`requestCancel`), which sets `cancel_requested`. The run stops cleanly at its next check and keeps what it already wrote.
- The sync window and retry tunables (lookback 30 days, 200 items per sync, 3 retries with jittered backoff) are env defaults in `src/server/config.ts`, overridable by `app_settings` rows. They are not part of the core loop.

## Failure surfaces

Four surfaces, each with its own scope and lifetime.

| Surface | Scope | Lifetime | Source |
| --- | --- | --- | --- |
| Toast | One action | Seconds. Gone on reload, including an unclicked Undo. | The `ActionResult` the action returned |
| Failure strip | The app, every shell route | Standing. Re-read on each server render. | The newest `sync_jobs` row (`getFailureStrip`) |
| Remix run log | One remix session | Durable, append only, newest first | `remix_runs` |
| Notification | The app | Durable until read | `notifications` |

### Failure strip kinds

`classify` in `src/server/queries/failure-surface.ts` maps the latest sync row to one kind. Connection-level codes are scanned across every gap, not only the job-level code, because an expired session or a down sidecar is a fact about the one shared connection, never about the channel that happened to be visiting when it broke.

| Kind | Meaning | Tone | Action offered |
| --- | --- | --- | --- |
| `service_down` | Sidecar unreachable or unauthorized | bad | Copy the start command |
| `session_expired` | Login, 2FA, challenge or proxy block needs a human | bad | Reconnect in Settings |
| `cooldown` | Instagram rate-limited the whole connection | bad | Try again, disabled while a countdown runs. A countdown shows only when Instagram supplied a retry hint. |
| `offline` | Network calls to Instagram failed | bad | Try again |
| `partial` | Some channels failed for their own reasons | warn | Retry the named channels. Dismissible. |
| `failed` | Every channel failed, connection intact | bad | Try again |
| `none`, `running` | Nothing to show, or a run in flight | hidden | The progress panel tells the in-flight story instead |

Design constraints on the strip:

- Severity shows only as a left rule and a dot. Amber is reserved for "a post beat its channel", and failure is a normal state, not an alarm.
- Only `partial` can be dismissed, because it is the only kind that heals on its own. A connection-level notice stays until its cause is fixed.
- The strip says what survived (items kept, channels synced) as well as what broke, and drops a fact the sync did not record rather than showing a blank.
- Every sync control in the app reads its disabled state off this one query.
- The strip is read once per server render. `useSyncProgress` polls while the shell is mounted, so a run starting anywhere hides the strip at once; its finished verdict appears on the next navigation or `router.refresh()`.

### Toasts and undo

Every server action settles into a toast and nothing throws across the action boundary. A destructive action carries its Undo inside the toast (removing a kept post re-creates the row). There is no undo stack behind it. A toast reports a result; a write that changes server-rendered data also calls `router.refresh()`.

### Remix run log tones

Success means the attempt produced a usable result; for variants, at least one of three came back. Partial means some variants succeeded ("N of M"), and only variant generation can be partial. Failed means the attempt produced nothing. The studio infers "model proxy likely down" from the last three rows (`src/components/remix/run-log-view.ts`); see [external-services](external-services.md).

### Empty states

Pages say so in place instead of failing. The feed has four distinct empty states (no channels, none synced yet, a search with no match, a filter that cleared everything), each with its own recovery link. The calendar's published and dead-air markers stay off for a channel that was never measured, so an empty month reads as "nothing checked" rather than "nothing happened".

## Invariants

- **A run in flight hides the strip.** The shell never shows two contradictory sync states (`failure-strip-view.ts`).
- **Failure and SLA notifications always fire; success is opt in.** `notifyOnSuccess` defaults to off (`src/server/settings/index.ts`). A breach never auto-cancels a run (`src/server/runs/sla.ts` is a pure verdict: over budget, or stuck on a stale heartbeat, only while running).
- **No double publish.** The conditional-UPDATE claim, not a lock, is the guarantee (`publish-scheduler.ts`). `planned_posts.idempotency_key` is unique on post id plus scheduled time.
- **A scheduler that throws never stops the server.** Each tick catches and logs codes and counts only, never a message that could carry a token.
- **Logs are redacted before insert.** Nothing raw lands in `log_events` (`src/server/lib/logger.ts`, `logs/store.ts`).
- **No user setting changes the strip kinds, labels or run-log tones.** They are fixed in code.

## Where to look

- `src/server/services/sync-engine.ts`, `sync-types.ts`, `sync-scheduler.ts`
- `src/server/services/publish-scheduler.ts`, `own-measure-scheduler.ts`
- `src/server/queries/failure-surface.ts`, `src/components/sync/failure-strip-view.ts`
- `src/server/queries/runs.ts`, `src/app/api/runs/stream/route.ts`
- `src/server/notifications/store.ts`, `src/server/logs/store.ts`
