import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";

// Test-DB pattern (phase-1 final-review M7): the db singleton binds CROWSNEST_DB_PATH
// at import, so env must be set in beforeAll BEFORE any dynamic import of "@/server/db"
// (or anything that imports it) — otherwise this suite would silently hit the real
// data/crowsnest.db.
//
// `src/server/db/seed.ts` (the old demo-data generator) was deleted as part of the
// Instagram-sync rebuild, so — unlike this file's previous version — every test below
// inserts exactly the rows it needs instead of relying on a shared 80-video fixture.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getOutlierFeed: typeof import("./feed")["getOutlierFeed"];
let getFeedBandCounts: typeof import("./feed")["getFeedBandCounts"];
let getSavedFilters: typeof import("./feed")["getSavedFilters"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOutlierFeed, getFeedBandCounts, getSavedFilters } = await import("./feed"));
});

// Migrate once (idempotent) and wipe every mutable table before each test so counts/
// order assertions never see rows left behind by an earlier test. FK-safe order:
// children (fleet_channels, videos) before their parents (fleets, channels).
beforeEach(async () => {
  migrate();
  await db.delete(tables.fleetChannels);
  await db.delete(tables.fleets);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
  await db.delete(tables.savedFilters);
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedChannel(opts: { followerCount?: number | null; handle?: string; displayName?: string | null } = {}): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: opts.handle ?? `@feed-test-${channelId}`,
    displayName: opts.displayName ?? null,
    followerCount: opts.followerCount ?? null,
    trackedSince: nowIso(),
  });
  return channelId;
}

async function seedVideo(
  channelId: string,
  opts: {
    postedAt?: string;
    outlierScore?: number | null;
    viewCount?: number | null;
    likeCount?: number | null;
    commentCount?: number | null;
    caption?: string | null;
    deletedAt?: string | null;
  } = {}
): Promise<string> {
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `feed-${videoId}`,
    url: "https://example.com/v",
    caption: opts.caption ?? null,
    postedAt: opts.postedAt ?? nowIso(),
    outlierScore: opts.outlierScore ?? null,
    viewCount: opts.viewCount ?? null,
    likeCount: opts.likeCount ?? null,
    commentCount: opts.commentCount ?? null,
    deletedAt: opts.deletedAt ?? null,
    firstSeenAt: nowIso(),
  });
  return videoId;
}

describe("getOutlierFeed", () => {
  test("default sort=score surfaces the highest outlierScore first", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { outlierScore: 2 });
    const topId = await seedVideo(channelId, { outlierScore: 38 });
    await seedVideo(channelId, { outlierScore: 12.4 });

    const { items } = await getOutlierFeed({ sort: "score", limit: 1, offset: 0 });

    expect(items[0].videoId).toBe(topId);
    expect(items[0].outlierScore).toBe(38);
  });

  test("minScore filters to only videos scoring at or above the threshold", async () => {
    const channelId = await seedChannel();
    const above = await seedVideo(channelId, { outlierScore: 12 });
    const exact = await seedVideo(channelId, { outlierScore: 10 });
    const below = await seedVideo(channelId, { outlierScore: 4 });

    const { items, total } = await getOutlierFeed({ minScore: 10, sort: "score", limit: 200, offset: 0 });

    expect(total).toBe(2);
    expect(items.map((i) => i.videoId).sort()).toEqual([above, exact].sort());
    expect(items.some((i) => i.videoId === below)).toBe(false);
  });

  test("sinceDays scopes to videos posted within the window, excluding older ones", async () => {
    const channelId = await seedChannel();
    const recent = await seedVideo(channelId, { postedAt: isoDaysAgo(5) });
    const old = await seedVideo(channelId, { postedAt: isoDaysAgo(60) });

    const { items, total } = await getOutlierFeed({ sinceDays: 30, sort: "recent", limit: 200, offset: 0 });

    expect(total).toBe(1);
    expect(items[0].videoId).toBe(recent);
    expect(items.some((i) => i.videoId === old)).toBe(false);
  });

  test("followerBand scopes to channels within the band (mid: 100K-1M)", async () => {
    const midChannel = await seedChannel({ followerCount: 500_000 });
    const nanoChannel = await seedChannel({ followerCount: 500 });
    const midVideo = await seedVideo(midChannel);
    const nanoVideo = await seedVideo(nanoChannel);

    const { items, total } = await getOutlierFeed({ followerBand: "mid", sort: "recent", limit: 200, offset: 0 });

    expect(total).toBe(1);
    expect(items[0].videoId).toBe(midVideo);
    expect(items.some((i) => i.videoId === nanoVideo)).toBe(false);
  });

  test("a channel in the removed micro range (10K-100K) matches no band chip", async () => {
    const midRange = await seedChannel({ followerCount: 50_000 });
    await seedVideo(midRange);

    // micro was removed; 50K falls between nano (<10K) and mid (100K+), so none of the
    // remaining bands select it — it only shows under "Any followers".
    for (const band of ["nano", "mid", "macro"] as const) {
      const { total } = await getOutlierFeed({ followerBand: band, sort: "recent", limit: 200, offset: 0 });
      expect(total).toBe(0);
    }
  });

  test("fleetId scopes to only channels tracked in that fleet", async () => {
    const inFleetChannel = await seedChannel();
    const outsideChannel = await seedChannel();
    const fleetId = newId();
    await db.insert(tables.fleets).values({ id: fleetId, name: "Test Fleet", createdAt: nowIso() });
    await db.insert(tables.fleetChannels).values({ fleetId, channelId: inFleetChannel });
    const inFleetVideo = await seedVideo(inFleetChannel);
    const outsideVideo = await seedVideo(outsideChannel);

    const result = await getOutlierFeed({ fleetId, sort: "recent", limit: 200, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items[0].videoId).toBe(inFleetVideo);
    expect(result.items.some((i) => i.videoId === outsideVideo)).toBe(false);
  });

  test("an empty-membership fleet scopes to zero results instead of throwing (backlog M2: never inArray(col, []))", async () => {
    const emptyFleetId = newId();
    await db.insert(tables.fleets).values({ id: emptyFleetId, name: "Empty Membership Fleet", createdAt: nowIso() });
    // Deliberately zero fleet_channels rows for this fleet.

    const result = await getOutlierFeed({ fleetId: emptyFleetId, sort: "recent", limit: 200, offset: 0 });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  test("limit/offset paginate with a stable total and no overlap between pages", async () => {
    const channelId = await seedChannel();
    for (let i = 0; i < 25; i++) {
      await seedVideo(channelId, { outlierScore: i, postedAt: isoDaysAgo(i) });
    }

    const all = await getOutlierFeed({ sort: "score", limit: 1000, offset: 0 });
    expect(all.total).toBe(25);

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
    const channelId = await seedChannel();
    await seedVideo(channelId, { outlierScore: 5, postedAt: isoDaysAgo(10) });
    // Posted after the scored video above, so this is the single most-recent video —
    // proving sort=recent doesn't drop it even though it has no score to sort=score by.
    const nullId = await seedVideo(channelId, { outlierScore: null, viewCount: null, postedAt: nowIso() });

    const filtered = await getOutlierFeed({ minScore: 2, sort: "score", limit: 200, offset: 0 });
    expect(filtered.items.some((i) => i.videoId === nullId)).toBe(false);

    const byScore = await getOutlierFeed({ sort: "score", limit: 200, offset: 0 });
    expect(byScore.items.at(-1)?.videoId).toBe(nullId);

    const byRecent = await getOutlierFeed({ sort: "recent", limit: 200, offset: 0 });
    expect(byRecent.items[0]?.videoId).toBe(nullId);
  });

  test("includes soft-deleted videos marked `deleted: true`, rather than dropping them (v1-gap-inventory: they used to be unconditionally filtered out, making the removed-from-Instagram marker unreachable)", async () => {
    const channelId = await seedChannel();
    const liveId = await seedVideo(channelId, { outlierScore: 10 });
    const deletedId = await seedVideo(channelId, { outlierScore: 50 });
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, deletedId));

    const { items, total } = await getOutlierFeed({ sort: "score", limit: 200, offset: 0 });

    expect(total).toBe(2);
    expect(items.find((i) => i.videoId === liveId)?.deleted).toBe(false);
    expect(items.find((i) => i.videoId === deletedId)?.deleted).toBe(true);
  });

  test("engagementRate is (likeCount + commentCount) / viewCount, and null (never a fabricated 0) when any input is null or viewCount is 0", async () => {
    const channelId = await seedChannel();
    const measured = await seedVideo(channelId, { viewCount: 1000, likeCount: 80, commentCount: 20 });
    const noLikes = await seedVideo(channelId, { viewCount: 1000, likeCount: null, commentCount: 20 });
    const zeroViews = await seedVideo(channelId, { viewCount: 0, likeCount: 5, commentCount: 5 });
    const noViews = await seedVideo(channelId, { viewCount: null, likeCount: 5, commentCount: 5 });

    const { items } = await getOutlierFeed({ sort: "recent", limit: 200, offset: 0 });
    const byId = new Map(items.map((i) => [i.videoId, i]));

    expect(byId.get(measured)?.engagementRate).toBe(0.1);
    expect(byId.get(noLikes)?.engagementRate).toBeNull();
    expect(byId.get(zeroViews)?.engagementRate).toBeNull();
    expect(byId.get(noViews)?.engagementRate).toBeNull();
  });

  test("query searches caption, channel handle, and channel display name, case-insensitively", async () => {
    const captionChannel = await seedChannel();
    const captionMatch = await seedVideo(captionChannel, { caption: "How I edit my Reels hooks" });
    const noMatch = await seedVideo(captionChannel, { caption: "Unrelated post" });

    const handleChannel = await seedChannel({ handle: "@ReelsMaster" });
    const handleMatch = await seedVideo(handleChannel);

    const nameChannel = await seedChannel({ displayName: "The Reels Lab" });
    const nameMatch = await seedVideo(nameChannel);

    const { items } = await getOutlierFeed({ query: "reels", sort: "recent", limit: 200, offset: 0 });
    const ids = items.map((i) => i.videoId).sort();

    expect(ids).toEqual([captionMatch, handleMatch, nameMatch].sort());
    expect(ids).not.toContain(noMatch);
  });

  test("a blank or undefined query applies no search filter", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId);
    await seedVideo(channelId);

    const blank = await getOutlierFeed({ query: "   ", sort: "recent", limit: 200, offset: 0 });
    const none = await getOutlierFeed({ sort: "recent", limit: 200, offset: 0 });

    expect(blank.total).toBe(2);
    expect(none.total).toBe(2);
  });

  test("score sort puts real scores desc then nulls last, and uses the outlier_score index", async () => {
    const channelId = await seedChannel();
    await seedVideo(channelId, { outlierScore: 5 });
    await seedVideo(channelId, { outlierScore: 1 });
    await seedVideo(channelId, { outlierScore: null });

    const { items } = await getOutlierFeed({ sort: "score", limit: 200, offset: 0 });
    expect(items.map((i) => i.outlierScore)).toEqual([5, 1, null]);

    // Reads the real plan off the same in-memory db: the score sort is the most-run
    // query in the app, so it must not fall back to a full scan plus a temp b-tree.
    const plan = db.all(sql`EXPLAIN QUERY PLAN
      SELECT id FROM videos ORDER BY outlier_score DESC LIMIT 24`) as { detail: string }[];
    const usesIndex = plan.some((r) => /USING INDEX videos_outlier_score/.test(r.detail));
    expect(usesIndex).toBe(true);
  });
});

describe("getFeedBandCounts", () => {
  test("counts posts per follower band under the other active filters; null-follower and removed-micro-range channels count in no band", async () => {
    const nano = await seedChannel({ followerCount: 500 });
    const microRange = await seedChannel({ followerCount: 50_000 });
    const unknownFollowers = await seedChannel({ followerCount: null });
    await seedVideo(nano);
    await seedVideo(microRange);
    await seedVideo(microRange);
    await seedVideo(unknownFollowers);

    const counts = await getFeedBandCounts({});

    // micro (10K-100K) was removed, so the 50K channel's 2 posts count in no band, the
    // same as the null-follower channel's post.
    expect(counts).toEqual({ nano: 1, mid: 0, macro: 0 });
  });

  test("respects non-band filters passed alongside it", async () => {
    const nano = await seedChannel({ followerCount: 500 });
    await seedVideo(nano, { outlierScore: 10 });
    await seedVideo(nano, { outlierScore: 1 });

    const counts = await getFeedBandCounts({ minScore: 5 });

    expect(counts.nano).toBe(1);
  });
});

describe("getSavedFilters", () => {
  test("returns saved filters with system/non-system flags and criteria intact", async () => {
    await db.insert(tables.savedFilters).values([
      { id: newId(), name: "Balanced", isSystem: true, criteria: { minScore: 5, sinceDays: 30 } },
      { id: newId(), name: "High Conviction", isSystem: true, criteria: { minScore: 10, sinceDays: 14, minViews: 500_000 } },
      { id: newId(), name: "My Custom Filter", isSystem: false, criteria: { minScore: 3 } },
    ]);

    const filters = await getSavedFilters();

    const system = filters.filter((f) => f.isSystem);
    expect(system.map((f) => f.name).sort()).toEqual(["Balanced", "High Conviction"]);

    const balanced = system.find((f) => f.name === "Balanced")!;
    expect(balanced.criteria).toEqual({ minScore: 5, sinceDays: 30 });
    const highConviction = system.find((f) => f.name === "High Conviction")!;
    expect(highConviction.criteria).toEqual({ minScore: 10, sinceDays: 14, minViews: 500_000 });

    const custom = filters.find((f) => f.name === "My Custom Filter")!;
    expect(custom.isSystem).toBe(false);
    expect(custom.criteria).toEqual({ minScore: 3 });
  });
});
