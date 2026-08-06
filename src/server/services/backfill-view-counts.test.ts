import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { IgClient } from "../ig/client";

beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
});

// Every test in this file shares one in-memory database and `migrate()` does not clear
// rows, so without this a leftover reel is another candidate and, worse, a leftover
// running sync_jobs row makes the next test's backfill refuse to start. Both bit during
// development: the pacing test counted 9 sleeps for its 3 reels, and three others died on
// a BackfillBlockedError raised by a previous test's row.
beforeEach(async () => {
  const { db, tables } = await import("../db");
  const { migrate } = await import("../db/test-migrate");
  migrate();
  await db.delete(tables.logEvents);
  await db.delete(tables.syncJobs);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

const noopSleep = async () => {};

async function setupChannel(handle = "@backfill") {
  const { db, newId, nowIso, tables } = await import("../db");
  const id = newId();
  await db.insert(tables.channels).values({
    id, platform: "instagram", handle, isVerified: false, isPrivate: false, trackedSince: nowIso(),
  });
  return { channelId: id };
}

/** A reel shaped like one the listing walk stored: no view count, because the listing
 *  endpoint withholds play counts for media the burner does not own. */
async function seedReel(
  channelId: string,
  externalId: string,
  over: { viewCount?: number | null; daysAgo?: number; productType?: string | null; deletedAt?: string | null } = {}
) {
  const { db, newId, nowIso, tables } = await import("../db");
  await db.insert(tables.videos).values({
    id: newId(), channelId, platform: "instagram", externalId,
    url: `https://www.instagram.com/reel/${externalId}/`,
    mediaType: "video",
    productType: over.productType === undefined ? "clips" : over.productType,
    postedAt: new Date(Date.now() - (over.daysAgo ?? 1) * 86_400_000).toISOString(),
    viewCount: over.viewCount ?? null,
    deletedAt: over.deletedAt ?? null,
    firstSeenAt: nowIso(),
  });
}

function stubClient(over: Partial<{ stats: Record<string, number | null>; onStats: (pk: string) => void }> = {}): IgClient {
  return {
    async fetchMediaStats(pk: string) {
      over.onStats?.(pk);
      const viewCount = over.stats && pk in over.stats ? over.stats[pk] : 5_000;
      return { externalId: pk, mediaType: "video" as const, productType: "clips", viewCount, likeCount: 1, commentCount: 1 };
    },
  } as unknown as IgClient;
}

async function viewCountOf(externalId: string): Promise<number | null> {
  const { db, tables } = await import("../db");
  const [row] = await db.select().from(tables.videos).where(eq(tables.videos.externalId, externalId));
  return row.viewCount;
}

describe("runViewCountBackfill — filling blank rows", () => {
  test("fills every blank reel and reports what it did", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@fill");
    await seedReel(channelId, "fill-1");
    await seedReel(channelId, "fill-2");

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client: stubClient(), sleep: noopSleep });

    expect(result.candidates).toBe(2);
    expect(result.enriched).toBe(2);
    expect(result.stopReason).toBe("exhausted");
    expect(await viewCountOf("fill-1")).toBe(5_000);
    expect(await viewCountOf("fill-2")).toBe(5_000);
  });

  test("leaves a row that already has a count alone", async () => {
    // The difference between this and the sync's own pass. The sync re-reads the newest
    // reels because a play count grows; the backfill exists for the 334 rows that have no
    // number at all, and spending a live request to overwrite a good one is exactly the
    // budget this job is trying to be careful with.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@already");
    await seedReel(channelId, "already-1", { viewCount: 2_272_877 });
    await seedReel(channelId, "already-2");

    const asked: string[] = [];
    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client: stubClient({ onStats: (pk) => asked.push(pk) }), sleep: noopSleep });

    expect(asked).toEqual(["already-2"]);
    expect(result.candidates).toBe(1);
    expect(await viewCountOf("already-1")).toBe(2_272_877);
  });

  test("skips removed posts and non-reels, which have no play count to recover", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@shape");
    await seedReel(channelId, "shape-gone", { deletedAt: new Date().toISOString() });
    await seedReel(channelId, "shape-photo", { productType: null });
    await seedReel(channelId, "shape-reel");

    const asked: string[] = [];
    const { runViewCountBackfill } = await import("./backfill-view-counts");
    await runViewCountBackfill({ client: stubClient({ onStats: (pk) => asked.push(pk) }), sleep: noopSleep });

    expect(asked).toEqual(["shape-reel"]);
  });

  test("a withheld count is recorded as withheld, never written as a zero", async () => {
    // The bug this whole feature exists because of: a null mapped to 0 turned a genuine
    // 2.27M-view reel into 0 on the first live run.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@withheld");
    await seedReel(channelId, "withheld-1");

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client: stubClient({ stats: { "withheld-1": null } }), sleep: noopSleep });

    expect(result.withheld).toBe(1);
    expect(result.enriched).toBe(0);
    expect(await viewCountOf("withheld-1")).toBeNull();
  });

  test("honours its limit so one run cannot spend the whole request budget", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@limit");
    for (let i = 1; i <= 10; i += 1) await seedReel(channelId, `limit-${i}`, { daysAgo: i });

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client: stubClient(), sleep: noopSleep, limit: 4 });

    expect(result.candidates).toBe(4);
    expect(result.enriched).toBe(4);
  });

  test("paces its requests instead of firing them back to back", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@paced");
    await seedReel(channelId, "paced-1");
    await seedReel(channelId, "paced-2");
    await seedReel(channelId, "paced-3");

    const sleeps: number[] = [];
    const { runViewCountBackfill } = await import("./backfill-view-counts");
    await runViewCountBackfill({ client: stubClient(), sleep: async (ms) => { sleeps.push(ms); } });

    // One gap between each pair, and never before the first request.
    expect(sleeps).toHaveLength(2);
    expect(Math.min(...sleeps)).toBeGreaterThan(0);
  });
});

describe("runViewCountBackfill — scores", () => {
  test("recomputes the channel's scores, so a filled count and its score agree", async () => {
    // A view count is the input to a channel's baseline. Writing counts without
    // recomputing would leave the feed showing a fresh number beside a score computed
    // without it. score-recompute-guard.test.ts allow-lists this file on the strength of
    // this behaviour, so it is asserted here rather than assumed there.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, tables } = await import("../db");
    const { channelId } = await setupChannel("@scores");
    // Five clears scoreMinUsablePosts, below which no score is computed at all.
    for (let i = 1; i <= 5; i += 1) await seedReel(channelId, `scores-${i}`, { daysAgo: i });

    // No counts, so nothing to score against: every outlier score starts null.
    const before = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(before.every((v) => v.outlierScore === null)).toBe(true);

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    await runViewCountBackfill({ client: stubClient(), sleep: noopSleep });

    // Five identical counts make the baseline 5,000 and every post exactly average.
    const after = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(after.every((v) => v.outlierScore === 1)).toBe(true);
  });

  test("still recomputes for the counts it did write when the run is cancelled", async () => {
    // A cancel stops more work; it does not make the work already done wrong.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, tables } = await import("../db");
    const { channelId } = await setupChannel("@cancel-scores");
    for (let i = 1; i <= 8; i += 1) await seedReel(channelId, `cancel-scores-${i}`, { daysAgo: i });

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const { requestCancel } = await import("./sync-engine");
    let jobId = "";
    let asked = 0;
    const client = stubClient({
      onStats: () => {
        asked += 1;
        if (asked === 6) void requestCancel(jobId);
      },
    });

    const result = await runViewCountBackfill({ client, sleep: noopSleep, onJobStarted: (id) => { jobId = id; } });
    expect(result.stopReason).toBe("cancelled");
    expect(result.enriched).toBeGreaterThanOrEqual(5);

    const after = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channelId));
    expect(after.filter((v) => v.outlierScore !== null).length).toBeGreaterThanOrEqual(5);
  });
});

describe("runViewCountBackfill — cancel", () => {
  test("stops when the user cancels, and says so", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { channelId } = await setupChannel("@cancel");
    for (let i = 1; i <= 6; i += 1) await seedReel(channelId, `cancel-${i}`, { daysAgo: i });

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const { requestCancel } = await import("./sync-engine");

    let jobId = "";
    let asked = 0;
    const client = stubClient({
      onStats: () => {
        asked += 1;
        if (asked === 1) void requestCancel(jobId);
      },
    });

    const result = await runViewCountBackfill({ client, sleep: noopSleep, onJobStarted: (id) => { jobId = id; } });

    expect(result.stopReason).toBe("cancelled");
    expect(asked).toBeLessThanOrEqual(2);
  });
});

describe("runViewCountBackfill — the sync lock", () => {
  test("does not steal the sync lock: a sync still starts while a backfill row is running", async () => {
    // The acceptance criterion. A backfill row lives in sync_jobs so it shows up on the
    // Runs screen, but it must never be the reason a real sync is refused — a refused
    // sync is a channel that goes unfetched.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, newId, nowIso, tables } = await import("../db");
    const { channelId } = await setupChannel("@notstolen");

    const { BACKFILL_LOCK_KEY } = await import("./sync-types");
    await db.insert(tables.syncJobs).values({
      id: newId(), channelId: null, lockKey: BACKFILL_LOCK_KEY,
      startedAt: nowIso(), heartbeatAt: nowIso(), status: "running",
    });

    const { runSync } = await import("./sync-engine");
    const client = {
      async profile(handle: string) {
        return {
          handle, externalId: `ext-${handle}`, displayName: handle, followerCount: 1, followingCount: 1,
          mediaCount: 0, bio: "", isVerified: false, isPrivate: false, avatarUrl: null, raw: {},
        };
      },
      async medias() {
        return { items: [], nextCursor: null, stopReason: "exhausted" as const };
      },
    } as unknown as IgClient;

    // Would throw SyncAlreadyRunningError if the backfill row took part in the sync lock.
    const result = await runSync({ channelIds: [channelId], client, sleep: noopSleep });
    expect(result.jobId).toBeTruthy();
  });

  test("yields to a sync: refuses to start while one is running", async () => {
    // The other direction, and deliberately asymmetric. The sync is the job a user is
    // waiting on; the backfill is a catch-up that can always run later, and both hitting
    // Instagram at once doubles the load on one burner account.
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, newId, nowIso, tables } = await import("../db");
    const { channelId } = await setupChannel("@yield");
    await seedReel(channelId, "yield-1");

    await db.insert(tables.syncJobs).values({
      id: newId(), channelId: null, lockKey: "__library__",
      startedAt: nowIso(), heartbeatAt: nowIso(), status: "running",
    });

    const { runViewCountBackfill, BackfillBlockedError } = await import("./backfill-view-counts");
    let asked = 0;
    await expect(
      runViewCountBackfill({ client: stubClient({ onStats: () => { asked += 1; } }), sleep: noopSleep })
    ).rejects.toBeInstanceOf(BackfillBlockedError);
    expect(asked).toBe(0);
  });

  test("stops mid-run if a sync starts underneath it", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, newId, nowIso, tables } = await import("../db");
    const { channelId } = await setupChannel("@interrupted");
    for (let i = 1; i <= 6; i += 1) await seedReel(channelId, `interrupted-${i}`, { daysAgo: i });

    let asked = 0;
    const client = stubClient({
      onStats: async () => {
        asked += 1;
        if (asked === 1) {
          await db.insert(tables.syncJobs).values({
            id: newId(), channelId: null, lockKey: "__library__",
            startedAt: nowIso(), heartbeatAt: nowIso(), status: "running",
          });
        }
      },
    });

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client, sleep: noopSleep });

    expect(result.stopReason).toBe("sync_started");
    expect(asked).toBeLessThanOrEqual(2);
  });

  test("refuses to run two backfills at once", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, newId, nowIso, tables } = await import("../db");
    const { BACKFILL_LOCK_KEY } = await import("./sync-types");
    await db.insert(tables.syncJobs).values({
      id: newId(), channelId: null, lockKey: BACKFILL_LOCK_KEY,
      startedAt: nowIso(), heartbeatAt: nowIso(), status: "running",
    });

    const { runViewCountBackfill, BackfillBlockedError } = await import("./backfill-view-counts");
    await expect(runViewCountBackfill({ client: stubClient(), sleep: noopSleep })).rejects.toBeInstanceOf(BackfillBlockedError);
  });
});

describe("runViewCountBackfill — the job row", () => {
  test("records a finished run the Runs screen can show", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, tables } = await import("../db");
    const { channelId } = await setupChannel("@jobrow");
    await seedReel(channelId, "jobrow-1");

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client: stubClient(), sleep: noopSleep });

    const [row] = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
    expect(row.status).toBe("success");
    expect(row.finishedAt).not.toBeNull();
    expect(row.itemsUpdated).toBe(1);
    expect(row.stopReason).toBe("exhausted");

    // And nothing is left holding the lock.
    const running = await db
      .select()
      .from(tables.syncJobs)
      .where(and(eq(tables.syncJobs.status, "running"), isNull(tables.syncJobs.finishedAt)));
    expect(running).toEqual([]);
  });

  test("an upstream failure ends the run without leaving the lock held", async () => {
    const { migrate } = await import("../db/test-migrate");
    migrate();
    const { db, tables } = await import("../db");
    const { channelId } = await setupChannel("@boom");
    await seedReel(channelId, "boom-1");

    const client = {
      async fetchMediaStats() {
        throw new Error("sidecar exploded");
      },
    } as unknown as IgClient;

    const { runViewCountBackfill } = await import("./backfill-view-counts");
    const result = await runViewCountBackfill({ client, sleep: noopSleep });

    expect(result.stopReason).toBe("error");
    const [row] = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
    expect(row.status).not.toBe("running");
    expect(row.finishedAt).not.toBeNull();
  });
});
