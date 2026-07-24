import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Test-DB pattern (phase-1 final-review M7): the db singleton binds CROWSNEST_DB_PATH
// at import, so env must be set in beforeAll BEFORE any dynamic import of "@/server/db"
// (or anything that imports it) — otherwise this suite would silently hit the real
// data/crowsnest.db. Mirrors src/server/db/seed.test.ts's shape.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let seedDatabase: typeof import("@/server/db/seed")["seedDatabase"];
let getOutlierFeed: typeof import("./feed")["getOutlierFeed"];
let getSavedFilters: typeof import("./feed")["getSavedFilters"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ seedDatabase } = await import("@/server/db/seed"));
  ({ getOutlierFeed, getSavedFilters } = await import("./feed"));
});

// Reseed before every test so each test starts from the same deterministic 80-video
// fixture with no cross-test pollution (some tests below insert extra rows).
beforeEach(async () => {
  migrate();
  await seedDatabase(db);
});

describe("getOutlierFeed", () => {
  test("default sort=score surfaces the true top scorer first (planted ~38.0x)", async () => {
    const allVideos = await db.select().from(tables.videos);
    const maxScore = Math.max(...allVideos.map((v) => v.outlierScore ?? -Infinity));

    const { items } = await getOutlierFeed({ sort: "score", limit: 1, offset: 0 });

    expect(items[0].outlierScore).toBe(maxScore);
    expect(maxScore).toBeGreaterThanOrEqual(37.5);
    expect(maxScore).toBeLessThanOrEqual(38.5);
  });

  test("minScore filters to only videos scoring at or above the threshold", async () => {
    const allVideos = await db.select().from(tables.videos);
    const expected = allVideos.filter((v) => (v.outlierScore ?? -Infinity) >= 10);

    const { items, total } = await getOutlierFeed({ minScore: 10, sort: "score", limit: 200, offset: 0 });

    expect(total).toBe(expected.length);
    expect(items).toHaveLength(expected.length);
    expect(items.every((i) => (i.outlierScore ?? -Infinity) >= 10)).toBe(true);
    // sanity: at least the 3 planted 10x+ outliers (12.4x, 38.0x, 22.4x) survive
    expect(expected.length).toBeGreaterThanOrEqual(3);
  });

  test("sinceDays scopes to videos posted within the window, excluding older ones", async () => {
    const cutoffMs = Date.now() - 30 * 86_400_000;
    const allVideos = await db.select().from(tables.videos);
    const expected = allVideos.filter((v) => new Date(v.postedAt).getTime() >= cutoffMs);

    const { items, total } = await getOutlierFeed({ sinceDays: 30, sort: "recent", limit: 200, offset: 0 });

    expect(total).toBe(expected.length);
    expect(items.every((i) => new Date(i.postedAt).getTime() >= cutoffMs)).toBe(true);
    // sanity: the filter actually narrows the seed's 90-day spread
    expect(expected.length).toBeLessThan(allVideos.length);
  });

  test("followerBand scopes to channels within the band (micro: 10K-100K)", async () => {
    const channels = await db.select().from(tables.channels);
    const microIds = new Set(
      channels.filter((c) => (c.followerCount ?? 0) >= 10_000 && (c.followerCount ?? 0) < 100_000).map((c) => c.id)
    );
    const allVideos = await db.select().from(tables.videos);
    const expectedCount = allVideos.filter((v) => microIds.has(v.channelId)).length;

    const { items, total } = await getOutlierFeed({ followerBand: "micro", sort: "recent", limit: 200, offset: 0 });

    expect(microIds.size).toBeGreaterThan(0); // sanity: seed has a micro-band channel
    expect(total).toBe(expectedCount);
    expect(items.every((i) => microIds.has(i.channel.id))).toBe(true);
  });

  test("fleetId scopes to only channels tracked in that fleet", async () => {
    const fleets = await db.select().from(tables.fleets);
    const aiNiche = fleets.find((f) => f.name === "AI Niche");
    const craftRefs = fleets.find((f) => f.name === "Craft References");
    expect(aiNiche).toBeDefined();
    expect(craftRefs).toBeDefined();

    const memberIds = async (fleetId: string) => {
      const rows = await db.select().from(tables.fleetChannels).where(eq(tables.fleetChannels.fleetId, fleetId));
      return new Set(rows.map((r) => r.channelId));
    };
    const allVideos = await db.select().from(tables.videos);

    const aiNicheIds = await memberIds(aiNiche!.id);
    const aiNicheExpected = allVideos.filter((v) => aiNicheIds.has(v.channelId)).length;
    const aiNicheResult = await getOutlierFeed({ fleetId: aiNiche!.id, sort: "recent", limit: 200, offset: 0 });
    expect(aiNicheResult.total).toBe(aiNicheExpected);
    expect(aiNicheResult.items.every((i) => aiNicheIds.has(i.channel.id))).toBe(true);

    const craftIds = await memberIds(craftRefs!.id);
    const craftExpected = allVideos.filter((v) => craftIds.has(v.channelId)).length;
    const craftResult = await getOutlierFeed({ fleetId: craftRefs!.id, sort: "recent", limit: 200, offset: 0 });
    expect(craftResult.total).toBe(craftExpected);
    expect(craftResult.items.every((i) => craftIds.has(i.channel.id))).toBe(true);
  });

  test("limit/offset paginate with a stable total and no overlap between pages", async () => {
    const all = await getOutlierFeed({ sort: "score", limit: 1000, offset: 0 });
    expect(all.total).toBe(80); // matches seed.test.ts's known invariant

    const page1 = await getOutlierFeed({ sort: "score", limit: 10, offset: 0 });
    const page2 = await getOutlierFeed({ sort: "score", limit: 10, offset: 10 });

    expect(page1.total).toBe(all.total);
    expect(page2.total).toBe(all.total);
    expect(page1.items).toHaveLength(10);
    expect(page2.items).toHaveLength(10);
    expect(page1.items.map((i) => i.videoId)).toEqual(all.items.slice(0, 10).map((i) => i.videoId));
    expect(page2.items.map((i) => i.videoId)).toEqual(all.items.slice(10, 20).map((i) => i.videoId));

    const page1Ids = new Set(page1.items.map((i) => i.videoId));
    expect(page2.items.some((i) => page1Ids.has(i.videoId))).toBe(false);
  });

  test("null outlier scores: excluded when minScore is set, sorted last under sort=score, still present under sort=recent", async () => {
    const [anyChannel] = await db.select().from(tables.channels);
    const nullId = newId();
    const now = nowIso();
    await db.insert(tables.videos).values({
      id: nullId,
      channelId: anyChannel.id,
      platform: anyChannel.platform,
      externalId: "null-score-fixture",
      url: "https://example.com/null-score-fixture",
      caption: "null score fixture",
      postedAt: now, // captured after seeding, so this is the single most-recent video
      viewCount: null,
      outlierScore: null,
      firstSeenAt: now,
    });

    const filtered = await getOutlierFeed({ minScore: 2, sort: "score", limit: 200, offset: 0 });
    expect(filtered.items.some((i) => i.videoId === nullId)).toBe(false);

    const byScore = await getOutlierFeed({ sort: "score", limit: 200, offset: 0 });
    expect(byScore.items.at(-1)?.videoId).toBe(nullId);

    const byRecent = await getOutlierFeed({ sort: "recent", limit: 200, offset: 0 });
    expect(byRecent.items[0]?.videoId).toBe(nullId);
  });
});

describe("getSavedFilters", () => {
  test("returns the two system presets seeded in phase 1, with matching FeedFilters-shaped criteria keys", async () => {
    const filters = await getSavedFilters();
    const system = filters.filter((f) => f.isSystem);
    expect(system.map((f) => f.name).sort()).toEqual(["Balanced", "High Conviction"]);

    const balanced = system.find((f) => f.name === "Balanced")!;
    expect(balanced.criteria).toEqual({ minScore: 5, sinceDays: 30 });

    const highConviction = system.find((f) => f.name === "High Conviction")!;
    expect(highConviction.criteria).toEqual({ minScore: 10, sinceDays: 14, minViews: 500_000 });
  });
});
