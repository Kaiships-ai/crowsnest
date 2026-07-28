import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Same test-DB pattern as feed.test.ts. `src/server/db/seed.ts` (the old demo-data
// generator) was deleted as part of the Instagram-sync rebuild, so every test below
// inserts exactly the rows it needs instead of relying on a shared seeded fixture.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let computeChannelMedian: typeof import("@/server/services/outlier-calc")["computeChannelMedian"];
let getChannelsList: typeof import("./channels")["getChannelsList"];
let getFleets: typeof import("./channels")["getFleets"];
let getChannelDetail: typeof import("./channels")["getChannelDetail"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ computeChannelMedian } = await import("@/server/services/outlier-calc"));
  ({ getChannelsList, getFleets, getChannelDetail } = await import("./channels"));
});

// Migrate once (idempotent) and wipe every mutable table before each test. FK-safe
// order: children (fleet_channels, videos) before their parents (fleets, channels).
beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedChannel(opts: { followerCount?: number | null } = {}): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: `@channels-test-${channelId}`,
    followerCount: opts.followerCount ?? null,
    trackedSince: nowIso(),
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
    externalId: `channels-${videoId}`,
    url: "https://example.com/v",
    postedAt: opts.postedAt ?? nowIso(),
    outlierScore: opts.outlierScore ?? null,
    viewCount: opts.viewCount ?? null,
    firstSeenAt: nowIso(),
  });
  return videoId;
}

describe("getChannelsList", () => {
  test("returns all seeded channels", async () => {
    await seedChannel();
    await seedChannel();
    await seedChannel();

    const rows = await getChannelsList();

    expect(rows).toHaveLength(3);
  });

  test("medianViews matches the computeChannelMedian fallback (zero channel_snapshots rows written)", async () => {
    // computeChannelMedian requires >= 5 usable (non-null viewCount) videos before it
    // will produce a number at all (MIN_USABLE) — fewer than that and it's null on both
    // sides, which wouldn't actually exercise the median math.
    const channelId = await seedChannel();
    for (const viewCount of [100, 200, 300, 400, 500]) {
      await seedVideo(channelId, { viewCount });
    }

    const snapshotRows = await db.select().from(tables.channelSnapshots);
    expect(snapshotRows).toHaveLength(0); // sanity: nothing to fall back FROM but the videos table

    const videos = await db
      .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
      .from(tables.videos)
      .where(eq(tables.videos.channelId, channelId));
    const expectedMedian = computeChannelMedian(videos);
    expect(expectedMedian).toBe(300); // sanity: the fallback actually computed something

    const rows = await getChannelsList();
    expect(rows.find((r) => r.id === channelId)?.medianViews).toBe(expectedMedian);
  });

  test("outliers30d counts only score>=2 videos posted within the last 30 days", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 5 }); // counts
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 1 }); // score too low
    await seedVideo(channelId, { postedAt: isoDaysAgo(60), outlierScore: 10 }); // too old

    const rows = await getChannelsList();

    expect(rows.find((r) => r.id === channelId)?.outliers30d).toBe(1);
  });

  test("medianViews and outliers30d exclude soft-deleted videos", async () => {
    const channelId = await seedChannel();
    // 5 live videos (enough to clear computeChannelMedian's MIN_USABLE floor), 3 of
    // which are scored outliers within the last 30 days.
    await seedVideo(channelId, { postedAt: isoDaysAgo(2), outlierScore: 5, viewCount: 100 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(3), outlierScore: 1, viewCount: 200 }); // score too low
    await seedVideo(channelId, { postedAt: isoDaysAgo(4), outlierScore: 5, viewCount: 300 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(5), outlierScore: null, viewCount: 400 });
    await seedVideo(channelId, { postedAt: isoDaysAgo(6), outlierScore: 5, viewCount: 500 });
    // A soft-deleted video with an inflated score+viewCount that would corrupt both
    // stats if it were ever counted as live.
    const deletedId = await seedVideo(channelId, { postedAt: isoDaysAgo(1), outlierScore: 99, viewCount: 999_999 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const rows = await getChannelsList();
    const row = rows.find((r) => r.id === channelId)!;

    expect(row.outliers30d).toBe(3);
    expect(row.medianViews).toBe(300); // median of the 5 live viewCounts; 999_999 never counts
  });

  test("reports each channel's fleet memberships", async () => {
    const inFleetChannel = await seedChannel();
    const outsideChannel = await seedChannel();
    const fleetId = newId();
    await db.insert(tables.fleets).values({ id: fleetId, name: "Test Fleet", createdAt: nowIso() });
    await db.insert(tables.fleetChannels).values({ fleetId, channelId: inFleetChannel });

    const rows = await getChannelsList();

    expect(rows.find((r) => r.id === inFleetChannel)?.fleets).toEqual([{ id: fleetId, name: "Test Fleet" }]);
    expect(rows.find((r) => r.id === outsideChannel)?.fleets).toEqual([]);
  });

  test("scopes to a single fleet when fleetId is passed", async () => {
    const memberChannel = await seedChannel();
    const outsideChannel = await seedChannel();
    const fleetId = newId();
    await db.insert(tables.fleets).values({ id: fleetId, name: "Scoped Fleet", createdAt: nowIso() });
    await db.insert(tables.fleetChannels).values({ fleetId, channelId: memberChannel });

    const rows = await getChannelsList(fleetId);

    expect(rows.map((r) => r.id)).toEqual([memberChannel]);
    expect(rows.some((r) => r.id === outsideChannel)).toBe(false);
  });
});

describe("getFleets", () => {
  test("returns fleets with correct channel counts", async () => {
    const fleetAId = newId();
    const fleetBId = newId();
    await db.insert(tables.fleets).values([
      { id: fleetAId, name: "Fleet A", createdAt: nowIso() },
      { id: fleetBId, name: "Fleet B", createdAt: nowIso() },
    ]);
    const channel1 = await seedChannel();
    const channel2 = await seedChannel();
    const channel3 = await seedChannel();
    await db.insert(tables.fleetChannels).values([
      { fleetId: fleetAId, channelId: channel1 },
      { fleetId: fleetAId, channelId: channel2 },
      { fleetId: fleetBId, channelId: channel3 },
    ]);

    const rows = await getFleets();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.channelCount]));

    expect(byName["Fleet A"]).toBe(2);
    expect(byName["Fleet B"]).toBe(1);
  });
});

describe("getChannelDetail", () => {
  test("returns null for a nonexistent channel id", async () => {
    expect(await getChannelDetail("nonexistent")).toBeNull();
  });

  test("builds series from the videos table, not video_snapshots (zero snapshot rows written)", async () => {
    const channelId = await seedChannel();
    for (let i = 0; i < 5; i++) {
      await seedVideo(channelId, { postedAt: isoDaysAgo(i), outlierScore: i });
    }

    const videoSnapshotRows = await db.select().from(tables.videoSnapshots);
    expect(videoSnapshotRows).toHaveLength(0); // sanity: sourcing from here would make series empty

    const detail = await getChannelDetail(channelId);

    expect(detail).not.toBeNull();
    expect(detail!.series).toHaveLength(5);
    expect(detail!.stats.videoCount).toBe(5);
    for (const point of detail!.series) {
      expect(typeof point.videoId).toBe("string");
      expect(typeof point.capturedAt).toBe("string");
    }
  });

  test("stats.bestScore matches the channel's true max outlier score", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { outlierScore: 3 });
    await seedVideo(channelId, { outlierScore: 27 });
    await seedVideo(channelId, { outlierScore: 9 });

    const detail = await getChannelDetail(channelId);

    expect(detail!.stats.bestScore).toBe(27);
  });

  test("channel.fleets and top-level channel fields match getChannelsList for the same channel", async () => {
    const channelId = await seedChannel();
    const fleetId = newId();
    await db.insert(tables.fleets).values({ id: fleetId, name: "Detail Fleet", createdAt: nowIso() });
    await db.insert(tables.fleetChannels).values({ fleetId, channelId });
    await seedVideo(channelId);

    const listRow = (await getChannelsList()).find((r) => r.id === channelId)!;
    const detail = await getChannelDetail(channelId);

    expect(detail!.channel).toEqual(listRow);
  });
});
