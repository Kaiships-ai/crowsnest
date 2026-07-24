import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Same test-DB pattern as feed.test.ts / seed.test.ts (phase-1 final-review M7).
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let seedDatabase: typeof import("@/server/db/seed")["seedDatabase"];
let computeChannelMedian: typeof import("@/server/services/outlier-calc")["computeChannelMedian"];
let getChannelsList: typeof import("./channels")["getChannelsList"];
let getFleets: typeof import("./channels")["getFleets"];
let getChannelDetail: typeof import("./channels")["getChannelDetail"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ seedDatabase } = await import("@/server/db/seed"));
  ({ computeChannelMedian } = await import("@/server/services/outlier-calc"));
  ({ getChannelsList, getFleets, getChannelDetail } = await import("./channels"));
});

beforeEach(async () => {
  migrate();
  await seedDatabase(db);
});

describe("getChannelsList", () => {
  test("returns all 4 seeded channels", async () => {
    const rows = await getChannelsList();
    expect(rows).toHaveLength(4);
  });

  test("medianViews matches the phase-1 computeChannelMedian fallback (seed writes zero channel_snapshots rows)", async () => {
    const snapshotRows = await db.select().from(tables.channelSnapshots);
    expect(snapshotRows).toHaveLength(0); // sanity per M8: nothing to fall back FROM but the videos table

    const channels = await db.select().from(tables.channels);
    const rows = await getChannelsList();

    for (const channel of channels) {
      const videos = await db
        .select({ id: tables.videos.id, viewCount: tables.videos.viewCount, postedAt: tables.videos.postedAt })
        .from(tables.videos)
        .where(eq(tables.videos.channelId, channel.id));
      const expectedMedian = computeChannelMedian(videos);
      const row = rows.find((r) => r.id === channel.id);
      expect(row?.medianViews).toBe(expectedMedian);
    }
  });

  test("outliers30d counts videos scoring >= 2 posted within the last 30 days", async () => {
    const cutoffMs = Date.now() - 30 * 86_400_000;
    const channels = await db.select().from(tables.channels);
    const allVideos = await db.select().from(tables.videos);
    const rows = await getChannelsList();

    for (const channel of channels) {
      const expected = allVideos.filter(
        (v) => v.channelId === channel.id && (v.outlierScore ?? 0) >= 2 && new Date(v.postedAt).getTime() >= cutoffMs
      ).length;
      const row = rows.find((r) => r.id === channel.id);
      expect(row?.outliers30d).toBe(expected);
    }
  });

  test("reports each channel's fleet memberships (3 in AI Niche, 1 in Craft References)", async () => {
    const rows = await getChannelsList();
    const inAiNiche = rows.filter((r) => r.fleets.some((f) => f.name === "AI Niche"));
    const inCraftRefs = rows.filter((r) => r.fleets.some((f) => f.name === "Craft References"));
    expect(inAiNiche).toHaveLength(3);
    expect(inCraftRefs).toHaveLength(1);
  });

  test("scopes to a single fleet when fleetId is passed", async () => {
    const fleets = await db.select().from(tables.fleets);
    const aiNiche = fleets.find((f) => f.name === "AI Niche")!;
    const craftRefs = fleets.find((f) => f.name === "Craft References")!;

    expect(await getChannelsList(aiNiche.id)).toHaveLength(3);
    expect(await getChannelsList(craftRefs.id)).toHaveLength(1);
  });
});

describe("getFleets", () => {
  test("returns both seeded fleets with correct channel counts", async () => {
    const rows = await getFleets();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.channelCount]));
    expect(byName["AI Niche"]).toBe(3);
    expect(byName["Craft References"]).toBe(1);
  });
});

describe("getChannelDetail", () => {
  test("returns null for a nonexistent channel id", async () => {
    expect(await getChannelDetail("nonexistent")).toBeNull();
  });

  test("builds series from the videos table, not video_snapshots (M8: seed plants zero snapshot rows)", async () => {
    const videoSnapshotRows = await db.select().from(tables.videoSnapshots);
    expect(videoSnapshotRows).toHaveLength(0); // sanity: sourcing from here would make series empty

    const [channel] = await db.select().from(tables.channels);
    const detail = await getChannelDetail(channel.id);

    expect(detail).not.toBeNull();
    expect(detail!.series).toHaveLength(20);
    expect(detail!.stats.videoCount).toBe(20);
    for (const point of detail!.series) {
      expect(typeof point.videoId).toBe("string");
      expect(typeof point.capturedAt).toBe("string");
    }
  });

  test("stats.bestScore matches the channel's true max outlier score", async () => {
    const [channel] = await db.select().from(tables.channels);
    const videos = await db.select().from(tables.videos).where(eq(tables.videos.channelId, channel.id));
    const expectedBest = Math.max(...videos.map((v) => v.outlierScore ?? -Infinity));

    const detail = await getChannelDetail(channel.id);

    expect(detail!.stats.bestScore).toBe(expectedBest);
  });

  test("channel.fleets and top-level channel fields match getChannelsList for the same channel", async () => {
    const [channel] = await db.select().from(tables.channels);
    const listRow = (await getChannelsList()).find((r) => r.id === channel.id)!;
    const detail = await getChannelDetail(channel.id);

    expect(detail!.channel).toEqual(listRow);
  });
});
