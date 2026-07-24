import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import type { ProfileStats, SocialProvider, VideoStats } from "../providers/types";

// In-memory DB + migrate, same pattern as db/schema.test.ts.
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
});

const STUB_CAPS = {
  supportsThirdPartyMedia: true,
  supportsPlayCounts: true,
  requiresAccountLogin: false,
  requiresAppReview: false,
  maxRecentVideos: 30,
};

const noopSleep = async () => {};

function fakeProvider(
  name: string,
  opts: {
    profile?: (handle: string) => ProfileStats | Promise<ProfileStats>;
    videos?: (handle: string, limit: number) => VideoStats[] | Promise<VideoStats[]>;
  }
): SocialProvider {
  return {
    name,
    capabilities: STUB_CAPS,
    async getProfile(handle: string) {
      if (!opts.profile) throw new Error(`${name}: profile fetch failed`);
      return opts.profile(handle);
    },
    async getRecentVideos(handle: string, limit: number) {
      if (!opts.videos) throw new Error(`${name}: videos fetch failed`);
      return opts.videos(handle, limit);
    },
  };
}

function makeFakeVideos(handle: string, count: number, viewCountFn: (i: number) => number = (i) => 10_000 + i * 1000): VideoStats[] {
  return Array.from({ length: count }, (_, i) => ({
    platform: "instagram" as const,
    id: `${handle}-vid-${i}`,
    url: `https://www.instagram.com/reel/${handle}-vid-${i}/`,
    caption: `caption ${i}`,
    postedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    durationSec: 30,
    viewCount: viewCountFn(i),
    likeCount: 100,
    commentCount: 10,
  }));
}

describe("runSync", () => {
  test("happy path: syncs 2 channels, upserts videos, recomputes scores, writes snapshots, job success", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();

    const ch1Id = newId();
    const ch2Id = newId();
    await db.insert(tables.channels).values([
      { id: ch1Id, platform: "instagram", handle: "@channel1", trackedSince: nowIso() },
      { id: ch2Id, platform: "instagram", handle: "@channel2", trackedSince: nowIso() },
    ]);

    const provider = fakeProvider("apify-apidojo", {
      profile: async (handle) => ({ platform: "instagram", handle, followerCount: 50_000, fetchedAt: nowIso() }),
      videos: async (handle) => makeFakeVideos(handle, 25),
    });

    const result = await runSync({ providers: [provider], sleep: noopSleep });

    expect(result.channelsSynced).toBe(2);
    expect(result.videosUpserted).toBe(50);
    expect(result.gaps).toEqual([]);

    const channels = await db.select().from(tables.channels);
    for (const c of channels) {
      expect(c.followerCount).toBe(50_000);
      expect(c.lastSyncedAt).not.toBeNull();
      expect(c.syncError).toBeNull();
    }

    const videos = await db.select().from(tables.videos);
    expect(videos).toHaveLength(50);
    for (const v of videos) {
      expect(v.outlierScore).not.toBeNull();
    }

    const channelSnaps = await db.select().from(tables.channelSnapshots);
    expect(channelSnaps).toHaveLength(2);

    const videoSnaps = await db.select().from(tables.videoSnapshots);
    expect(videoSnaps).toHaveLength(50);

    const jobs = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
    expect(jobs[0].status).toBe("success");
    expect(jobs[0].stats).toEqual({ channels: 2, videos: 50 });
  });

  test("re-run with changed viewCounts updates the same video rows (no duplicates), scores recomputed", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();

    const chId = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@rerun", trackedSince: nowIso() });

    const provider1 = fakeProvider("apify-apidojo", {
      profile: async (handle) => ({ platform: "instagram", handle, followerCount: 1000, fetchedAt: nowIso() }),
      videos: async (handle) => makeFakeVideos(handle, 10, (i) => 1000 + i),
    });
    const first = await runSync({ channelIds: [chId], providers: [provider1], sleep: noopSleep });
    expect(first.videosUpserted).toBe(10);

    const provider2 = fakeProvider("apify-apidojo", {
      profile: async (handle) => ({ platform: "instagram", handle, followerCount: 1000, fetchedAt: nowIso() }),
      videos: async (handle) => makeFakeVideos(handle, 10, (i) => 99_000 + i), // same ids, new view counts
    });
    const second = await runSync({ channelIds: [chId], providers: [provider2], sleep: noopSleep });
    expect(second.videosUpserted).toBe(10);

    const videos = await db.select().from(tables.videos).where(eq(tables.videos.channelId, chId));
    expect(videos).toHaveLength(10); // no duplicates - same (platform, externalId) upserted in place
    for (const v of videos) {
      expect(v.viewCount).toBeGreaterThanOrEqual(99_000);
      expect(v.outlierScore).not.toBeNull(); // scores recomputed on the re-run too
    }
  });

  test("provider fallback: primary fails, secondary succeeds -> channel syncs without a gap", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();

    const chId = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@fallback1", trackedSince: nowIso() });

    const failing = fakeProvider("apify-apidojo", {}); // no handlers configured -> always throws
    const working = fakeProvider("hikerapi", {
      profile: async (handle) => ({ platform: "instagram", handle, followerCount: 2000, fetchedAt: nowIso() }),
      videos: async (handle) => makeFakeVideos(handle, 6),
    });

    const result = await runSync({ channelIds: [chId], providers: [failing, working], sleep: noopSleep });
    expect(result.gaps).toEqual([]);
    expect(result.channelsSynced).toBe(1);

    const rows = await db.select().from(tables.channels).where(eq(tables.channels.id, chId));
    expect(rows[0].syncError).toBeNull();
  });

  test("provider fallback: all providers fail for one channel -> gap recorded, other channel still syncs, job status partial", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();

    const badId = newId();
    const goodId = newId();
    await db.insert(tables.channels).values([
      { id: badId, platform: "instagram", handle: "@bad", trackedSince: nowIso() },
      { id: goodId, platform: "instagram", handle: "@good", trackedSince: nowIso() },
    ]);

    const flakyApify = fakeProvider("apify-apidojo", {
      profile: async (handle) => {
        if (handle === "@bad") throw new Error("apify: profile fetch failed");
        return { platform: "instagram", handle, followerCount: 3000, fetchedAt: nowIso() };
      },
      videos: async (handle) => makeFakeVideos(handle, 6),
    });
    const flakyHiker = fakeProvider("hikerapi", {
      profile: async (handle) => {
        if (handle === "@bad") throw new Error("hikerapi: profile fetch failed");
        return { platform: "instagram", handle, followerCount: 3000, fetchedAt: nowIso() };
      },
      videos: async (handle) => makeFakeVideos(handle, 6),
    });

    const result = await runSync({ channelIds: [badId, goodId], providers: [flakyApify, flakyHiker], sleep: noopSleep });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].channelId).toBe(badId);
    expect(result.gaps[0].provider).toBe("hikerapi"); // last provider tried before giving up
    expect(result.gaps[0].error).toMatch(/hikerapi: profile fetch failed/);
    expect(result.channelsSynced).toBe(1);

    const badRow = (await db.select().from(tables.channels).where(eq(tables.channels.id, badId)))[0];
    expect(badRow.syncError).toMatch(/hikerapi: profile fetch failed/);

    const jobs = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
    expect(jobs[0].status).toBe("partial");
  });

  test("empty provider chain -> every channel gapped with 'no provider configured', job status partial, no throw", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { runSync } = await import("./sync-engine");
    migrate();

    const ch1Id = newId();
    const ch2Id = newId();
    await db.insert(tables.channels).values([
      { id: ch1Id, platform: "instagram", handle: "@nokeys1", trackedSince: nowIso() },
      { id: ch2Id, platform: "instagram", handle: "@nokeys2", trackedSince: nowIso() },
    ]);

    const result = await runSync({ channelIds: [ch1Id, ch2Id], providers: [], sleep: noopSleep });

    expect(result.channelsSynced).toBe(0);
    expect(result.gaps).toHaveLength(2);
    for (const g of result.gaps) expect(g.error).toBe("no provider configured");

    const jobs = await db.select().from(tables.syncJobs).where(eq(tables.syncJobs.id, result.jobId));
    expect(jobs[0].status).toBe("partial");
  });

  test("throws when channelIds is provided but invalid (empty array) - the guard Task 7's action layer exercises", async () => {
    const { runSync } = await import("./sync-engine");
    await expect(runSync({ channelIds: [], sleep: noopSleep })).rejects.toThrow(/channelIds/);
  });
});

describe("addChannel", () => {
  test("inserts a new channel with profile data from the provider chain", async () => {
    const { db, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { addChannel } = await import("./sync-engine");
    migrate();

    const provider = fakeProvider("apify-apidojo", {
      profile: async (handle) => ({
        platform: "instagram",
        handle,
        followerCount: 7777,
        displayName: "Test Channel",
        fetchedAt: nowIso(),
      }),
      videos: async () => [],
    });

    const result = await addChannel({ handle: "newhandle", platform: "instagram" }, [provider]);
    const rows = await db.select().from(tables.channels).where(eq(tables.channels.id, result.channelId));
    expect(rows[0].handle).toBe("@newhandle"); // normalized to @-prefixed
    expect(rows[0].followerCount).toBe(7777);
    expect(rows[0].displayName).toBe("Test Channel");
  });

  test("duplicate handle+platform returns the existing channel id without inserting a new row", async () => {
    const { db, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { addChannel } = await import("./sync-engine");
    migrate();

    const provider = fakeProvider("apify-apidojo", {
      profile: async (handle) => ({ platform: "instagram", handle, followerCount: 1, fetchedAt: nowIso() }),
      videos: async () => [],
    });

    const first = await addChannel({ handle: "@dupe", platform: "instagram" }, [provider]);
    const second = await addChannel({ handle: "dupe", platform: "instagram" }, [provider]); // no @ this time
    expect(second.channelId).toBe(first.channelId);

    const rows = await db.select().from(tables.channels).where(eq(tables.channels.handle, "@dupe"));
    expect(rows).toHaveLength(1);
  });
});

describe("importReelByUrl", () => {
  test("creates a channel stub for an unknown handle and inserts the video", async () => {
    const { db, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { importReelByUrl } = await import("./sync-engine");
    migrate();

    const fakeFetchReel = async (url: string) => ({
      platform: "instagram" as const,
      id: "reel-abc",
      url,
      postedAt: nowIso(),
      viewCount: 500_000,
      channelHandle: "@freshimport",
    });

    const result = await importReelByUrl("https://www.instagram.com/reel/reel-abc/", fakeFetchReel);

    const channelRows = await db.select().from(tables.channels).where(eq(tables.channels.id, result.channelId));
    expect(channelRows[0].handle).toBe("@freshimport");
    expect(channelRows[0].syncError).toBeNull();

    const videoRows = await db.select().from(tables.videos).where(eq(tables.videos.id, result.videoId));
    expect(videoRows[0].externalId).toBe("reel-abc");
    expect(videoRows[0].viewCount).toBe(500_000);
  });

  test("imports into an already-known channel and recomputes a non-null score once enough videos exist", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { importReelByUrl } = await import("./sync-engine");
    migrate();

    const chId = newId();
    await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@established", trackedSince: nowIso() });
    await db.insert(tables.videos).values(
      Array.from({ length: 4 }, (_, i) => ({
        id: newId(),
        channelId: chId,
        platform: "instagram" as const,
        externalId: `established-${i}`,
        url: `https://www.instagram.com/reel/established-${i}/`,
        postedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
        viewCount: 10_000 + i * 500,
        firstSeenAt: nowIso(),
      }))
    );

    const fakeFetchReel = async (url: string) => ({
      platform: "instagram" as const,
      id: "established-new",
      url,
      postedAt: nowIso(),
      viewCount: 40_000,
      channelHandle: "@established",
    });

    const result = await importReelByUrl("https://www.instagram.com/reel/established-new/", fakeFetchReel);
    expect(result.channelId).toBe(chId);

    const videoRows = await db.select().from(tables.videos).where(eq(tables.videos.channelId, chId));
    expect(videoRows).toHaveLength(5); // 4 seeded + 1 imported
    const imported = videoRows.find((v) => v.externalId === "established-new");
    expect(imported?.outlierScore).not.toBeNull();
  });
});
