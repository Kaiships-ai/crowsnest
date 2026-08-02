# Logs observability design

Date: 2026-08-02
Status: approved, ready to plan
Supersedes parts of: docs/superpowers/specs/2026-07-31-system-logs-design.md (the flat log_events store and the /api/logs/ingest write path stay, the passive table UI is replaced)

## Goal

Turn the logs feature from a passive event table into an operational view of Runs. Kai should watch a Sync or Remix live, trace one Run end to end, act on it (cancel or retry), get told when it fails or runs too slow, and see when a Run breaks its time budget.

## Why the current feature feels fragile

Grounded in the code as of this date:

- The /logs page (src/app/(shell)/logs/page.tsx) is a flat table. It never updates on its own. Seeing new lines means clicking Refresh.
- Nothing ties a group of lines together. A Sync emits sync.started, sync.progress, sync.finished, all carrying jobId inside the fields JSON (src/server/services/sync-engine.ts), but the id is not a column and the UI has no notion of a Run. You cannot open one Sync and read only its lines.
- There is no signal when something finishes or breaks. A failed overnight Sync looks the same as a quiet night until Kai opens the page.
- Run state already exists (sync_jobs, remix_runs) but the logs feature ignores it.

## Domain model

New terms are in CONTEXT.md under "Runs and observability": Run, Step, Heartbeat, Log event, Trace id, Notification, SLA budget, Breach.

- A Run is one execution with a lifecycle: running, success, partial, failed. A Sync is a Run. Each Remix stage is a Run (remix_runs is already one row per stage).
- A Step is a unit inside a Run (a Channel pulled, an image downloaded). Steps are not Runs.
- Asset downloads are Steps of a Sync, never top-level Runs, except a manually triggered standalone download, which is its own Run. See ADR 0002.
- A Log event ties to its Run by a Trace id.

## Scope

In: sync_jobs, remix stage runs, and standalone manual downloads as Runs. All five requirements ship together (realtime, traceable, executable, notification, SLA).

Out: OS level web push and service workers, resume from failure (retry is a full re-run), multi user, log export.

## Decisions

### Traceable

- Add a nullable `run_id` text column to log_events, indexed on (run_id, id). It holds the Sync's jobId or the Remix run id. Null for lines with no Run (for example a frontend client error).
- The backend logger (src/server/lib/logger.ts) gains an optional run id on the call, written to the column and kept in fields for back compat.
- The Python sidecar passes the same run id on its /api/logs/ingest POST, so its lines join the Run. The ingest body (src/app/api/logs/ingest/route.ts) gains an optional runId field.
- New Run detail page: a Run header (type, status, start, finish, duration, item counts for a Sync) above that Run's Log event timeline, queried by run_id.

### Realtime

- Delivery is SSE (server sent events) from a Node route. One user, local, one direction server to browser. Not WebSocket, not bare polling.
- The same stream drives two things: the Run list cards (status and progress) and, on an open Run, the tail of its Log events.
- On a dropped stream the client auto reconnects. The existing Refresh button stays as a manual fallback.

### Executable

- Two actions on a Run: cancel (a running Run) and retry (a failed or partial Run). Cancel is already wired server side (sync.cancel.requested). Retry starts a fresh Run with the same params.
- Retry is a full re-run, not resume from failure. Sync upserts, so a full re-run is safe.
- Actions appear on the Run list inline and on the Run detail page.

### Notification

- Two channels: the browser Notification API (fires while a tab is open, even backgrounded) and an in app notification center (a bell with an unread count).
- Persisted in a new `notifications` table with a read flag, so a missed alert is not lost. This is the main fix for "fragile".
- Default triggers: on failure and on SLA Breach. Success notifications are off by default and toggleable in Settings.

### SLA

Two signals, reconciling grill answers 14 (staleness) and 18 (a 10 minute budget):

- Stuck: a running Run whose Heartbeat is older than the staleness threshold. Reuse the existing reaper value (LOCK_STALE_MS in src/server/services/sync-engine.ts), do not invent a second threshold.
- Too slow: a Run whose wall clock time crosses its SLA budget. Default Sync budget is 10 minutes.
- SLA budgets are per Run type, configured in Settings, stored in app_settings.
- On Breach: flag the Run in the UI and raise a Notification. Never auto cancel, since a partial Sync still wrote real rows.

### Data and retention

- Keep log_events as the detail layer, now with run_id. Runs are read from sync_jobs and remix_runs. No new mega table for logs.
- The 50000 row retention cap on log_events is unchanged.
- notifications is a small table, its own modest retention (to decide in the plan, likely keep unread forever, prune read after N days).

## Data model changes

1. log_events: add `run_id text` (nullable), add index on (run_id, id).
2. New table notifications: id, created_at, kind ("run_failed" | "run_finished" | "sla_breach"), run_id, title, body, read_at (nullable).
3. app_settings: add per Run type SLA budget keys (for example syncSlaMinutes default 10) and a notifyOnSuccess flag (default false).

Migration note: the dev db is push based, not migration replay based (memory: dev-db-not-migration-tracked). Apply new DDL by hand with sqlite3 against data/crowsnest.db, do not run db:migrate.

## Open assumptions to confirm during the plan

- SLA is treated as both signals (stuck and too slow). Grill answer 14 alone said staleness only, but answer 18 gave a 10 minute budget, which only means anything as a wall clock signal. If Kai wants staleness only, drop the budget and the syncSlaMinutes setting.

## Related

- ADR 0002 (this change): asset downloads are Steps, not Runs.
- Existing spec 2026-07-31-system-logs-design.md for the redaction rules and the token gated ingest path, both unchanged.
