import { beforeAll, describe, expect, test } from "vitest";

// In-memory DB + migrate, same pattern as db/schema.test.ts.
beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  // No spec here should reach the sidecar — they all stop at the lock or at an argument
  // guard. Pointing at a dead port keeps it that way: if one ever did reach out, it
  // fails fast instead of quietly driving a real sidecar that happens to be running.
  process.env.IG_SERVICE_URL = "http://127.0.0.1:1";

  // Warm the import chain (next/server, the sync engine, drizzle, better-sqlite3) here,
  // after the env above is set and before any test runs. Left to the first test it costs
  // that test ~1.2s of pure module loading, and under a parallel full-suite run it pushed
  // it past vitest's 5s per-test ceiling — a timeout that had nothing to do with what the
  // test asserts. Hooks get 10s, and every later `await import` is a cache hit.
  await import("./sync-actions");
});

/*
 * The two specs that used to open this file covered `syncChannelAction`, which is gone
 * along with the blocking bridge exports that called it. Neither property went with it:
 * "a bad channel id arrives as a value across the action boundary, not an exception" is
 * now asserted against `startSyncAction` below, and "an unreachable sidecar becomes a
 * gap carrying IG_SERVICE_DOWN, and the channel row records it" is covered at the layer
 * that owns it, in sync-engine.test.ts.
 */

/** Fully-populated job row, so the mapping spec can assert on every field at once. */
async function seedJob(overrides: Record<string, unknown> = {}) {
  const { db, newId, nowIso, tables } = await import("../db");
  const id = (overrides.id as string) ?? newId();
  await db.insert(tables.syncJobs).values({
    id,
    channelId: null,
    lockKey: id,
    startedAt: nowIso(),
    status: "success",
    ...overrides,
  } as typeof tables.syncJobs.$inferInsert);
  return id;
}

async function clearJobs() {
  const { db, tables } = await import("../db");
  await db.delete(tables.syncJobs);
}

describe("startSyncAction", () => {
  test("a second start while a run holds the lock loses with SYNC_ALREADY_RUNNING", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { startSyncAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    // The lock held by somebody else — another tab. A fresh heartbeat
    // matters: a stale one would be reaped and the start would legitimately succeed.
    const holder = newId();
    await db.insert(tables.syncJobs).values({
      id: holder,
      channelId: null,
      lockKey: "__library__",
      startedAt: nowIso(),
      heartbeatAt: nowIso(),
      status: "running",
    });

    const result = await startSyncAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SYNC_ALREADY_RUNNING");

    // The loser must not have invented a job row, and must not have adopted the winner's
    // — the engine only fires `onJobStarted` on the side that actually took the lock.
    const rows = await db.select().from(tables.syncJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(holder);
  });

  test("a run that dies before the lock row exists reports the failure, not a job id", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { startSyncAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    // runSync's argument guard throws before acquireLock, so there is no row to hand
    // back. Returning `ok` here would point the UI at a run that never started — and
    // the rejection of the un-awaited promise has to be caught, or vitest fails the
    // suite on an unhandled rejection.
    const result = await startSyncAction([""]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/channelIds/);

    const { db, tables } = await import("../db");
    expect(await db.select().from(tables.syncJobs)).toHaveLength(0);
  });
});

describe("getSyncProgressAction", () => {
  test("maps every field of a sync_jobs row onto the SyncProgress contract", async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const { migrate } = await import("../db/test-migrate");
    const { config } = await import("../config");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const jobId = await seedJob({
      startedAt: "2026-07-28T10:00:00.000Z",
      finishedAt: "2026-07-28T10:04:00.000Z",
      heartbeatAt: "2026-07-28T10:03:59.000Z",
      status: "partial",
      phase: "scoring",
      currentChannelHandle: "@kallaway",
      channelsTotal: 4,
      channelsDone: 3,
      lookbackDays: 30,
      itemsSeen: 120,
      itemsCreated: 12,
      itemsUpdated: 108,
      itemsFailed: 2,
      itemsDeleted: 1,
      assetsDownloaded: 118,
      assetsFailed: 4,
      retries: 5,
      stopReason: "lookback",
      errorCode: "IG_RATE_LIMITED",
      errorMessage: "backed off",
      cancelRequested: true,
    });

    // Written as raw JSON because the gap shape the engine now writes (handle + code)
    // is wider than the column's declared type.
    await db.run(
      sql`update sync_jobs set gaps = ${JSON.stringify([
        { channelId: "ch-1", handle: "@dead", provider: "instagrapi", error: "boom", code: "IG_PRIVATE" },
      ])} where id = ${jobId}`
    );

    const result = await getSyncProgressAction(jobId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.progress).toEqual({
      jobId,
      status: "partial",
      phase: "scoring",
      currentChannelHandle: "@kallaway",
      channelsTotal: 4,
      channelsDone: 3,
      startedAt: "2026-07-28T10:00:00.000Z",
      finishedAt: "2026-07-28T10:04:00.000Z",
      heartbeatAt: "2026-07-28T10:03:59.000Z",
      itemsSeen: 120,
      itemsCreated: 12,
      itemsUpdated: 108,
      itemsFailed: 2,
      itemsDeleted: 1,
      assetsDownloaded: 118,
      assetsFailed: 4,
      retries: 5,
      stopReason: "lookback",
      errorCode: "IG_RATE_LIMITED",
      errorMessage: "backed off",
      gaps: [{ channelId: "ch-1", handle: "@dead", provider: "instagrapi", error: "boom", code: "IG_PRIVATE" }],
      cancelRequested: true,
      lookbackDays: 30,
      maxItems: config.MAX_ITEMS_PER_SYNC,
    });
  });

  test("with no jobId, a running run wins over a job that started later and finished", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const running = await seedJob({
      startedAt: "2026-07-28T09:00:00.000Z",
      heartbeatAt: "2026-07-28T09:00:30.000Z",
      status: "running",
    });
    await seedJob({ startedAt: "2026-07-28T09:30:00.000Z", finishedAt: "2026-07-28T09:31:00.000Z", status: "success" });

    // This fallback is the whole reason a reloaded tab can attach to a sync it never
    // started — another tab's.
    const result = await getSyncProgressAction();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.progress?.jobId).toBe(running);
  });

  test("with no jobId and nothing running, the most recent finished run is returned", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    await seedJob({ startedAt: "2026-07-28T07:00:00.000Z", finishedAt: "2026-07-28T07:05:00.000Z", status: "success" });
    const latest = await seedJob({
      startedAt: "2026-07-28T08:00:00.000Z",
      finishedAt: "2026-07-28T08:05:00.000Z",
      status: "failed",
    });

    const result = await getSyncProgressAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress?.jobId).toBe(latest);
      expect(result.progress?.status).toBe("failed");
    }
  });

  test("an empty sync_jobs table is no progress, not an error", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const result = await getSyncProgressAction();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.progress).toBeNull();
  });

  test("a gap row from before `handle` existed falls back to the channel id, not a blank", async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const { migrate } = await import("../db/test-migrate");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const jobId = await seedJob({ status: "partial" });
    // The shape most gap-bearing rows in an existing database actually have: written
    // before `handle` and `code` were added, and still carrying copy about the provider
    // registry that has since been deleted.
    await db.run(
      sql`update sync_jobs set gaps = ${JSON.stringify([
        { channelId: "ch-legacy", provider: "apify", error: "no provider configured" },
      ])} where id = ${jobId}`
    );

    const result = await getSyncProgressAction(jobId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "" would render a blank channel name over an unnamed Retry button; the id is at
    // least something the user can paste into search.
    expect(result.progress?.gaps).toEqual([
      { channelId: "ch-legacy", handle: "ch-legacy", provider: "apify", error: "no provider configured", code: null },
    ]);
  });

  test("a malformed gaps blob degrades to no gaps instead of blanking the panel", async () => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const { migrate } = await import("../db/test-migrate");
    const { getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const jobId = await seedJob({ status: "partial", itemsSeen: 42, phase: "not-a-phase" });
    // A run killed mid-write leaves exactly this. Read through drizzle's JSON mapper it
    // throws inside the SELECT, which would cost the UI every other field on the row.
    await db.run(sql`update sync_jobs set gaps = ${'[{"channelId":"ch-1"'} where id = ${jobId}`);

    const result = await getSyncProgressAction(jobId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.progress?.gaps).toEqual([]);
    // The rest of the row still arrives — that is the point of degrading rather than throwing.
    expect(result.progress?.itemsSeen).toBe(42);
    // An unrecognised phase is reported as "unknown", never passed through as a lie.
    expect(result.progress?.phase).toBeNull();
  });
});

/**
 * sync_jobs.channel_id is a real FK, so a channel-scoped job needs a channel to point at.
 * Handles must be unique per test — `channels` is unique on (platform, handle) and the
 * tests share one in-memory database.
 */
async function seedChannel(handle: string) {
  const { db, newId, nowIso, tables } = await import("../db");
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle, trackedSince: nowIso() });
  return id;
}

describe("getChannelSyncProgressAction", () => {
  test("surfaces this channel's own run", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const channelId = await seedChannel("@mine");
    const jobId = await seedJob({ channelId, lockKey: channelId, status: "running" });

    const result = await getChannelSyncProgressAction(channelId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress?.jobId).toBe(jobId);
      expect(result.coverage).toBe("channel");
    }
  });

  test("a library run covers every channel, so it surfaces here as `library`", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const channelId = await seedChannel("@covered");
    const jobId = await seedJob({ channelId: null, lockKey: "__library__", status: "running" });

    // The distinction is the point: the button should still disable, but for a reason
    // the UI can state ("a library sync is running") rather than an unexplained one.
    const result = await getChannelSyncProgressAction(channelId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress?.jobId).toBe(jobId);
      expect(result.coverage).toBe("library");
    }
  });

  test("a run scoped to a different channel is invisible here", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction, getSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const mine = await seedChannel("@scoped_mine");
    const theirs = await seedChannel("@scoped_theirs");
    await seedJob({ channelId: theirs, lockKey: theirs, status: "running" });

    // This is the regression the whole lookup exists for: the global poll does see that
    // run, and a channel page keyed on it disabled a button over somebody else's sync.
    const global = await getSyncProgressAction();
    expect(global.ok && global.progress).not.toBeNull();

    const result = await getChannelSyncProgressAction(mine);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress).toBeNull();
      expect(result.coverage).toBeNull();
    }
  });

  test("with nothing running, falls back to the last run that covered this channel", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const mine = await seedChannel("@fallback_mine");
    const theirs = await seedChannel("@fallback_theirs");

    await seedJob({ channelId: mine, lockKey: mine, status: "success", startedAt: "2026-07-28T06:00:00.000Z" });
    const latestCovering = await seedJob({
      channelId: null,
      lockKey: "__library__",
      status: "partial",
      startedAt: "2026-07-28T07:00:00.000Z",
    });
    // Newer than either, but it never touched this channel, so it must not win.
    await seedJob({ channelId: theirs, lockKey: theirs, status: "success", startedAt: "2026-07-28T08:00:00.000Z" });

    const result = await getChannelSyncProgressAction(mine);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress?.jobId).toBe(latestCovering);
      expect(result.coverage).toBe("library");
    }
  });

  test("two live runs covering one channel degrade to the more specific one", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const channelId = await seedChannel("@doubled");
    // Only possible while '__library__' and '<channelId>' are separate lock keys. Once
    // the engine closes that hole this state is unreachable — until then the page must
    // still pick one, and this channel's own run is the one that describes it.
    await seedJob({ channelId: null, lockKey: "__library__", status: "running", startedAt: "2026-07-28T09:00:00.000Z" });
    const own = await seedJob({
      channelId,
      lockKey: channelId,
      status: "running",
      startedAt: "2026-07-28T08:00:00.000Z",
    });

    const result = await getChannelSyncProgressAction(channelId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress?.jobId).toBe(own);
      expect(result.coverage).toBe("channel");
    }
  });

  test("a channel that has never been synced reports nothing rather than erroring", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { getChannelSyncProgressAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const result = await getChannelSyncProgressAction(await seedChannel("@fresh"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.progress).toBeNull();
      expect(result.coverage).toBeNull();
    }
  });
});

describe("cancelSyncAction", () => {
  test("sets the co-operative cancel flag on the job row", async () => {
    const { db, tables } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const { migrate } = await import("../db/test-migrate");
    const { cancelSyncAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const { nowIso } = await import("../db");
    const jobId = await seedJob({ status: "running", startedAt: nowIso(), heartbeatAt: nowIso() });

    const result = await cancelSyncAction(jobId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requested).toBe(true);

    const [row] = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, jobId));
    expect(row.cancelRequested).toBe(true);
    // Cancel asks; it does not kill. The engine still owns the terminal write.
    expect(row.status).toBe("running");
  });

  test("cancelling a job that already finished succeeds but reports nothing was cancelled", async () => {
    const { migrate } = await import("../db/test-migrate");
    const { cancelSyncAction } = await import("./sync-actions");
    migrate();
    await clearJobs();

    const jobId = await seedJob({ status: "success", finishedAt: "2026-07-28T08:05:00.000Z" });

    // Clicking cancel as a run completes must not error — but it must not claim to have
    // cancelled anything either.
    const result = await cancelSyncAction(jobId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.requested).toBe(false);
  });
});
