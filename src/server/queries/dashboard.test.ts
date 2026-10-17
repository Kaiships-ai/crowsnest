import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getDashboardStats: typeof import("./dashboard")["getDashboardStats"];
let getRecentlyViewed: typeof import("./dashboard")["getRecentlyViewed"];
let getNewOutliersSince: typeof import("./dashboard")["getNewOutliersSince"];
let getFeedLastVisit: typeof import("./dashboard")["getFeedLastVisit"];
let bumpFeedLastVisit: typeof import("./dashboard")["bumpFeedLastVisit"];
let getNewFeedOutliers: typeof import("./dashboard")["getNewFeedOutliers"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({
    getDashboardStats,
    getRecentlyViewed,
    getNewOutliersSince,
    getFeedLastVisit,
    bumpFeedLastVisit,
    getNewFeedOutliers,
  } = await import("./dashboard"));
});

// `migrate()` only applies (idempotent) schema migrations — unlike seed.ts's
// seedDatabase(), it never clears rows. Every query under test here is a whole-table
// aggregate (count(*), "is there anything in the last 7 days"), so — unlike
// remix.test.ts/analyze.test.ts's per-test-unique-id style, which never cares whether
// older rows from earlier tests still exist — these tests need a genuinely empty
// table set before each one, or counts accumulate across the whole file. FK-safe
// order: children (fleet_channels, videos) before their parents (fleets, channels).
beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
  await db.delete(tables.vaultItems);
  await db.delete(tables.scripts);
  await db.delete(tables.appSettings);
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedChannel(opts: { trackedSince?: string } = {}): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: `@dash-test-${channelId}`,
    trackedSince: opts.trackedSince ?? isoDaysAgo(60),
  });
  return channelId;
}

async function seedVideo(
  channelId: string,
  opts: { postedAt?: string; outlierScore?: number | null; viewCount?: number | null; firstSeenAt?: string } = {}
): Promise<string> {
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `dash-${videoId}`,
    url: "https://example.com/v",
    caption: "test video",
    postedAt: opts.postedAt ?? isoDaysAgo(1),
    outlierScore: opts.outlierScore ?? null,
    viewCount: opts.viewCount ?? null,
    firstSeenAt: opts.firstSeenAt ?? nowIso(),
  });
  return videoId;
}

describe("getDashboardStats", () => {
  test("channelsTracked counts all channels; channelsDelta7d counts only ones tracked in the last 7 days", async () => {
    await seedChannel({ trackedSince: isoDaysAgo(3) }); // within 7d
    await seedChannel({ trackedSince: isoDaysAgo(30) }); // outside 7d

    const stats = await getDashboardStats();

    expect(stats.channelsTracked).toBe(2);
    expect(stats.channelsDelta7d).toBe(1);
  });

  test("newOutliers7d counts only score>=2 videos posted within the last 7 days", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 5 }); // counts
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 1 }); // score too low
    await seedVideo(channelId, { postedAt: isoDaysAgo(20), outlierScore: 10 }); // too old
    await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: null }); // no score

    const stats = await getDashboardStats();

    expect(stats.newOutliers7d).toBe(1);
  });

  test("vaultedThisWeek counts vault_items created in the last 7 days", async () => {
    await db.insert(tables.vaultItems).values([
      { id: newId(), type: "hook", title: "Recent", templateText: "t", tags: [], createdAt: isoDaysAgo(1) },
      { id: newId(), type: "style", title: "Old", templateText: "t", tags: [], createdAt: isoDaysAgo(14) },
    ]);

    const stats = await getDashboardStats();

    expect(stats.vaultedThisWeek).toBe(1);
  });

  test("scriptsDrafted counts all scripts regardless of age or status", async () => {
    const now = nowIso();
    await db.insert(tables.scripts).values([
      { id: newId(), title: "A", content: "x", status: "draft", createdAt: isoDaysAgo(1), updatedAt: now },
      { id: newId(), title: "B", content: "x", status: "final", createdAt: isoDaysAgo(60), updatedAt: now },
    ]);

    const stats = await getDashboardStats();

    expect(stats.scriptsDrafted).toBe(2);
  });

  test("viewsSparkline buckets postedAt-in-window videos into 12 buckets and excludes videos outside the 90-day window", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(1), viewCount: 1000 }); // in-window
    await seedVideo(channelId, { postedAt: isoDaysAgo(100), viewCount: 999_999 }); // outside window

    const stats = await getDashboardStats();

    expect(stats.viewsSparkline).toHaveLength(12);
    expect(stats.viewsSparkline.reduce((a, b) => a + b, 0)).toBe(1000); // the far-outside video never counted
  });

  test("newOutliers7d and viewsSparkline exclude soft-deleted videos (Instagram no longer shows them)", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 5, viewCount: 1000 });
    const deletedId = await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 99, viewCount: 999_999 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const stats = await getDashboardStats();

    expect(stats.newOutliers7d).toBe(1);
    expect(stats.viewsSparkline.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe("getRecentlyViewed", () => {
  test("returns [] when no recently_viewed setting has ever been written", async () => {
    expect(await getRecentlyViewed()).toEqual([]);
  });

  test("resolves stored videoIds to FeedItems, preserving most-recent-first order and respecting limit", async () => {
    const channelId = await seedChannel();
    const first = await seedVideo(channelId, { postedAt: isoDaysAgo(1) });
    const second = await seedVideo(channelId, { postedAt: isoDaysAgo(2) });
    const third = await seedVideo(channelId, { postedAt: isoDaysAgo(3) });
    // Stored order is most-recent-first and deliberately NOT the same as insertion
    // order, so a correct implementation must respect the stored array, not re-sort.
    await db.insert(tables.appSettings).values({ key: "recently_viewed", value: JSON.stringify([third, first, second]) });

    const items = await getRecentlyViewed(2);

    expect(items.map((i) => i.videoId)).toEqual([third, first]);
  });

  test("malformed JSON in the stored value returns [] rather than throwing", async () => {
    await db.insert(tables.appSettings).values({ key: "recently_viewed", value: "not json" });

    expect(await getRecentlyViewed()).toEqual([]);
  });

  test("a soft-deleted video referenced by a stored id is silently dropped from the resolved list", async () => {
    const channelId = await seedChannel();
    const liveId = await seedVideo(channelId, { postedAt: isoDaysAgo(1) });
    const deletedId = await seedVideo(channelId, { postedAt: isoDaysAgo(2) });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));
    await db.insert(tables.appSettings).values({ key: "recently_viewed", value: JSON.stringify([deletedId, liveId]) });

    const items = await getRecentlyViewed();

    expect(items.map((i) => i.videoId)).toEqual([liveId]);
  });
});

describe("what changed since the last visit", () => {
  test("counts outliers first seen after the cutoff, skips older and unscored", async () => {
    const channelId = await seedChannel();
    const cutoff = new Date("2026-08-01T00:00:00.000Z").toISOString();
    await seedVideo(channelId, { outlierScore: 3, firstSeenAt: "2026-08-02T00:00:00.000Z" }); // counted
    await seedVideo(channelId, { outlierScore: 3, firstSeenAt: "2026-07-01T00:00:00.000Z" }); // too old
    await seedVideo(channelId, { outlierScore: 1, firstSeenAt: "2026-08-02T00:00:00.000Z" }); // below OUTLIER_MIN_SCORE

    expect(await getNewOutliersSince(cutoff)).toBe(1);
    expect(await getNewOutliersSince(null)).toBe(0);
  });

});

describe("feed cue (new outliers since last Feed visit)", () => {
  test("getFeedLastVisit reads null before any visit, then the bumped value", async () => {
    expect(await getFeedLastVisit()).toBeNull();
    await bumpFeedLastVisit("2026-08-05T00:00:00.000Z");
    expect(await getFeedLastVisit()).toBe("2026-08-05T00:00:00.000Z");
    // bump is insert-or-update: a second bump replaces, never duplicates the row.
    await bumpFeedLastVisit("2026-08-06T00:00:00.000Z");
    expect(await getFeedLastVisit()).toBe("2026-08-06T00:00:00.000Z");
  });

  test("getNewFeedOutliers counts only outliers first seen after the last Feed visit", async () => {
    const channelId = await seedChannel();
    // First ever visit: cutoff is null, so nothing is "new" yet (the whole-library-is-new
    // trap the underlying getNewOutliersSince guards against).
    await seedVideo(channelId, { outlierScore: 5, firstSeenAt: "2026-08-01T00:00:00.000Z" });
    expect(await getNewFeedOutliers()).toBe(0);

    await bumpFeedLastVisit("2026-08-05T00:00:00.000Z");
    // One outlier first seen AFTER the cutoff (counts), one BEFORE (already seen), and one
    // after but below the outlier score (not an outlier), so only the first counts.
    await seedVideo(channelId, { outlierScore: 8, firstSeenAt: "2026-08-06T00:00:00.000Z" });
    await seedVideo(channelId, { outlierScore: 8, firstSeenAt: "2026-08-02T00:00:00.000Z" });
    await seedVideo(channelId, { outlierScore: 0, firstSeenAt: "2026-08-07T00:00:00.000Z" });
    expect(await getNewFeedOutliers()).toBe(1);
  });
});
