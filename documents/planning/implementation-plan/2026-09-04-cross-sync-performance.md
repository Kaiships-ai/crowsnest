# Sync performance: parallel, retry, resume, logs, monitoring

Goal 3. Cross-cutting (sync engine + sidecar + runs/logs). Case C, brainstorm-first.
Branch: `worktree-goal-3-sync-performance`, based on main HEAD. Rebase after Goal 2 merges.

## Problem

Channel sync is correct but serial and non-resumable. `runSync` walks channels in a
deliberate `for` loop (one Instagram account, parallel bursts trip rate limiting). Retry,
backoff, error classification, structured per-run logs, `/runs`, SLA, and a persisted
sidecar cooldown all already exist and are good. The gaps the goal names:

1. No cross-channel parallelism and no concurrency knob. A 5-channel sync pays the full
   serial wall clock even though most of each channel's time is local work (thumbnail
   download, DB writes, scoring) that could overlap the next channel's fetch.
2. Resume is per-run only: the pagination cursor lives in a local variable, so an
   interrupted run restarts newest-first instead of continuing where it stopped.
3. Per-media O(n) DB round trips: each item does its own `upsertVideo`, `upsertChildren`,
   and `videoSnapshots` insert. A page of 30 is 30+ transactions.
4. No last-run-health / run-summary query for the MCP `crowsnest_metrics` tool.
5. After Goal 2 deletes cook create-runs, sync-run visibility in `/runs` becomes ours.

## Verification that fixes the concurrency-safety question (decides the default)

The sidecar serializes every Instagram call through one process-global lock, so raising
Node-side concurrency cannot produce concurrent IG traffic:

- `services/ig/crowsnest_ig/session.py:221` — the long-lived session manager holds one
  `threading.RLock()`. Every upstream method (`profile`, `medias`, `media_info`, login)
  wraps `with self._lock:` and calls `_enforce_cooldown()` inside it
  (`session.py:370`, `:523`, `:601`).
- `session.py:220` — one `Cooldown(config.cooldown_path)` on that single manager;
  `config.py:136` derives one file path (`<session>.cooldown`). The limiter is already a
  single process-global instance backed by one file; nothing to "make global".
- FastAPI sync endpoints run in the threadpool, so two Node requests land on two threads
  and queue on the RLock rather than racing the instagrapi client (which its own docstring
  says is not thread-safe).

Conclusion: **default `SYNC_CONCURRENCY = 2`** (per orchestrator ruling). The win is
pipelining, not concurrent IG calls: while channel A does its local batch write and
scoring, channel B's `medias` fetch runs. The sidecar RLock + cooldown remain the hard
ceiling on IG traffic; the knob never lets Node exceed it. Task T3 re-confirms the
threadpool assumption with a concurrent-request test against a stub before enabling >1.

## Tasks (SDD, fresh implementer per task, per-task review, final whole-branch review)

### T1 — Foundations: knob, error classes, batch helper
- Add `syncConcurrency` to the settings module (env `SYNC_CONCURRENCY`, DB-overridable like
  `syncLookbackDays`), default 2, clamped `>=1`. Echo it into `SyncProgress`/`sync_jobs`
  so `/runs` can show the concurrency a run used.
- Classify `IgErrorCode` into `transient | auth | challenge | fatal` (add-only mapping in
  `ig/errors.ts`; keep existing codes). Retry only `transient`; surface `auth`/`challenge`
  as a distinct gap so the UI can prompt re-login instead of silently retrying.
- Add a batched-insert helper for `videoSnapshots` and child rows (drizzle multi-row
  `insert().values([...])`), used in T4.
- Acceptance: settings test for the knob (default + override + clamp); errors test mapping
  each code to a class; helper unit test.

### T2 — Resume from persisted cursor
- Add `channels.syncCursor`, `channels.syncCursorRunId`, `channels.syncBoundary` (all
  nullable). `npm run db:generate` migration.
- In `syncOneChannel`: on entry, if the channel has a saved cursor from a run that did not
  finish its window, resume the page loop from it (same boundary). On a clean window finish
  (`lookback`/`exhausted`) or a fresh full walk, clear the three columns. On `cap`,
  `cancelled`, or a channel gap, persist the last good cursor + boundary + runId so the next
  run continues.
- Guard: only resume when the saved boundary still covers today's lookback window; a widened
  lookback or a stale cursor (> lookback age) forces a fresh walk, not a silent short read.
- Acceptance: a test that runs a channel to a forced mid-window stop, asserts the cursor
  persisted, then a second run resumes from it and does not re-fetch page 1. Live proof in
  verification: kill a run mid-way, restart, confirm continuation in `/runs` + logs.

### T3 — Bounded concurrency in runSync
- Replace the sequential `for (const channel of channelRows)` with a bounded worker pool of
  size `syncConcurrency`. Preserve every existing invariant: per-channel lock semantics,
  cancel checked at boundaries, gaps collected, counters summed, soft-delete gated on full
  enumeration. Tracker flushes stay per-channel; `currentChannelHandle` becomes "the set in
  flight" (show the first, count the rest) rather than a lie about a single channel.
- At `syncConcurrency = 1` the behavior is byte-for-byte today's serial walk (test asserts
  ordering is preserved at 1).
- Confirm the sidecar threadpool assumption with a concurrent-request test through the
  `IgClient` stub: two `medias` calls in flight serialize and neither corrupts the other's
  cursor.
- Acceptance: concurrency test (N channels, concurrency 2, all complete, counters correct,
  no interleaving corruption); cancel-mid-pool test; `=1` equivalence test.

### T4 — Scalable batching
- Per page, collect the page's upserts and write them in the fewest statements: batch the
  `videoSnapshots` inserts and child rows; keep `upsertVideo` per-item only where the
  create/update branch needs the returned id, else batch. Keep per-item failure isolation:
  a batch that hits a bad row falls back to per-row for that page so one poison item costs
  one item, not the page (preserves today's guarantee).
- Acceptance: a page of N items issues O(1) snapshot inserts not O(N) (spy on the db);
  poison-row test still isolates to one `itemsFailed`.

### T5 — Logs, monitoring, metrics query
- Ensure per-run rows carry phase, channel, counts, duration, and error class into `/logs`
  and the runs query. Add `getLastRunHealth()` / run-summary to `src/server/queries/runs.ts`
  (or a sibling) returning `{ lastStatus, startedAt, finishedAt, durationMs, channelsDone,
  itemsCreated/Updated/Failed, gaps, concurrency }` for the dashboard and for the MCP
  `crowsnest_metrics` tool. Hand the shape to Goal 2; do not edit `mcp-server.ts`.
- Goal 2 is KEEPING `/runs` (it renders sync + remix), so I **enhance the existing page**
  (surface phase / error class / concurrency / duration), never recreate it. Those page
  edits land **only after Goal 2's PR merges** (avoid both panes touching
  `src/app/(shell)/runs` in flight; Goal 2 pane term_94189a6a). Until then the query +
  `/logs` carry visibility; the page edit is the last commit, after a rebase onto merged G2.
- Acceptance: query test over seeded sync_jobs; last-run-health returns null-not-zero when
  no run exists (honest-surfaces rule).

### T6 — Tests, docs, verification
- Full new-test sweep green (concurrency, retry classes, resume, batching).
- Update `documents/architect/core-components/ig-sync/01..05` via `crowsnest-document-component`
  (house style: no em/en dashes, straight quotes, sentence-case headings, grounded).
  Record the before/after 5-channel wall clock in `05` and the PR.
- `verification-before-completion` with real data: copy main-tree `data/crowsnest.db`
  into the worktree; run `npm run verify:live -- @handle` for the timing number (live
  sidecar, throwaway account) or, if live is withheld, time a 5-channel run against the
  copied DB's channels and state the measurement basis.

## Gate: full CI before every commit
`npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`, working tree clean.

## Assumptions (ponytail defaults where no ruling)
- Resume cursor lives on `channels` (orchestrator D2), not a new per-run table.
- `currentChannelHandle` semantics change is the smallest honest fix for a parallel run
  rather than adding a new "channels in flight" array column.
- `crowsnest_metrics` shape is coordinated with Goal 2, not defined here.

## Out of scope / do not touch
Publish endpoints (Goal 4). Studio/terminal code (Goal 2, being deleted). `mcp-server.ts`
(hand the query to Goal 2). The main-tree uncommitted gitnexus/evidence changes.
