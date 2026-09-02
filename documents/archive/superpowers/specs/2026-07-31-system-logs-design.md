# System logs design

Date: 2026-07-31
Status: approved, ready for implementation plan

## Problem

The app has a structured logger (`src/server/lib/logger.ts`) and the Python
sidecar has its own (`services/ig/crowsnest_ig/logging.py`), but both write only
to stdout/stderr. Nothing is persisted, nothing is viewable in the app. Close the
terminal and the history is gone. Only sync failures surface in-app, through the
`sync_jobs` table and the shell failure strip.

The pain this fixes: an operator cannot answer "why did last night's sync die" or
"when did the Instagram session expire" without the raw terminal open at the time.
Instagram session invalidation is logged inside the sidecar, the one process whose
output is least likely to be watched.

## Goals

- Persist log events from all three sources: Next backend, the browser frontend,
  and the Python sidecar.
- One screen to read them, defaulting to problems only (warn and error), with a
  toggle to see every level.
- Never persist a credential, token, cookie, or session blob.
- Add no dependency and no background service. This is a local-first single-user app.

## Non-goals (scope cuts)

Deferred, not in this build: auto-poll or live streaming (SSE/websocket), an
unread-error badge in the nav, manual per-action client log calls, log export, and
persisting `debug`-level events (those stay stdout only).

## Decisions

Recorded from the brainstorm so the plan does not relitigate them.

- Capture everything at the db level (info/warn/error). Viewer defaults to
  problems only, with a "show everything" toggle.
- Sources: backend, frontend, sidecar.
- Sidecar reaches the db by pushing: it POSTs each event to a Next endpoint. Next
  never tails the sidecar's stdout and never spawns it.
- Retention: cap by row count. Keep the newest 50k events, prune the oldest.
- Viewer is a new top-level `/logs` route with its own nav item, treated as a
  feature, not a settings sub-panel.
- Refresh is manual: load on open, plus a Refresh button.
- New-error signal reuses the existing failure strip. No new badge.
- Frontend capture is unhandled errors and unhandled promise rejections only.
- `debug` level is not persisted. stdout only.

## Data model

New table `log_events`, added as drizzle migration `0009` (latest committed is
`0008`). Schema lives in `src/server/db/schema.ts`.

| column | type | note |
|--------|------|------|
| id | integer primary key autoincrement | ordering and cursor |
| ts | text | ISO 8601, supplied by the emitter |
| level | text | one of info, warn, error (debug is not stored) |
| source | text | one of backend, frontend, sidecar |
| event | text | dotted stable name, e.g. `ig.session.expired` |
| fields | text | JSON object, already redacted |

Indexes on `(level, id)` and `(source, id)` so the problems-only default and the
source filter stay fast at 50k rows.

## Capture per source

### Backend

`src/server/lib/logger.ts` keeps writing to stdout/stderr and also inserts a row
for info/warn/error. The insert is wrapped in try/catch: a logging failure must
never break the caller that emitted the log. The redaction the logger already runs
(`REDACT_KEYS`) applies before the row is built, so the stored `fields` is clean.

### Sidecar

The Python sidecar POSTs each event to `POST /api/logs/ingest` on the Next server,
with header `X-IG-Token` set to `IG_SERVICE_TOKEN`. That is the same shared secret
and the same header the Next to Python hop already uses, so no new credential is
introduced. The post is fire-and-forget with a short timeout: a slow or down Next
server must never stall the sidecar's real work. If the post fails, the event is
still on the sidecar's stdout, so nothing is lost that was not lost before.

### Frontend

A React error boundary plus `window.onerror` and an `unhandledrejection` listener
POST unhandled errors to the same `/api/logs/ingest` endpoint. Same origin, so no
token. Source is recorded as `frontend`.

## Ingest endpoint

`POST /api/logs/ingest`:

1. Validate the body shape with zod (ts, level, source, event, fields).
2. Reject a `source: "sidecar"` post whose `X-IG-Token` is missing or does not
   match `IG_SERVICE_TOKEN` (constant-time compare, same as the sidecar does).
3. Re-run the `REDACT_KEYS` guard from logger.ts. The sidecar and the browser are
   not trusted to have redacted, so the endpoint redacts again before insert.
4. Insert the row.

## Retention

After an insert, if the row count exceeds 50k, delete the oldest rows down to 50k
with a single `DELETE FROM log_events WHERE id < (subquery for the 50k-th newest
id)`. Runs inline, cheap at this scale.

## Viewer: `/logs`

A new route under the shell, with a nav item added to
`src/components/layout/nav-items.ts`.

- Server component reads the latest rows.
- Default filter: level in (warn, error). A "show everything" toggle flips to all
  stored levels.
- Filters: level, source, event name, time range, and free-text search over event
  and fields.
- Each row expands inline to show the full `fields` JSON.
- A Refresh button re-reads. No auto-poll.
- Empty state when nothing matches the current filter.

## Redaction

One redaction rule, the existing `REDACT_KEYS` set in logger.ts, applied at both
insert points: the backend logger and the ingest endpoint. A key named password,
token, cookie, session, or the other members of that set is replaced with a
`_redacted` marker and never stored as a value.

## Testing

- Backend logger insert path: emitting a log writes a row, and a forced db error
  does not throw out of `log.*`.
- Ingest endpoint: rejects a sidecar post with a bad token, accepts a frontend
  post without one, redacts a payload that carries a password, rejects a malformed
  body.
- Retention: after crossing 50k, the oldest rows are pruned and the newest 50k
  remain.
- Viewer query: the problems-only default, each filter, and free-text search
  return the right rows.

## Open questions

None. The debug-persistence question was resolved to "do not persist debug."
