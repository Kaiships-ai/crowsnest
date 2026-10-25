# Jobs and failures

Work that outlives a single request runs inside the server process as timers and detached runs, started by `startJobs` in `src/server/start.ts` (in the Lead Studio app, or in headless `server.ts`). This page lists those jobs and then the reads that report on them: the failure strip classification, runs, notifications and logs.

## Data it holds

- `sync_jobs`: one row per sync run per channel, or per library sweep (`channel_id` null, `lock_key` `__library__`). Holds status (running, success, partial, failed), counters (seen, created, updated, failed, deleted), `heartbeat_at`, a stop reason and the `gaps` JSON listing channels it could not cover.
- `frame_pass_jobs`: one row per frame-pass run with the same lock and heartbeat pattern.
- `remix_runs`: rows from the removed in-app remix generation. Nothing writes it now; the runs read still lists the old rows.
- `planned_posts`: the publish job's state (`scheduled`, `publishing`, `published`, `failed`), `attempt_count`, `last_error`, `idempotency_key`.
- `log_events`: stored info, warn and error events from backend, frontend and sidecar, already redacted, capped at 50000 rows and pruned oldest first (`src/server/logs/store.ts`).
- `notifications`: stored alerts of kind `run_failed`, `run_finished` or `sla_breach`, with `read_at`.

A "Run" is not a table. `src/server/queries/runs.ts` unifies `sync_jobs` and `remix_runs` into one read.

The web app's Log, Runs, and failure strip screens are retired with the web app; a Lead Studio board replaces them. The reads stay in the server.

## Boundaries

- Owns: `src/server/services/sync-engine.ts`, `sync-scheduler.ts`, `publish-scheduler.ts`, `own-measure-scheduler.ts`, `frame-pass-runner.ts`, `src/server/runs/sla.ts`, `src/server/notifications/`, `src/server/logs/`, `src/server/queries/failure-surface.ts`, `src/server/queries/runs.ts`.
- Called by: `server.ts` (boots the three schedulers), server actions (manual sync, cancel, retry), the shell layout (failure strip), the Cài đặt tabs (Log and Lần chạy), `/api/runs/stream` (server-sent events refreshed every 2 seconds).
- Calls: the Instagram sidecar, the Graph API, the local `claude` CLI (frame pass). See [external-services](external-services.md).

## The jobs

| Job | Trigger | Single-flight guard | Recovery |
| --- | --- | --- | --- |
| Sync (channel or library sweep) | Manual action, or the sync scheduler when `syncCadenceMinutes` has elapsed since the newest `sync_jobs` row (0 disables it; tick every 60 s) | Partial unique index `sync_jobs_lock_running` on `lock_key` where status is running | A running row silent for 10 times `SYNC_STALL_SECONDS` (90 s) is reaped as stuck and raises an `sla_breach` notification. A run is read as dead after the stall threshold. |
| Publish | Publish scheduler, tick every 30 s, or an immediate publish | Atomic `UPDATE ... WHERE state='scheduled'` claim. A tick that changes 0 rows lost the race. | A failed post under 3 attempts is re-armed with backoff. A row stuck in `publishing` past 20 minutes without a heartbeat is re-claimed. |
| Own-channel measurement | Own-measure scheduler, hourly tick (first tick 30 s after boot), or a manual action | Reentrancy guard in the process; due posts are derived from stored captures | Budget of 150 Graph calls per scheduled run, 190 for a manual full run. Posts under 72 hours old are measured hourly, older posts daily. Snapshots are appended, never overwritten. |
| Frame pass | Manual action | Partial unique index `frame_pass_jobs_lock_running` | A running row with a heartbeat older than 120 s is reaped. |

Behavior the user can depend on:

- The feed reflects the last sync, not live Instagram. With the sidecar down, no new videos arrive and the feed goes stale rather than erroring. Save, remix and plan keep working on what is there.
- A sync that no longer sees a post soft-deletes it (`deletedAt`). The row, its analysis, saved post and planned posts stay.
- A sync runs in the background and does not block its caller. A sync is not undoable; a user can request cancel (`requestCancel`), which sets `cancel_requested`. The run stops cleanly at its next check. Channels it already finished stay; the channel whose walk was cut stores nothing.
- The sync window and retry tunables (lookback 30 days, 200 items per sync, 3 retries with jittered backoff) are env defaults in `src/server/config.ts`, overridable by `app_settings` rows. They are not part of the core loop.

## Failure surfaces

Each action returns an `ActionResult` for its caller. Standing state comes from two reads: the failure strip classification of the newest `sync_jobs` row (`getFailureStrip`) and the durable `notifications` rows, kept until read.

### Failure strip kinds

`classify` in `src/server/queries/failure-surface.ts` maps the latest sync row to one kind. Connection-level codes are scanned across every gap, not only the job-level code, because an expired session or a down sidecar is a fact about the one shared connection, never about the channel that happened to be visiting when it broke.

| Kind | Meaning |
| --- | --- |
| `service_down` | Sidecar unreachable or unauthorized |
| `session_expired` | Login, 2FA, challenge or proxy block needs a human |
| `cooldown` | Instagram rate-limited the whole connection |
| `offline` | Network calls to Instagram failed |
| `partial` | Some channels failed for their own reasons, or a channel's pull was cut after a page landed (the gap has `partial: true`) |
| `failed` | Every channel failed, connection intact |
| `none`, `running` | Nothing to report, or a run in flight |

## Invariants

- **A run in flight reads as `running`.** The classification never reports two contradictory sync states.
- **Failure and SLA notifications always fire; success is opt in.** `notifyOnSuccess` defaults to off (`src/server/settings/index.ts`). A breach never auto-cancels a run (`src/server/runs/sla.ts` is a pure verdict: over budget, or stuck on a stale heartbeat, only while running).
- **No double publish.** The conditional-UPDATE claim, not a lock, is the guarantee (`publish-scheduler.ts`). `planned_posts.idempotency_key` is unique on post id plus scheduled time.
- **A scheduler that throws never stops the server.** Each tick catches and logs codes and counts only, never a message that could carry a token.
- **Logs are redacted before insert.** Nothing raw lands in `log_events` (`src/server/lib/logger.ts`, `logs/store.ts`).
- **No user setting changes the strip kinds or labels.** They are fixed in code.

## Where to look

- `src/server/services/sync-engine.ts`, `sync-types.ts`, `sync-scheduler.ts`
- `src/server/services/publish-scheduler.ts`, `own-measure-scheduler.ts`
- `src/server/queries/failure-surface.ts`
- `src/server/queries/runs.ts`
- `src/server/notifications/store.ts`, `src/server/logs/store.ts`
