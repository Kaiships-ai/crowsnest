import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getDashboardStats: typeof import("./dashboard")["getDashboardStats"];
let getTopOutliersToday: typeof import("./dashboard")["getTopOutliersToday"];
let getTopOutlierAllTime: typeof import("./dashboard")["getTopOutlierAllTime"];
let getFleetSpikes: typeof import("./dashboard")["getFleetSpikes"];
let getRecentlyViewed: typeof import("./dashboard")["getRecentlyViewed"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getDashboardStats, getTopOutliersToday, getTopOutlierAllTime, getFleetSpikes, getRecentlyViewed } =
    await import("./dashboard"));
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
  opts: { postedAt?: string; outlierScore?: number | null; viewCount?: number | null } = {}
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
    firstSeenAt: nowIso(),
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

describe("getTopOutliersToday", () => {
  test("returns the highest-scored videos posted in the last 7 days, respecting limit", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 3 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 9 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(20), outlierScore: 50 }); // too old, excluded

    const items = await getTopOutliersToday(1);

    expect(items).toHaveLength(1);
    expect(items[0].outlierScore).toBe(9);
  });

  test("falls back to all-time top scores when nothing was posted in the last 7 days", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(30), outlierScore: 15 });

    const items = await getTopOutliersToday(6);

    expect(items).toHaveLength(1);
    expect(items[0].outlierScore).toBe(15);
  });

  test("excludes soft-deleted videos from both the recent list and the all-time fallback", async () => {
    const channelId = await seedChannel();
    const liveId = await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 5 });
    const deletedRecentId = await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 99 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedRecentId));

    const recentItems = await getTopOutliersToday(6);
    expect(recentItems.map((i) => i.videoId)).toEqual([liveId]);

    // Now exercise the all-time fallback path too: delete the only remaining video and
    // confirm the fallback query itself also filters deletedAt (not just the recent one).
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, liveId));
    const fallbackItems = await getTopOutliersToday(6);
    expect(fallbackItems).toEqual([]);
  });
});

describe("getTopOutlierAllTime", () => {
  test("returns the highest-scored video regardless of age, unlike getTopOutliersToday's 7-day window", async () => {
    const channelId = await seedChannel();
    // A recent post with no score yet (what getTopOutliersToday(1) would surface via its
    // fallback-to-recent behavior) alongside the real top outlier from outside the 7-day
    // window (mirrors the live bug: a 23-day-old top scorer beat by nothing in-window).
    await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: null });
    const topId = await seedVideo(channelId, { postedAt: isoDaysAgo(23), outlierScore: 10.1 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(5), outlierScore: 3 });

    const items = await getTopOutlierAllTime(1);

    expect(items).toHaveLength(1);
    expect(items[0].videoId).toBe(topId);
    expect(items[0].outlierScore).toBe(10.1);
  });

  test("returns [] when no video has a non-null score, rather than falling back to a null-scored one", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: null });
    await seedVideo(channelId, { postedAt: isoDaysAgo(30), outlierScore: null });

    const items = await getTopOutlierAllTime(1);

    expect(items).toEqual([]);
  });

  test("excludes soft-deleted videos even when they have the highest score", async () => {
    const channelId = await seedChannel();
    const liveId = await seedVideo(channelId, { postedAt: isoDaysAgo(10), outlierScore: 5 });
    const deletedId = await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 99 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const items = await getTopOutlierAllTime(1);

    expect(items.map((i) => i.videoId)).toEqual([liveId]);
  });
});

describe("getFleetSpikes", () => {
  test("only includes fleets with at least one new (score>=2) outlier in the last 7 days, sorted desc", async () => {
    const quietChannel = await seedChannel();
    const busyChannel = await seedChannel();
    const emptyMembershipFleetId = newId();
    const quietFleetId = newId();
    const busyFleetId = newId();

    await db.insert(tables.fleets).values([
      { id: emptyMembershipFleetId, name: "Empty Fleet", createdAt: nowIso() },
      { id: quietFleetId, name: "Quiet Fleet", createdAt: nowIso() },
      { id: busyFleetId, name: "Busy Fleet", createdAt: nowIso() },
    ]);
    // emptyMembershipFleetId deliberately has zero fleet_channels rows (never inArray'd with []).
    await db.insert(tables.fleetChannels).values([
      { fleetId: quietFleetId, channelId: quietChannel },
      { fleetId: busyFleetId, channelId: busyChannel },
    ]);

    await seedVideo(quietChannel, { postedAt: isoDaysAgo(1), outlierScore: 1 }); // below threshold
    await seedVideo(busyChannel, { postedAt: isoDaysAgo(1), outlierScore: 5 });
    await seedVideo(busyChannel, { postedAt: isoDaysAgo(2), outlierScore: 8 });

    const spikes = await getFleetSpikes();

    expect(spikes.map((s) => s.fleetName)).toEqual(["Busy Fleet"]); // Quiet Fleet + Empty Fleet excluded
    expect(spikes[0].newOutliers7d).toBe(2);
  });

  test("excludes soft-deleted videos from a fleet's newOutliers7d count and sparkline", async () => {
    const channelId = await seedChannel();
    const fleetId = newId();
    await db.insert(tables.fleets).values({ id: fleetId, name: "Fleet With Deletions", createdAt: nowIso() });
    await db.insert(tables.fleetChannels).values({ fleetId, channelId });

    await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 5, viewCount: 1000 });
    const deletedId = await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 99, viewCount: 999_999 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const spikes = await getFleetSpikes();

    const spike = spikes.find((s) => s.fleetId === fleetId);
    expect(spike?.newOutliers7d).toBe(1);
    expect(spike?.sparkline.reduce((a, b) => a + b, 0)).toBe(1000);
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
