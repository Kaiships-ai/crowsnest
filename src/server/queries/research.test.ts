import { beforeAll, beforeEach, expect, test } from "vitest";

// Same in-memory test-DB pattern as feed.test.ts / own-channel.test.ts.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getResearchSet: typeof import("./research")["getResearchSet"];
let getOutlierPack: typeof import("./research")["getOutlierPack"];

beforeAll(async () => {
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getResearchSet, getOutlierPack } = await import("./research"));
  migrate();
});

beforeEach(async () => {
  await db.delete(tables.videoAnalyses);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
  await db.delete(tables.ownPostInsights);
  await db.delete(tables.ownPosts);
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedCompetitorOutlier(opts: { score: number; daysAgo: number; withAnalysis: boolean }): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const now = isoDaysAgo(opts.daysAgo);
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@rs-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `rs-${videoId}`,
    url: "https://example.com/p", caption: "a scored outlier", postedAt: now, firstSeenAt: now,
    viewCount: 500_000, outlierScore: opts.score,
  });
  if (opts.withAnalysis) {
    await db.insert(tables.videoAnalyses).values({ videoId, hookType: "curiosity-gap", createdAt: now, source: "mcp" });
  }
  return videoId;
}

async function seedOwnPostWithReach(reach: number): Promise<void> {
  const id = newId();
  await db.insert(tables.ownPosts).values({
    id, externalId: `own-${id}`, permalink: `https://ig/p/${id}`,
    mediaType: "VIDEO", productType: "REELS", format: "Reel",
    postedAt: isoDaysAgo(2), firstSeenAt: isoDaysAgo(2),
  });
  await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId: id, capturedAt: isoDaysAgo(0), reach });
}

test("getResearchSet returns competitor outliers with analyses plus own reachIndex benchmark", async () => {
  await seedCompetitorOutlier({ score: 8, daysAgo: 5, withAnalysis: true });
  await seedCompetitorOutlier({ score: 3, daysAgo: 10, withAnalysis: false });
  // 5 measured own posts so reachIndex is a real multiple (median >= 5 usable posts).
  for (const reach of [100, 200, 300, 400, 500]) await seedOwnPostWithReach(reach);

  const set = await getResearchSet({ limit: 10 });
  expect(set.outliers.length).toBeGreaterThan(0);
  // Highest score first, and its analysis is joined.
  expect(set.outliers[0].analysis?.hookType).toBe("curiosity-gap");
  // The unanalyzed outlier joins to null rather than being dropped.
  expect(set.outliers.some((o) => o.analysis === null)).toBe(true);
  // Own side present, distinct unit (reachIndex).
  expect(set.ownBenchmark.length).toBe(5);
  expect(set.ownBenchmark.some((b) => b.reachIndex !== null)).toBe(true);
});

test("getOutlierPack caps at limit and rising mode orders by recency", async () => {
  await seedCompetitorOutlier({ score: 9, daysAgo: 20, withAnalysis: false }); // high score, old
  const recentId = await seedCompetitorOutlier({ score: 2, daysAgo: 1, withAnalysis: false }); // low score, recent
  await seedCompetitorOutlier({ score: 5, daysAgo: 10, withAnalysis: false });

  const pack = await getOutlierPack({ limit: 2, sinceDays: 30, rising: true });
  expect(pack.items.length).toBeLessThanOrEqual(2);
  // Rising = recency: the most recent video ranks first.
  expect(pack.items[0].videoId).toBe(recentId);
});
