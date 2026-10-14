---
status: active
components: [ig-sync]
backlog: none
owner: session_018UKVywpMReUetCRn75udYT
shipped: null
---

# Sync freshness + scheduled sync Implementation Plan

> **For agentic workers:** REQUIRED: run with `/poteto-mode` (recommended), or execute the plan directly in this session — phase by phase, verifying each phase before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give sync a trustworthy per-channel "completed" timestamp, let a library sweep skip channels that were successfully synced within a freshness window, run sync automatically on the existing `syncCadenceMinutes` cadence, and (only if measured to help) parallelise per-page thumbnail downloads.

**Architecture:** Steps 3-5 of the sync redesign, building on PR #56 (AI passes removed from sync, `SYNC_CONCURRENCY` default 1). Step 3 adds a `lastSuccessfulSyncAt` column stamped at the *end* of a clean channel sync (never at the start, unlike the untrustworthy `lastSyncedAt`), plus a `skipFreshWithinMinutes` option on `runSync` that drops fresh channels from a library sweep. Step 4 adds an in-process `sync-scheduler.ts` that mirrors `publish-scheduler.ts` exactly (one `setInterval`, reentrancy guard, never-throws tick), reads the `syncCadenceMinutes` setting, uses the newest `sync_jobs` row as the durable "last run" marker (no new table), and starts a library sweep with the step-3 skip when the cadence has elapsed and no sync is running. It boots from `server.ts` beside the publish scheduler. Step 5 is an optional, measurement-gated micro-optimisation of per-page thumbnail downloads (Instagram CDN GETs, not private-API calls, so not behind the sidecar's session lock).

**Tech Stack:** TypeScript, Next.js (custom `server.ts`), Drizzle ORM over better-sqlite3, drizzle-kit migrations, Vitest, Zod (settings schema).

**Spec:** `/tmp/crowsnest-handoff-sync-redesign.md` (the converged two-agent design; steps 3-5 of "The task" and the "Binding constraints for the redesign" section). No formal spec doc exists; this plan is the spec of record for these three steps.

## Global Constraints

- **Do NOT reintroduce any AI pass into the sync path.** Sync mirrors Instagram metadata and assets only (PR #56). No downloads-for-analysis, no transcription, no LLM calls anywhere reachable from `runSync`/`syncOneChannel`/the scheduler.
- **No parallel Instagram traffic, ever.** The sidecar holds one Instagram session behind a process-global lock with a 1-3s inter-call delay. Concurrency knobs may only overlap local work (thumbnail download, DB writes, scoring). The scheduler starts exactly one library sweep at a time.
- **No same-account session pool.** Refused by design (ban vector).
- **Never trust `lastSyncedAt` as a completion time.** It is written near the *start* of a channel sync, right after the profile call (`sync-engine.ts:1308`). A channel cancelled mid-walk looks fresh under it. All freshness logic in this plan uses `lastSuccessfulSyncAt`, stamped at the end of a clean sync.
- **Migrations are numbered sequentially and must not collide.** Next number is `0026`. Generate with `npm run db:generate` (drizzle-kit), never hand-number. After generating, verify exactly one new `drizzle/00NN_*.sql` file and one new entry in `drizzle/meta/_journal.json`.
- **Gate before every commit that touches code:** `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`. Working tree stays clean.
- **Settings module invariants:** every key appears in `AppSettings`, `DB_KEY`, `SCHEMA`, `DEFAULT`, and `WIRED`. `config.test.ts` and `settings` tests assert defaults; update them in the same task that changes a default.
- **Timers are not durable across restart.** Any "is it due" decision must be derived from persisted state (`sync_jobs` rows, `app_settings`), never from in-memory counters. `server.ts` rebuilds every timer at boot.
- Docs writing rule (enforced by review, not hooks): no em/en dashes, straight quotes, sentence-case headings, grounded to code.

---

## File Structure

**Step 3 (freshness):**
- `src/server/db/schema.ts` — add `lastSuccessfulSyncAt` column to `channels`.
- `drizzle/0026_*.sql` + `drizzle/meta/_journal.json` — generated migration.
- `src/server/services/sync-engine.ts` — stamp `lastSuccessfulSyncAt` at clean channel completion; add `skipFreshWithinMinutes` to `RunSyncOpts` and apply it to the library-sweep channel selection.
- `src/server/services/sync-engine.test.ts` — tests for the stamp and the skip.
- `src/server/db/schema.test.ts` — column presence (if that file asserts column sets).

**Step 4 (scheduled sync):**
- `src/server/services/sync-scheduler.ts` (new) — `runDueSync` + `startSyncScheduler`, modelled on `publish-scheduler.ts`.
- `src/server/services/sync-scheduler.test.ts` (new) — fake-deps tests.
- `src/server/settings/index.ts` — flip `syncCadenceMinutes` `WIRED` to true.
- `server.ts` — boot `startSyncScheduler` beside `startPublishScheduler`.
- `documents/architect/core-components/ig-sync/02-architecture.md` — document the scheduler and the freshness skip.

**Step 5 (optional thumbnail concurrency):**
- `src/server/services/sync-engine.ts` — bounded-concurrency thumbnail fetch per page.
- `src/server/services/sync-engine.test.ts` — assert per-page concurrency is bounded and counters are unchanged.

---

## Phase 1 — Step 3: trustworthy `lastSuccessfulSyncAt` + freshness skip

### Task 1: Add the `lastSuccessfulSyncAt` column and migration

**Files:**
- Modify: `src/server/db/schema.ts:74` (after `lastFullSyncAt`)
- Create: `drizzle/0026_*.sql` (generated)
- Modify: `drizzle/meta/_journal.json` (generated)

**Interfaces:**
- Produces: `tables.channels.lastSuccessfulSyncAt` — `text("last_successful_sync_at")`, nullable, on the `channels` table.

- [ ] **Step 1: Add the column to the schema**

In `src/server/db/schema.ts`, immediately after the `lastFullSyncAt` field (line 74), add:

```ts
  /** ISO time this channel's most recent sync COMPLETED cleanly (any non-cancelled,
   *  non-errored stop: lookback, exhausted, cap, or an incremental up-to-date stop).
   *  Unlike `lastSyncedAt`, which is written near the START of a channel sync right after
   *  the profile call and so reads "fresh" for a channel cancelled mid-walk, this is
   *  written only at the end of a channel that finished without error. It is the only
   *  timestamp the freshness skip and the scheduler trust. Null until the first clean sync. */
  lastSuccessfulSyncAt: text("last_successful_sync_at"),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: one new file `drizzle/0026_<name>.sql` containing `ALTER TABLE \`channels\` ADD \`last_successful_sync_at\` text;`, and one new entry appended to `drizzle/meta/_journal.json` with `"idx": 26`.

- [ ] **Step 3: Verify no collision**

Run: `ls drizzle/ | tail -3 && tail -8 drizzle/meta/_journal.json`
Expected: `0026_*.sql` is the highest-numbered file, and the journal's last entry has `"idx": 26` and a matching `"tag"`. If a `0026` already exists or the journal has a duplicate idx, STOP and reconcile (this is the exact failure the handoff's hotfix #55 fixed).

- [ ] **Step 4: Verify the schema test still passes**

Run: `npx vitest run src/server/db/schema.test.ts`
Expected: PASS (the in-memory migrate applies the new column).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/0026_*.sql drizzle/meta/_journal.json
git commit -m "feat(sync): add channels.last_successful_sync_at column"
```

---

### Task 2: Stamp `lastSuccessfulSyncAt` at clean channel completion

**Files:**
- Modify: `src/server/services/sync-engine.ts` (the happy-path tail of `syncOneChannel`, immediately before `log.info("sync.channel.finished", ...)` at line 1596)
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `tables.channels.lastSuccessfulSyncAt` (Task 1); the local `stopReason`, `channel.id`, `opts.now()`, `db`, `tables`, `eq` already in scope in `syncOneChannel`.
- Produces: on a channel sync whose `stopReason !== "cancelled"`, `channels.last_successful_sync_at` is set to `opts.now().toISOString()`.

- [ ] **Step 1: Write the failing test**

Add to `src/server/services/sync-engine.test.ts` (mirror the existing `beforeEach` migrate + `db.insert(tables.channels)` seeding pattern already used in that file, e.g. around lines 205-213):

```ts
test("stamps lastSuccessfulSyncAt on a clean sync, leaving it null before", async () => {
  const { migrate } = await import("../db/test-migrate");
  migrate();
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: "cleanstamp",
    trackedSince: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });

  const before = await db
    .select({ ts: tables.channels.lastSuccessfulSyncAt })
    .from(tables.channels)
    .where(eq(tables.channels.id, channelId));
  expect(before[0].ts).toBeNull();

  const now = () => new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
  await runSync({ channelIds: [channelId], client: stubClient({ pages: pages() }).client, sleep: noopSleep, now });

  const after = await db
    .select({ ts: tables.channels.lastSuccessfulSyncAt })
    .from(tables.channels)
    .where(eq(tables.channels.id, channelId));
  expect(after[0].ts).toBe("2026-06-01T12:00:00.000Z");
});
```

Note: `eq` is already imported at the top of the test file (it drives the other channel-scoped assertions). `stubClient`, `pages`, `noopSleep`, `newId` are the helpers this file already defines/imports; reuse them exactly as the neighbouring tests do rather than inventing new fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "stamps lastSuccessfulSyncAt"`
Expected: FAIL — `after[0].ts` is `null` because nothing writes the column yet.

- [ ] **Step 3: Write the implementation**

In `src/server/services/sync-engine.ts`, in `syncOneChannel`, immediately before the final `log.info("sync.channel.finished", ...)` line (currently 1596), add:

```ts
    // Stamp the trustworthy completion time. Any stop that is not a user cancel means this
    // channel finished a sync without error and its newest posts are current, which is what
    // the library-sweep freshness skip and the scheduler read. A cancel leaves it untouched
    // so a run stopped mid-walk never masquerades as fresh (unlike lastSyncedAt, written at
    // the top of this function). Never throws for the same reason the rest of this tail does
    // not: a bookkeeping write must not turn a completed channel into a gap.
    if (stopReason !== "cancelled") {
      await db
        .update(tables.channels)
        .set({ lastSuccessfulSyncAt: opts.now().toISOString() })
        .where(eq(tables.channels.id, channel.id));
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "stamps lastSuccessfulSyncAt"`
Expected: PASS.

- [ ] **Step 5: Add the cancel-path test**

```ts
test("does not stamp lastSuccessfulSyncAt when the channel sync is cancelled", async () => {
  const { migrate } = await import("../db/test-migrate");
  migrate();
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: "cancelstamp",
    trackedSince: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });

  // Cancel before the run starts: the worker observes the cancel and never completes the
  // channel cleanly, so the column stays null. Uses the same cancel-driving pattern the
  // existing "cancel" tests in this file use (requestCancel on the job id via onJobStarted).
  let jobId = "";
  await runSync({
    channelIds: [channelId],
    client: stubClient({ pages: pages() }).client,
    sleep: noopSleep,
    onJobStarted: (id) => {
      jobId = id;
      void requestCancel(id);
    },
  });

  const after = await db
    .select({ ts: tables.channels.lastSuccessfulSyncAt })
    .from(tables.channels)
    .where(eq(tables.channels.id, channelId));
  expect(jobId).not.toBe("");
  expect(after[0].ts).toBeNull();
});
```

Import `requestCancel` from `../services/sync-engine` at the top of the test file if it is not already imported there (it is exported from `sync-engine.ts` and re-used by `sync-actions.ts`). If the existing cancel tests in this file drive cancellation a different way, copy that exact mechanism instead of this one.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "lastSuccessfulSyncAt"`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/sync-engine.ts src/server/services/sync-engine.test.ts
git commit -m "feat(sync): stamp lastSuccessfulSyncAt at clean channel completion"
```

---

### Task 3: Add `skipFreshWithinMinutes` to a library sweep

**Files:**
- Modify: `src/server/services/sync-engine.ts` (`RunSyncOpts` at line 64-93; the library-sweep branch of the channel selection at lines 1705-1713)
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `tables.channels.lastSuccessfulSyncAt` (Task 1); `opts.now()`; `db`, `tables`, `eq`, `and`, `inArray`, `isNull` already imported in `sync-engine.ts`.
- Produces: `RunSyncOpts.skipFreshWithinMinutes?: number`. When set to a positive number AND the run is a library sweep (no `channelIds`), channels whose `lastSuccessfulSyncAt` is newer than `now - skipFreshWithinMinutes*60_000` are excluded from `channelRows`. A run scoped to explicit `channelIds` NEVER skips (an explicit ask is honoured). `0` or `undefined` means no skip. Consumed by the scheduler in Task 5.

- [ ] **Step 1: Add the option to `RunSyncOpts`**

In `src/server/services/sync-engine.ts`, inside `RunSyncOpts` (before `onJobStarted`, line 92), add:

```ts
  /**
   * Only meaningful for a library sweep (no `channelIds`). When > 0, a channel whose
   * `lastSuccessfulSyncAt` is within this many minutes of now is left out of the run: it
   * was synced recently enough that re-walking it now would only spend Instagram requests
   * for nothing. A run scoped to explicit `channelIds` ignores this — naming a channel is
   * an explicit "sync it now". Defaults to 0 (no skip); the scheduler passes the cadence.
   */
  skipFreshWithinMinutes?: number;
```

- [ ] **Step 2: Write the failing test**

```ts
test("library sweep skips a channel synced within skipFreshWithinMinutes", async () => {
  const { migrate } = await import("../db/test-migrate");
  migrate();
  const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

  const freshId = newId();
  const staleId = newId();
  await db.insert(tables.channels).values([
    {
      id: freshId,
      platform: "instagram",
      handle: "freshchan",
      trackedSince: iso(0),
      // synced 10 minutes ago -> inside a 30-minute skip window
      lastSuccessfulSyncAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
    },
    {
      id: staleId,
      platform: "instagram",
      handle: "stalechan",
      trackedSince: iso(0),
      // synced 90 minutes ago -> outside the window, must be swept
      lastSuccessfulSyncAt: new Date(now.getTime() - 90 * 60_000).toISOString(),
    },
  ]);

  const result = await runSync({
    client: stubClient({ pages: pages() }).client,
    sleep: noopSleep,
    now: () => now,
    skipFreshWithinMinutes: 30,
  });

  // Only the stale channel was walked; the fresh one was skipped entirely.
  const fresh = await db.select({ ts: tables.channels.lastSuccessfulSyncAt }).from(tables.channels).where(eq(tables.channels.id, freshId));
  const stale = await db.select({ ts: tables.channels.lastSuccessfulSyncAt }).from(tables.channels).where(eq(tables.channels.id, staleId));
  expect(fresh[0].ts).toBe(new Date(now.getTime() - 10 * 60_000).toISOString()); // untouched
  expect(stale[0].ts).toBe(now.toISOString()); // freshly stamped by this sweep
});
```

`iso` is the local helper already used elsewhere in the file for building ISO timestamps; if it is not present in this test file, inline `new Date(Date.UTC(2026, 0, 1)).toISOString()`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "skips a channel synced within"`
Expected: FAIL — both channels are swept, so `fresh[0].ts` is stamped to `now` instead of staying at the 10-minutes-ago value.

- [ ] **Step 4: Write the implementation**

In `src/server/services/sync-engine.ts`, replace the library-sweep branch of the channel selection (currently lines 1710-1713, the `: await db.select().from(tables.channels).where(and(eq(...platform...), isNull(...deletedAt...)))` branch) so the freshness filter is applied only to the sweep. The scoped branch (lines 1705-1709) is unchanged. Concretely:

```ts
    const skipBeforeIso =
      opts.channelIds || !opts.skipFreshWithinMinutes || opts.skipFreshWithinMinutes <= 0
        ? null
        : new Date(now().getTime() - opts.skipFreshWithinMinutes * 60_000).toISOString();

    const channelRows = opts.channelIds
      ? await db
          .select()
          .from(tables.channels)
          .where(and(inArray(tables.channels.id, opts.channelIds), isNull(tables.channels.deletedAt)))
      : await db
          .select()
          .from(tables.channels)
          .where(
            and(
              eq(tables.channels.platform, "instagram"),
              isNull(tables.channels.deletedAt),
              // Skip channels synced within the window. `lt(lastSuccessfulSyncAt, cutoff)`
              // alone would also drop never-synced channels (NULL is never < anything), so a
              // channel that has never had a clean sync must always be included.
              ...(skipBeforeIso
                ? [or(isNull(tables.channels.lastSuccessfulSyncAt), lt(tables.channels.lastSuccessfulSyncAt, skipBeforeIso))]
                : [])
            )
          );
```

Add `lt` and `or` to the existing `drizzle-orm` import at the top of `sync-engine.ts` if they are not already imported there (the file already imports `and`, `eq`, `inArray`, `isNull` from `drizzle-orm`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "skips a channel synced within"`
Expected: PASS.

- [ ] **Step 6: Add the never-synced guard test**

```ts
test("library sweep never skips a channel that has never synced cleanly", async () => {
  const { migrate } = await import("../db/test-migrate");
  migrate();
  const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
  const neverId = newId();
  await db.insert(tables.channels).values({
    id: neverId,
    platform: "instagram",
    handle: "neverchan",
    trackedSince: iso(0),
    // lastSuccessfulSyncAt left null
  });

  await runSync({
    client: stubClient({ pages: pages() }).client,
    sleep: noopSleep,
    now: () => now,
    skipFreshWithinMinutes: 30,
  });

  const row = await db.select({ ts: tables.channels.lastSuccessfulSyncAt }).from(tables.channels).where(eq(tables.channels.id, neverId));
  expect(row[0].ts).toBe(now.toISOString()); // swept despite the skip window
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/server/services/sync-engine.test.ts -t "never skips a channel that has never"`
Expected: PASS.

- [ ] **Step 8: Full gate + commit**

```bash
npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh
git add src/server/services/sync-engine.ts src/server/services/sync-engine.test.ts
git commit -m "feat(sync): add skipFreshWithinMinutes skip for library sweeps"
```

---

## Phase 2 — Step 4: scheduled sync

### Task 4: Build the sync scheduler module (`runDueSync`)

**Files:**
- Create: `src/server/services/sync-scheduler.ts`
- Test: `src/server/services/sync-scheduler.test.ts`

**Interfaces:**
- Consumes: `getSetting("syncCadenceMinutes")` (settings/index.ts); `runSync` (sync-engine.ts); `db`, `tables`, `desc` (drizzle-orm) for the latest `sync_jobs` row.
- Produces:
  - `export interface SyncSchedulerDeps { cadenceMinutes(): Promise<number>; latestJob(): Promise<{ status: string; startedAt: string } | null>; startSweep(skipFreshWithinMinutes: number): Promise<void>; }`
  - `export interface SyncTickResult { started: boolean; reason: "disabled" | "running" | "not_due" | "started"; }`
  - `export async function runDueSync(now?: Date, deps?: Partial<SyncSchedulerDeps>): Promise<SyncTickResult>`
  - `export function startSyncScheduler(deps?: Partial<SyncSchedulerDeps> & { intervalMs?: number }): () => void`

**Design notes (why this shape):**
- The "last run" marker is the newest `sync_jobs` row's `startedAt`, not a new table and not a settings row. Any sync (manual or scheduled) writes a `sync_jobs` row, so any sync resets the cadence clock — which is the behaviour we want (a manual sync 2 minutes ago should defer the scheduled one). This is durable across restart for free.
- Due when: cadence > 0 (0 means disabled), AND no job is currently `running`, AND (there is no prior job OR `now - latestJob.startedAt >= cadenceMinutes`).
- On due, it starts a library sweep passing `skipFreshWithinMinutes = cadenceMinutes` so even the swept run only touches channels actually stale (belt and suspenders against a job row that exists but did not cover every channel).
- Never throws (same contract as `runDuePublishes`).

- [ ] **Step 1: Write the failing test**

Create `src/server/services/sync-scheduler.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { runDueSync } from "./sync-scheduler";

const iso = (ms: number, base = Date.UTC(2026, 0, 1)) => new Date(base + ms).toISOString();

describe("runDueSync (fake deps)", () => {
  test("disabled when cadence is 0", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(0)), {
      cadenceMinutes: async () => 0,
      latestJob: async () => null,
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "disabled" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("skips while a sync is running", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(60 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "running", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "running" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("not due when the last run is inside the cadence window", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(10 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "not_due" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("starts a sweep when due, passing the cadence as the skip window", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(31 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: true, reason: "started" });
    expect(startSweep).toHaveBeenCalledWith(30);
  });

  test("starts a sweep on a fresh install with no prior job", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(0)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => null,
      startSweep,
    });
    expect(r).toEqual({ started: true, reason: "started" });
    expect(startSweep).toHaveBeenCalledWith(30);
  });

  test("never throws when startSweep rejects", async () => {
    const startSweep = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await runDueSync(new Date(iso(31 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    // The tick resolves; the error was logged, not thrown.
    expect(r.started).toBe(false);
    expect(r.reason).toBe("started"); // it attempted a start; the failure is swallowed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/sync-scheduler.test.ts`
Expected: FAIL — module `./sync-scheduler` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/server/services/sync-scheduler.ts`:

```ts
import { desc } from "drizzle-orm";
import { db, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { getSetting } from "@/server/settings";
import { runSync } from "./sync-engine";

/**
 * The in-process sync scheduler, modelled exactly on publish-scheduler.ts: one
 * setInterval in one process, a reentrancy guard, and a tick (runDueSync) that never
 * throws. Started once from server.ts. It exists to consume the syncCadenceMinutes
 * setting, which has always been stored but never read.
 *
 * The cadence clock is the newest sync_jobs row's startedAt, not a new table: any sync
 * (manual or scheduled) writes one, so a manual sync also defers the next scheduled one,
 * and the marker is durable across a restart for free (server.ts rebuilds the timer at
 * boot, but the "when did we last sync" answer lives in the database).
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SyncSchedulerDeps {
  /** The syncCadenceMinutes setting. 0 disables the scheduler. */
  cadenceMinutes: () => Promise<number>;
  /** The newest sync_jobs row, or null on a fresh install. */
  latestJob: () => Promise<{ status: string; startedAt: string } | null>;
  /** Starts a detached library sweep that skips channels synced within the window. */
  startSweep: (skipFreshWithinMinutes: number) => Promise<void>;
}

async function defaultLatestJob(): Promise<{ status: string; startedAt: string } | null> {
  const [row] = await db
    .select({ status: tables.syncJobs.status, startedAt: tables.syncJobs.startedAt })
    .from(tables.syncJobs)
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1);
  return row ?? null;
}

// The scheduler starts a library sweep the same detached way startSyncAction does, but it
// is not a "use server" action and has no request scope, so it calls runSync directly and
// lets the returned promise run to completion. runSync writes its own terminal job row, so
// a rejection here only needs logging, not row bookkeeping.
async function defaultStartSweep(skipFreshWithinMinutes: number): Promise<void> {
  await runSync({ skipFreshWithinMinutes });
}

const DEFAULT_DEPS: SyncSchedulerDeps = {
  cadenceMinutes: () => getSetting("syncCadenceMinutes"),
  latestJob: defaultLatestJob,
  startSweep: defaultStartSweep,
};

export interface SyncTickResult {
  started: boolean;
  reason: "disabled" | "running" | "not_due" | "started";
}

/** One scheduler tick. Never throws. */
export async function runDueSync(now: Date = new Date(), deps: Partial<SyncSchedulerDeps> = {}): Promise<SyncTickResult> {
  const d: SyncSchedulerDeps = { ...DEFAULT_DEPS, ...deps };

  let cadence: number;
  let latest: { status: string; startedAt: string } | null;
  try {
    cadence = await d.cadenceMinutes();
    if (cadence <= 0) return { started: false, reason: "disabled" };
    latest = await d.latestJob();
  } catch (err) {
    log.error("sync_scheduler.read_state_failed", { error: errorMessage(err) });
    return { started: false, reason: "not_due" };
  }

  if (latest?.status === "running") return { started: false, reason: "running" };

  if (latest) {
    const elapsedMs = now.getTime() - new Date(latest.startedAt).getTime();
    if (elapsedMs < cadence * 60_000) return { started: false, reason: "not_due" };
  }

  // Fire-and-forget: the sweep runs for minutes; a tick must not await it or the reentrancy
  // guard would hold `running` true for the whole sweep. startSweep's own errors are logged.
  d.startSweep(cadence).catch((err) => log.error("sync_scheduler.start_sweep_failed", { error: errorMessage(err) }));
  return { started: true, reason: "started" };
}
```

Note on the "never throws when startSweep rejects" test: `startSweep` is called without `await` (fire-and-forget) and its rejection is attached to a `.catch`, so `runDueSync` returns `{ started: true, reason: "started" }` before the rejection settles. That matches the test's expectation. If a subagent finds the unawaited-rejection timing flaky under vitest, change the test to `await new Promise((r) => setTimeout(r, 0))` after the call and assert the `.catch` logger fired via a spy on `log.error` instead — do not make `runDueSync` await the sweep.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/services/sync-scheduler.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/sync-scheduler.ts src/server/services/sync-scheduler.test.ts
git commit -m "feat(sync): add in-process sync scheduler (runDueSync)"
```

---

### Task 5: Add `startSyncScheduler` and boot it

**Files:**
- Modify: `src/server/services/sync-scheduler.ts` (add `startSyncScheduler`)
- Modify: `src/server/services/sync-scheduler.test.ts` (interval + reentrancy test)
- Modify: `server.ts:24-32`
- Modify: `src/server/settings/index.ts:237` (flip `syncCadenceMinutes` WIRED to true)

**Interfaces:**
- Consumes: `runDueSync` (Task 4).
- Produces: `startSyncScheduler(deps?): () => void` — starts a `setInterval` and returns a stop function, with a `let running` reentrancy guard, byte-for-byte the shape of `startPublishScheduler` (publish-scheduler.ts:203-219).

- [ ] **Step 1: Write the failing test**

Add to `src/server/services/sync-scheduler.test.ts`:

```ts
import { startSyncScheduler } from "./sync-scheduler";

describe("startSyncScheduler", () => {
  test("skips a tick that would overlap one still running", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const cadenceMinutes = async () => 30;
    // latestJob resolves slowly so a second interval fires while the first tick is awaiting.
    const latestJob = () =>
      new Promise<{ status: string; startedAt: string } | null>((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve(null);
        }, 50);
      });
    const startSweep = vi.fn(async () => {});

    const stop = startSyncScheduler({ intervalMs: 10, cadenceMinutes, latestJob, startSweep });
    await vi.advanceTimersByTimeAsync(35);
    stop();
    vi.useRealTimers();

    // Interval fired several times in 35ms, but the guard means only one tick was ever in
    // flight at once.
    expect(maxInFlight).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/sync-scheduler.test.ts -t "skips a tick that would overlap"`
Expected: FAIL — `startSyncScheduler` is not exported yet.

- [ ] **Step 3: Add `startSyncScheduler`**

Append to `src/server/services/sync-scheduler.ts`:

```ts
const DEFAULT_TICK_INTERVAL_MS = 60_000;
function resolveTickIntervalMs(): number {
  const raw = process.env.SYNC_SCHEDULER_INTERVAL_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TICK_INTERVAL_MS;
}

/**
 * Starts the interval and returns a stop function. A `let running` reentrancy guard skips
 * a tick that would overlap one still in flight (a slow sweep-start check, or a sweep the
 * previous tick launched). Identical shape to startPublishScheduler. The 60s default tick
 * only checks whether the cadence has elapsed; it does not itself set the cadence.
 */
export function startSyncScheduler(deps: Partial<SyncSchedulerDeps> & { intervalMs?: number } = {}): () => void {
  const { intervalMs, ...schedulerDeps } = deps;
  const period = intervalMs ?? resolveTickIntervalMs();

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDueSync(new Date(), schedulerDeps)
      .catch((err) => log.error("sync_scheduler.tick_rejected", { error: errorMessage(err) }))
      .finally(() => {
        running = false;
      });
  }, period);

  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/services/sync-scheduler.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Boot it from `server.ts`**

In `server.ts`, add the import beside the publish-scheduler import (line 5):

```ts
import { startSyncScheduler } from "./src/server/services/sync-scheduler";
```

And after the `startPublishScheduler()` guarded block (line 32), add:

```ts
  // Start the in-process sync scheduler beside the publish scheduler. It reads the
  // syncCadenceMinutes setting each tick and starts a library sweep when the cadence has
  // elapsed since the last sync (see sync-scheduler.ts). Same guard: a scheduler that fails
  // to start must never stop the server from listening.
  try {
    startSyncScheduler();
  } catch (err) {
    console.error("startSyncScheduler failed on boot:", err);
  }
```

- [ ] **Step 6: Flip the setting to wired**

In `src/server/settings/index.ts`, change the `syncCadenceMinutes` line in the `WIRED` map (line 237) from:

```ts
  syncCadenceMinutes: false,
```

to:

```ts
  syncCadenceMinutes: true, // sync-scheduler.ts reads it each tick and starts a library sweep on cadence
```

Also update its doc comment in the `AppSettings` interface (lines 81-84): replace "NOT CONSUMED - there is no scheduler in this app" with a line stating the scheduler now reads it and 0 disables automatic sync. Check `settings/index.test.ts` (if present) for an assertion that `WIRED.syncCadenceMinutes === false` and update it to `true`.

- [ ] **Step 7: Full gate**

Run: `npm run typecheck && npm run lint && npm run test && npm run build && bash scripts/testid-audit.sh`
Expected: all pass. If a settings test asserted the old `WIRED` value, fix it here.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/sync-scheduler.ts src/server/services/sync-scheduler.test.ts server.ts src/server/settings/index.ts src/server/settings/index.test.ts
git commit -m "feat(sync): boot the sync scheduler and wire syncCadenceMinutes"
```

---

### Task 6: Document the scheduler and the freshness skip

**Files:**
- Modify: `documents/architect/core-components/ig-sync/02-architecture.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a "Scheduled sync" subsection**

In `documents/architect/core-components/ig-sync/02-architecture.md`, under the key-decisions section (near line 221, after the concurrency decision), add a decision entry, grounded to the code just written:

```markdown
- **Automatic sync is one in-process interval, cadence-gated on the newest job row.** `sync-scheduler.ts` mirrors `publish-scheduler.ts`: one `setInterval` started from `server.ts`, a reentrancy guard, and a tick that never throws. Each tick reads `syncCadenceMinutes` (0 disables it), reads the newest `sync_jobs` row, and starts a library sweep only when no sync is running and the cadence has elapsed since that row's `startedAt`. The cadence clock is that job row, not a new table, so a manual sync also defers the next scheduled one and the marker survives a restart. The swept run passes `skipFreshWithinMinutes` equal to the cadence, so it only walks channels that are actually stale.
- **`lastSuccessfulSyncAt` is the only trusted completion time.** It is stamped at the end of a channel sync that finished without a user cancel, unlike `lastSyncedAt`, which is written near the start right after the profile call and so reads fresh for a channel cancelled mid-walk. A library sweep with `skipFreshWithinMinutes > 0` drops channels synced within that window, but never drops a channel that has never had a clean sync (its `lastSuccessfulSyncAt` is null).
```

- [ ] **Step 2: Update the data-flow step**

Confirm the data-flow list (around line 142) already reflects that sync ends at rescore (updated in PR #56). If it does not mention the completion stamp, add one clause: "and stamps `lastSuccessfulSyncAt` on a clean finish."

- [ ] **Step 3: Commit**

```bash
git add documents/architect/core-components/ig-sync/02-architecture.md
git commit -m "docs(ig-sync): document scheduled sync and lastSuccessfulSyncAt"
```

---

## Phase 3 — Step 5 (optional): per-page thumbnail download concurrency

> **Gate this phase on measurement.** Do not build it unless a real sync shows per-page thumbnail downloads are a meaningful fraction of channel wall-time. Thumbnails come from the Instagram CDN (`scontent.*`), NOT the private API, so they are not behind the sidecar's session lock and can be fetched concurrently safely, but if they are already fast this is pure risk for no gain (YAGNI).

### Task 7: Measure before optimising

**Files:** none (measurement only).

- [ ] **Step 1: Measure current per-page download time**

Run a real sync over 2-3 channels (see `.claude/skills/crowsnest-up` to bring the stack up) and read `log_events` for the run. Compare `download.completed` count and timing against total channel wall-time. If thumbnail downloads are under ~15% of a channel's time, STOP: mark this phase abandoned in the frontmatter note and ship steps 3-4 alone. If they dominate, proceed to Task 8.

### Task 8: Bounded-concurrency thumbnail fetch per page

**Files:**
- Modify: `src/server/services/sync-engine.ts` (the per-item loop at lines 1337-1390)
- Test: `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: the existing `downloadThumb` closure (line 1229) and `upsertVideo` per item.
- Produces: within one page, thumbnail downloads run at most `THUMB_DOWNLOAD_CONCURRENCY` (a small const, e.g. 4) in flight; `upsertVideo` and snapshot collection stay in deterministic item order. Counters (`itemsSeen`, `assetsDownloaded`, `assetsFailed`, `itemsCreated`, `itemsUpdated`, `itemsFailed`) are byte-for-byte identical to the serial version for the same inputs.

**Design note:** keep it lazy. Split the loop into two passes over `page.items`: pass A downloads thumbnails with a small bounded pool (a 6-line `mapWithConcurrency` helper, since none exists in the repo), pass B iterates items in order doing `upsertVideo` + children + snapshot collection using the already-downloaded thumb result. The item cap (`counters.itemsSeen >= opts.maxItems`) must still be enforced in item order in pass B so a `cap` stop mid-page behaves exactly as today. Do NOT parallelise `upsertVideo` (it writes the DB and returns created/updated counts the counters depend on, in order).

- [ ] **Step 1: Write the failing test** — assert that for a page of N items with an instrumented `downloadThumb` that records concurrent in-flight count, `maxInFlight <= 4` and `> 1`, and that final counters equal the serial baseline. Use the injected `assetDeps`/client seam the file already has.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the two-pass loop with a bounded pool.**

- [ ] **Step 4: Run to verify it passes, plus the full existing sync-engine suite** (`npx vitest run src/server/services/sync-engine.test.ts`) to prove counters and cap/cancel behaviour are unchanged.

- [ ] **Step 5: Full gate + commit.**

---

## Self-Review

**Spec coverage (steps 3-5 of the handoff):**
- Step 3 "trustworthy `lastSuccessfulSyncAt`" → Tasks 1-2. "freshness skip for Sync all" → Task 3 (mechanism), consumed by the scheduler in Task 4. Note: the manual "Sync all" button is intentionally left doing a full sweep (`skipFreshWithinMinutes` defaults to 0); a human click means "everything now". The scheduler is the freshness-skip consumer. **This is a decision, not an omission** — flag it to Kai; if he wants the manual button to skip too, wire `startSyncAction` to pass a skip value in a one-line follow-up.
- Step 4 "scheduled sync, reusing the publish scheduler's shape" → Tasks 4-6. Reuses the pattern (interval, atomic-ish gate via `sync_jobs`, bounded work, reentrancy guard, boot in `server.ts`), consumes `syncCadenceMinutes`.
- Step 5 "only then micro-optimise thumbnail/CDN downloads or DB batching" → Phase 3, measurement-gated. DB snapshot batching already shipped (Goal 3 T4, `sync-engine.ts:1397`), so the remaining lever is thumbnail concurrency.

**Placeholder scan:** every code step has real code. Test bodies are concrete. The one deliberately soft area is Phase 3, which is gated on a measurement task by design (YAGNI), with concrete code shape specified for when the measurement justifies it.

**Type consistency:** `lastSuccessfulSyncAt` (column, camelCase in Drizzle) / `last_successful_sync_at` (DB) used consistently. `skipFreshWithinMinutes` identical across `RunSyncOpts`, the scheduler dep call `startSweep(cadence)`, and `runSync({ skipFreshWithinMinutes })`. `SyncSchedulerDeps` / `SyncTickResult` / `runDueSync` / `startSyncScheduler` names consistent across Tasks 4-5.

**Constraint checks:** no AI pass reintroduced; the scheduler starts exactly one sweep and the sweep itself runs at `SYNC_CONCURRENCY` (default 1); no session pool; migration generated not hand-numbered; `lastSyncedAt` never used for freshness.

---

## Execution Handoff

Plan complete and saved to `documents/planning/implementation-plan/2026-09-05-cross-sync-schedule-freshness.md`.

Prerequisite: PR #56 (steps 1-2) should be merged first, or execute this in a worktree branched from `feat/sync-drop-ai` so `SYNC_CONCURRENCY` default 1 and the AI-pass removal are already present.

Two execution options:
1. **Subagent-driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline execution** — execute phase by phase in this session, gate after each phase.
