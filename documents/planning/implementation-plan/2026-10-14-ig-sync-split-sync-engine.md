---
status: active
components: [ig-sync]
backlog: none
owner: null
shipped: null
---

# Split sync-engine.ts implementation plan

> **For agentic workers:** REQUIRED: run with `/poteto-mode`. Execute phase by phase; each phase is one PR and must pass its check before the next starts. Steps use checkbox (`- [ ]`) syntax.

## Goal

`src/server/services/sync-engine.ts` is 2089 lines. Split it into cohesive modules with no behavior change. Each phase moves one cluster, points every caller at the new path, and deletes the old export in the same PR. No re-export shims survive.

## Current shape

| Cluster | Symbols (sync-engine.ts line) |
| --- | --- |
| Lock | `LOCK_STALE_MS` 123, `LIBRARY_LOCK_KEY` 175, `isUniqueViolation` 189, `conflictingRun` 216, `acquireLock` 226, `reapStaleLocks` 268 |
| Job row | `notifyRunFinished` 298, `ProgressPatch`/`progress` 335-354, `RunTracker`/`createTracker` 361-387, `JobFacts`/`JobVerdict`/`finalizeJob` 429-456, `requestCancel` 2068 |
| Retry and pacing | jitter consts 104-105, `MAX_BACKOFF_MS` 127, `jitterMs` 129, `defaultSleep` 133, `retriesFor` 484, `backoffMs` 488, `cancellableDelay` 526, `withLiveness` 565, `sleepUnlessCancelled` 594, `withRetry` 630 |
| View-count enrichment | `enrichmentCandidates` 692, `ENRICH_MAX_CONSECUTIVE_SKIPS` 719, `enrichViewCounts` 754, `__test` 2089 |
| Video persistence | `mediaUrl` 675, `upsertVideo` 931, `upsertChildren` 1007, `softDeleteMissing` 1124, `persistCursor` 1154, `clearCursor` 1163 |
| Scores | `toCalc` 162, `recomputeChannelScores` 1059, `recomputeChannelScoresSync` 1081, `recomputeAllChannelScoresSync` 1112 |
| Channel import | `addChannel` 1901, `importReelByUrl` 1987, `VideoStatsFromYtdlp` 2046 |
| Orchestration | `SyncCounters` 40, `SyncResult` 50, `RunSyncOpts` 63, `zeroCounters` 137, `addCounters` 149, `errorCode` 156, `syncOneChannel` 1172, `runSync` 1647 |

## Target layout

All files under `src/server/services/`.

| Module | Owns | Public exports |
| --- | --- | --- |
| `sync-lock.ts` | running `sync_jobs` rows as locks | `LOCK_STALE_MS`, `LIBRARY_LOCK_KEY`, `isUniqueViolation`, `acquireLock`, `reapStaleLocks` |
| `sync-job.ts` | one `sync_jobs` row: progress, tracker, finalize, cancel flag | `progress`, `createTracker`, `RunTracker`, `finalizeJob`, `notifyRunFinished`, `requestCancel` |
| `sync-retry.ts` | `IgError` retry policy and cancel-aware waits | `withRetry`, `withLiveness`, `sleepUnlessCancelled`, `jitterMs`, `defaultSleep` |
| `sync-enrich.ts` | per-video view-count pass | `enrichViewCounts`, `ENRICH_MAX_CONSECUTIVE_SKIPS`, `__test` |
| `sync-persist.ts` | `videos` rows, children, soft delete, channel cursor | `upsertVideo`, `upsertChildren`, `softDeleteMissing`, `persistCursor`, `clearCursor` |
| `channel-scores.ts` | outlier score recompute | `recomputeChannelScores`, `recomputeAllChannelScoresSync` |
| `channel-import.ts` | add a channel, import one reel | `addChannel`, `importReelByUrl` |
| `sync-engine.ts` (kept) | run orchestration and counters | `runSync`, `RunSyncOpts`, `SyncResult`, `SyncCounters`, the `sync-types` re-export at 38 |

`syncOneChannel` (1172 to 1645, about 475 lines) stays in `sync-engine.ts`. Splitting it is a separate decision, not this plan. Internal helpers only move if a new module needs them; the edge `sync-job` and `sync-retry` both need to reach the cancel flag, so `sync-retry` imports from `sync-job`, never the reverse.

The `normalizeHandle` re-export at 169 is deleted; its callers import `src/lib/handle.ts` directly.

## Risk findings

GitNexus `impact` upstream (repo crowsnest, index 39 commits behind HEAD): `runSync`, `requestCancel`, `recomputeChannelScores`, `recomputeAllChannelScoresSync`, `importReelByUrl` all return CRITICAL with identical counts (49 direct, 101 total), which reads as file-level resolution, not per-symbol. `addChannel` returns UNKNOWN (no callers resolved). Treat all as CRITICAL and confirm by text search. Text search finds these production importers:

| Symbol | Importers |
| --- | --- |
| `runSync` | `src/server/actions/sync-actions.ts:11`, `src/server/services/sync-scheduler.ts:5` |
| `LOCK_STALE_MS` | `src/server/services/sync-scheduler.ts:5`, `src/server/services/sync-scheduler.test.ts:3` |
| `requestCancel`, `addChannel`, `importReelByUrl` | `src/server/actions/sync-actions.ts:11` |
| `normalizeHandle` | `src/server/actions/sync-actions.ts:11`, `src/server/actions/discover-actions.ts:5` |
| `recomputeAllChannelScoresSync` | `src/server/actions/settings-actions.ts:8` |
| `recomputeChannelScores`, `ENRICH_MAX_CONSECUTIVE_SKIPS` | `src/server/services/backfill-view-counts.ts:27` |

Tests import through dynamic `await import("./sync-engine")` (for example `sync-engine.test.ts:633`, `:1937`, `:2038`, `:2410`; `backfill-view-counts.test.ts:206`). Neither test file uses `vi.mock` on the engine, so moves do not break mocks; only the import paths change.

## Phases

Every phase ends with: `npm run typecheck`, `npm run test`, plus the named files green, then `grep -rn "<moved symbol>" src` shows no import from `sync-engine`.

- [ ] **Phase 1, scores.** Create `channel-scores.ts` from 162, 1059-1122. Migrate `settings-actions.ts:8`, `backfill-view-counts.ts:27` (score half), `sync-engine.test.ts:2410`. Delete from engine. Check: `sync-engine.test.ts`, `score-recompute-guard.test.ts`, `settings-actions.test.ts`, `backfill-view-counts.test.ts`.
- [ ] **Phase 2, lock.** Create `sync-lock.ts` from 123, 175-296. Migrate `sync-scheduler.ts:5`, `sync-scheduler.test.ts:3`, `sync-engine.test.ts:633`, `:657`, `:1937`, `:1950`. Check: `sync-engine.test.ts` (concurrency lock, stale-lock safety), `sync-scheduler.test.ts`.
- [ ] **Phase 3, job row and retry.** Create `sync-job.ts` (298-482, 2068) and `sync-retry.ts` (104-135, 484-673). Migrate `sync-actions.ts:11` and every test `requestCancel` import (`sync-engine.test.ts:1415` onward, `backfill-view-counts.test.ts:206`, `:233`). Check: `sync-engine.test.ts` (retry, co-operative cancel, live progress, job bookkeeping), `sync-actions.test.ts`, `backfill-view-counts.test.ts`.
- [ ] **Phase 4, enrichment.** Create `sync-enrich.ts` (692-929, `__test`). Migrate `backfill-view-counts.ts:27` and the `__test` imports in `sync-engine.test.ts` (2038 to 2528). Check: `sync-engine.test.ts` (view count enrichment blocks), `backfill-view-counts.test.ts`.
- [ ] **Phase 5, persistence.** Create `sync-persist.ts` (675-690, 931-1057, 1124-1170). Engine-internal only, no external callers. Check: `sync-engine.test.ts` (idempotence, carousels, soft delete, resume from cursor, snapshot batching).
- [ ] **Phase 6, channel import and handle.** Create `channel-import.ts` (1901-2066). Migrate `sync-actions.ts:11`, `discover-actions.ts:5` (`normalizeHandle` to `src/lib/handle`), `sync-engine.test.ts:1962` to `:2010`. Delete the 169 re-export. Check: `sync-engine.test.ts` (normalizeHandle, addChannel), `sync-actions.test.ts`, `discover.test.ts`.
- [ ] **Phase 7, docs.** Update `documents/architect/core-components/ig-sync/02-architecture.md` with the module table above. Check: `mkdocs build` and `npm run lint`.

## Out of scope

Splitting `syncOneChannel`, splitting `sync-engine.test.ts`, any behavior or signature change.
