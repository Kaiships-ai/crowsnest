import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Same test-DB pattern as feed.test.ts. `src/server/db/seed.ts` (the old demo-data
// generator) was deleted as part of the Instagram-sync rebuild, so every test below
// inserts exactly the rows it needs instead of relying on a shared seeded fixture.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let computeChannelBaseline: typeof import("@/server/services/outlier-calc")["computeChannelBaseline"];
let getChannelsList: typeof import("./channels")["getChannelsList"];
let getFleets: typeof import("./channels")["getFleets"];
let getChannelDetail: typeof import("./channels")["getChannelDetail"];
let getChannelMedianBasis: typeof import("./channels")["getChannelMedianBasis"];
let getChannelMedianHistory: typeof import("./channels")["getChannelMedianHistory"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token"; // config.ts, read transitively via @/server/settings
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ computeChannelBaseline } = await import("@/server/services/outlier-calc"));
  ({ getChannelsList, getFleets, getChannelDetail, getChannelMedianBasis, getChannelMedianHistory } = await import("./channels"));
});

// Migrate once (idempotent) and wipe every mutable table before each test. FK-safe
// order: children (fleet_channels, videos) before their parents (fleets, channels).
beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
  await db.delete(tables.channelSnapshots);
  await db.delete(tables.appSettings);
});

async function writeSetting(key: string, value: string): Promise<void> {
  await db.insert(tables.appSettings).values({ key, value });
}

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

  test("medianViews matches the computeChannelBaseline fallback (zero channel_snapshots rows written)", async () => {
    // computeChannelBaseline requires >= scoreMinUsablePosts (default 5, no app_settings
    // row written in this test) usable (non-null viewCount) videos before it will
    // produce a number at all — fewer than that and it's null on both sides, which
    // wouldn't actually exercise the median math.
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
    // Bare call (no options): only 5 videos exist, so the default 12-post window in
    // production settings and this function's own 20-post default both include all 5 —
    // the two paths agree here regardless of the window difference.
    const expectedMedian = computeChannelBaseline(videos);
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
    // 5 live videos (enough to clear computeChannelBaseline's default minUsable floor),
    // 3 of which are scored outliers within the last 30 days.
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

  // Removed posts still reach the screen, carrying `deleted: true`, so the marker is
  // reachable. That makes it easy for a count to fold them in with the live posts and
  // report a number that reads as true and is not. The live database has no removed
  // posts, so nothing but this test would catch a regression.
  test("videoCount counts live posts only, and removed posts are counted separately", async () => {
    const channelId = await seedChannel();
    for (let i = 0; i < 4; i++) {
      await seedVideo(channelId, { postedAt: isoDaysAgo(i), outlierScore: 1 });
    }
    const removedId = await seedVideo(channelId, { postedAt: isoDaysAgo(4), outlierScore: 1 });
    const alsoRemovedId = await seedVideo(channelId, { postedAt: isoDaysAgo(5), outlierScore: 1 });
    await db
      .update(tables.videos)
      .set({ deletedAt: nowIso() })
      .where(inArray(tables.videos.id, [removedId, alsoRemovedId]));

    const detail = await getChannelDetail(channelId);

    expect(detail!.stats.videoCount).toBe(4);
    expect(detail!.stats.removedCount).toBe(2);
    // The removed ones still come through, so the screen can mark them.
    expect(detail!.videos).toHaveLength(6);
    expect(detail!.videos.filter((v) => v.deleted)).toHaveLength(2);
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

describe("getChannelMedianBasis", () => {
  test("returns null for a nonexistent channel id", async () => {
    expect(await getChannelMedianBasis("nonexistent")).toBeNull();
  });

  test("fewer usable posts than the settings module's minUsable: median null, but bars still populated with what exists", async () => {
    // Default score_min_usable_posts is 5 (no app_settings row written in this test) —
    // 3 usable posts is below that floor.
    const channelId = await seedChannel();
    await seedVideo(channelId, { viewCount: 100, postedAt: isoDaysAgo(3) });
    await seedVideo(channelId, { viewCount: 200, postedAt: isoDaysAgo(2) });
    await seedVideo(channelId, { viewCount: 300, postedAt: isoDaysAgo(1) });

    const basis = await getChannelMedianBasis(channelId);

    expect(basis).not.toBeNull();
    expect(basis!.median).toBeNull();
    expect(basis!.sampleSize).toBe(3);
    expect(basis!.minUsable).toBe(5);
    expect(basis!.bars).toHaveLength(3);
    // "here are the posts we have" stays true and useful even with no median.
    expect(basis!.bars.map((b) => b.viewCount)).toEqual([100, 200, 300]);
  });

  test("zero usable posts: median null, sampleSize 0, bars empty — not an error", async () => {
    const channelId = await seedChannel();

    const basis = await getChannelMedianBasis(channelId);

    expect(basis!.median).toBeNull();
    expect(basis!.sampleSize).toBe(0);
    expect(basis!.bars).toEqual([]);
    expect(basis!.spanFrom).toBeNull();
    expect(basis!.spanTo).toBeNull();
  });

  test("reads the window and method from the settings module rather than a hardcoded default", async () => {
    const channelId = await seedChannel();
    for (let i = 0; i < 8; i++) {
      await seedVideo(channelId, { viewCount: (i + 1) * 100, postedAt: isoDaysAgo(8 - i) });
    }

    // Default window (last12Posts) and default method (median) — all 8 posts fit inside
    // a 12-post window, so the basis is a plain median over all 8.
    const defaultBasis = await getChannelMedianBasis(channelId);
    const rawVideos = await db
      .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
      .from(tables.videos);
    expect(defaultBasis!.method).toBe("median");
    expect(defaultBasis!.sampleSize).toBe(8);
    expect(defaultBasis!.median).toBe(
      computeChannelBaseline(rawVideos, { method: "median", window: { kind: "posts", count: 12 }, minUsable: 5 })
    );

    // Narrow the window to 3 posts and switch the method to mean — the histogram must
    // follow, not the old 12-post median, or it would misrepresent the score it explains.
    await writeSetting("score_baseline_window", "last12Posts"); // unchanged, window kind stays "posts"
    await writeSetting("score_min_usable_posts", "3");
    await writeSetting("score_baseline_method", "mean");

    const narrowed = await getChannelMedianBasis(channelId);
    expect(narrowed!.method).toBe("mean");
    expect(narrowed!.minUsable).toBe(3);
  });

  test("bars are oldest-first, and isSelf marks only the given selfVideoId", async () => {
    const channelId = await seedChannel();
    const v1 = await seedVideo(channelId, { viewCount: 100, postedAt: isoDaysAgo(3) });
    const v2 = await seedVideo(channelId, { viewCount: 200, postedAt: isoDaysAgo(2) });
    const v3 = await seedVideo(channelId, { viewCount: 300, postedAt: isoDaysAgo(1) });

    const basis = await getChannelMedianBasis(channelId, v3);

    expect(basis!.bars.map((b) => b.videoId)).toEqual([v1, v2, v3]);
    expect(basis!.bars.map((b) => b.isSelf)).toEqual([false, false, true]);
    expect(basis!.spanFrom).toBe(basis!.bars[0].postedAt);
    expect(basis!.spanTo).toBe(basis!.bars.at(-1)!.postedAt);
  });

  test("selfVideoId outside the sampled window marks no bar as self, rather than throwing", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { viewCount: 100 });

    const basis = await getChannelMedianBasis(channelId, "some-other-video-not-in-window");

    expect(basis!.bars.every((b) => !b.isSelf)).toBe(true);
  });

  test("excludes soft-deleted videos from the sample", async () => {
    const channelId = await seedChannel();
    const liveId = await seedVideo(channelId, { viewCount: 100 });
    const deletedId = await seedVideo(channelId, { viewCount: 999_999 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const basis = await getChannelMedianBasis(channelId);

    expect(basis!.bars.map((b) => b.videoId)).toEqual([liveId]);
  });
});

describe("getChannelMedianHistory", () => {
  test("returns an empty array for a channel with no recorded snapshots — not an error", async () => {
    const channelId = await seedChannel();
    expect(await getChannelMedianHistory(channelId)).toEqual([]);
  });

  test("returns snapshots oldest first, scoped to the given channel", async () => {
    const channelId = await seedChannel();
    const otherChannelId = await seedChannel();
    await db.insert(tables.channelSnapshots).values([
      { id: newId(), channelId, capturedAt: isoDaysAgo(3), medianViews: 100, followerCount: 1000 },
      { id: newId(), channelId, capturedAt: isoDaysAgo(1), medianViews: 300, followerCount: 1200 },
      { id: newId(), channelId, capturedAt: isoDaysAgo(2), medianViews: 200, followerCount: 1100 },
      { id: newId(), channelId: otherChannelId, capturedAt: isoDaysAgo(1), medianViews: 999, followerCount: 1 },
    ]);

    const history = await getChannelMedianHistory(channelId);

    expect(history.map((p) => p.medianViews)).toEqual([100, 200, 300]);
    expect(history.every((p) => p.followerCount !== null)).toBe(true);
  });

  test("limit caps the number of points returned, keeping the most recent ones", async () => {
    const channelId = await seedChannel();
    await db.insert(tables.channelSnapshots).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: newId(),
        channelId,
        capturedAt: isoDaysAgo(5 - i),
        medianViews: (i + 1) * 100,
        followerCount: null,
      }))
    );

    const history = await getChannelMedianHistory(channelId, 2);

    expect(history.map((p) => p.medianViews)).toEqual([400, 500]); // newest 2, oldest-first
  });
});
