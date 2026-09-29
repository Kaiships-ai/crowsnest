import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

// Same test-DB pattern as channels.test.ts / feed.test.ts.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getOwnChannelOverview: typeof import("./own-channel")["getOwnChannelOverview"];
let getOwnPosts: typeof import("./own-channel")["getOwnPosts"];
let getOwnPostInsightHistory: typeof import("./own-channel")["getOwnPostInsightHistory"];
let getOwnComments: typeof import("./own-channel")["getOwnComments"];
let OWN_COMMENTS_FETCH_ERROR_KEY: typeof import("./own-channel")["OWN_COMMENTS_FETCH_ERROR_KEY"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOwnChannelOverview, getOwnPosts, getOwnPostInsightHistory, getOwnComments, OWN_COMMENTS_FETCH_ERROR_KEY } = await import("./own-channel"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.ownComments);
  await db.delete(tables.ownPostInsights);
  await db.delete(tables.ownPosts);
  await db.delete(tables.ownAccountSnapshots);
  await db.delete(tables.ownAccountBreakdowns);
  await db.delete(tables.appSettings);
});

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedPost(opts: { postedAt?: string; permalink?: string; format?: string } = {}): Promise<string> {
  const id = newId();
  await db.insert(tables.ownPosts).values({
    id,
    externalId: `ext-${id}`,
    permalink: opts.permalink ?? `https://www.instagram.com/p/${id}/`,
    mediaType: "VIDEO",
    productType: "REELS",
    format: opts.format ?? "Reel",
    caption: "a caption",
    postedAt: opts.postedAt ?? isoDaysAgo(1),
    firstSeenAt: isoDaysAgo(1),
  });
  return id;
}

async function seedInsights(
  ownPostId: string,
  opts: { capturedAt?: string; reach?: number | null; saved?: number | null; shares?: number | null; views?: number | null; likes?: number | null; fetchError?: string | null } = {}
): Promise<void> {
  await db.insert(tables.ownPostInsights).values({
    id: newId(),
    ownPostId,
    capturedAt: opts.capturedAt ?? isoDaysAgo(0),
    reach: opts.reach ?? null,
    saved: opts.saved ?? null,
    shares: opts.shares ?? null,
    views: opts.views ?? null,
    likes: opts.likes ?? null,
    fetchError: opts.fetchError ?? null,
  });
}

describe("getOwnChannelOverview — not connected / never measured", () => {
  test("an empty database returns the designed absent state, never a thrown error or a zero", async () => {
    const overview = await getOwnChannelOverview();
    expect(overview.account).toBeNull();
    expect(overview.postsInWindow).toBe(0);
    expect(overview.postsMeasured).toBe(0);
    expect(overview.medianReach).toBeNull();
    expect(overview.medianSampleSize).toBe(0);
    for (const metric of Object.values(overview.metrics)) {
      expect(metric.value).toBeNull();
      expect(metric.sampleSize).toBe(0);
      expect(metric.failedSampleSize).toBe(0);
    }
  });

  test("unwired metrics (profileVisits, followsFromPost, watchTimeSec) always report wired: false", async () => {
    const overview = await getOwnChannelOverview();
    expect(overview.metrics.profileVisits.wired).toBe(false);
    expect(overview.metrics.followsFromPost.wired).toBe(false);
    expect(overview.metrics.watchTimeSec.wired).toBe(false);
    expect(overview.metrics.reach.wired).toBe(true);
    expect(overview.metrics.saved.wired).toBe(true);
    expect(overview.metrics.shares.wired).toBe(true);
  });
});

describe("getOwnChannelOverview — stored data", () => {
  test("reports the newest account snapshot with its measuredAt date", async () => {
    const latestCapturedAt = isoDaysAgo(0);
    await db.insert(tables.ownAccountSnapshots).values({
      id: newId(),
      capturedAt: isoDaysAgo(5),
      externalId: "acct1",
      username: "old-username",
      followerCount: 100,
    });
    await db.insert(tables.ownAccountSnapshots).values({
      id: newId(),
      capturedAt: latestCapturedAt,
      externalId: "acct1",
      username: "kallaway",
      followerCount: 200,
    });

    const overview = await getOwnChannelOverview();
    expect(overview.account).toMatchObject({ username: "kallaway", followerCount: 200 });
    expect(overview.account?.measuredAt).toBe(latestCapturedAt);
  });

  test("sums reach across measured posts and reports the sample size, excluding failed posts", async () => {
    const p1 = await seedPost({ postedAt: isoDaysAgo(1) });
    const p2 = await seedPost({ postedAt: isoDaysAgo(2) });
    const p3 = await seedPost({ postedAt: isoDaysAgo(3) });
    await seedInsights(p1, { reach: 100 });
    await seedInsights(p2, { reach: 200 });
    await seedInsights(p3, { fetchError: "insights call failed" });

    const overview = await getOwnChannelOverview(30);
    expect(overview.postsInWindow).toBe(3);
    expect(overview.postsMeasured).toBe(2);
    expect(overview.metrics.reach.value).toBe(300);
    expect(overview.metrics.reach.sampleSize).toBe(2);
    expect(overview.metrics.reach.failedSampleSize).toBe(1);
  });

  test("a post outside the window does not contribute to postsInWindow or any metric", async () => {
    const inWindow = await seedPost({ postedAt: isoDaysAgo(5) });
    const outOfWindow = await seedPost({ postedAt: isoDaysAgo(90) });
    await seedInsights(inWindow, { reach: 100 });
    await seedInsights(outOfWindow, { reach: 9_999_999 });

    const overview = await getOwnChannelOverview(30);
    expect(overview.postsInWindow).toBe(1);
    expect(overview.metrics.reach.value).toBe(100);
  });

  test("a post never measured (no insights row at all) is not counted as measured or failed", async () => {
    await seedPost({ postedAt: isoDaysAgo(1) });
    const overview = await getOwnChannelOverview(30);
    expect(overview.postsInWindow).toBe(1);
    expect(overview.postsMeasured).toBe(0);
    expect(overview.metrics.reach.failedSampleSize).toBe(0);
  });

  test("offsetDays selects the prior window, leaving the current window untouched", async () => {
    // Two posts in the last 30 days, one 30-60 days ago.
    await seedPost({ postedAt: isoDaysAgo(2) });
    await seedPost({ postedAt: isoDaysAgo(20) });
    await seedPost({ postedAt: isoDaysAgo(45) });

    const current = await getOwnChannelOverview(30, { offsetDays: 0 });
    const previous = await getOwnChannelOverview(30, { offsetDays: 30 });

    expect(current.postsInWindow).toBe(2);
    expect(previous.postsInWindow).toBe(1);
  });
});

describe("getOwnPosts", () => {
  test("an empty database returns an empty page, not a thrown error", async () => {
    const { items, total } = await getOwnPosts();
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  test("orders newest first and paginates", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedPost({ postedAt: isoDaysAgo(i) });
    }
    const page1 = await getOwnPosts({ limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].postedAt >= page1.items[1].postedAt).toBe(true);
  });

  test("reachIndex is null until 5 posts have a measured reach, then a real multiple", async () => {
    const ids = [] as string[];
    for (let i = 0; i < 5; i += 1) ids.push(await seedPost({ postedAt: isoDaysAgo(i) }));
    // Only 3 measured — below MIN_USABLE of 5.
    await seedInsights(ids[0], { reach: 100 });
    await seedInsights(ids[1], { reach: 200 });
    await seedInsights(ids[2], { reach: 300 });

    let { items } = await getOwnPosts();
    expect(items.find((p) => p.ownPostId === ids[0])?.reachIndex).toBeNull();

    await seedInsights(ids[3], { reach: 400 });
    await seedInsights(ids[4], { reach: 500 });
    ({ items } = await getOwnPosts());
    const row = items.find((p) => p.ownPostId === ids[2])!;
    expect(row.reachIndex).toBe(1); // median is 300, this post's reach is 300 -> 1.0x
  });

  test("a post whose insights call failed shows its error, not a zero", async () => {
    const id = await seedPost();
    await seedInsights(id, { fetchError: "HTTP 500: internal error" });
    const { items } = await getOwnPosts();
    expect(items[0].insightsError).toBe("HTTP 500: internal error");
    expect(items[0].reach).toBeNull();
  });
});

describe("getOwnPostInsightHistory", () => {
  test("an unmeasured post returns an empty history, not an error", async () => {
    const id = await seedPost();
    expect(await getOwnPostInsightHistory(id)).toEqual([]);
  });

  test("returns every measurement newest first, history is never overwritten", async () => {
    const id = await seedPost();
    await seedInsights(id, { capturedAt: isoDaysAgo(3), reach: 100 });
    await seedInsights(id, { capturedAt: isoDaysAgo(1), reach: 300 });
    await seedInsights(id, { capturedAt: isoDaysAgo(2), reach: 200 });

    const history = await getOwnPostInsightHistory(id);
    expect(history.map((h) => h.reach)).toEqual([300, 200, 100]);
  });
});

describe("getOwnComments", () => {
  test("an empty database returns the designed empty summary", async () => {
    const summary = await getOwnComments();
    expect(summary.counts).toEqual({});
    expect(summary.organic).toEqual([]);
    expect(summary.fetchError).toBeNull();
    expect(summary.classifierVersion.length).toBeGreaterThan(0);
  });

  test("counts by kind and lists organic comments with their post's permalink", async () => {
    const postId = await seedPost({ permalink: "https://www.instagram.com/p/xyz/" });
    const postedAt = isoDaysAgo(0);
    await db.insert(tables.ownComments).values([
      { id: newId(), ownPostId: postId, externalId: "c1", author: "a_fan", text: "love it", kind: "organic", classifierVersion: "v1", capturedAt: postedAt, postedAt },
      { id: newId(), ownPostId: postId, externalId: "c2", author: "kallaway", text: "thanks!", kind: "own-comment", classifierVersion: "v1", capturedAt: postedAt, postedAt },
    ]);

    const summary = await getOwnComments();
    expect(summary.counts).toEqual({ organic: 1, "own-comment": 1 });
    expect(summary.organic).toEqual([{ author: "a_fan", text: "love it", postedAt, permalink: "https://www.instagram.com/p/xyz/" }]);
  });

  test("surfaces the last comment-pull failure stored separately from the comment rows", async () => {
    await db.insert(tables.appSettings).values({ key: OWN_COMMENTS_FETCH_ERROR_KEY, value: "Instagram is rate-limiting the Graph API." });
    const summary = await getOwnComments();
    expect(summary.fetchError).toBe("Instagram is rate-limiting the Graph API.");
  });
});

describe("reel columns and own_account_breakdowns (migration 0030)", () => {
  test("new nullable columns and the breakdowns table accept a write", async () => {
    await db.insert(tables.ownPosts).values({
      id: "p-mig", externalId: "x-mig", permalink: "https://i/x", mediaType: "VIDEO", productType: "REELS",
      format: "Reel", postedAt: "2026-09-01T00:00:00.000Z", firstSeenAt: "2026-09-01T00:00:00.000Z",
      thumbnailUrl: "https://cdn/x.jpg",
    });
    await db.insert(tables.ownPostInsights).values({
      id: "i-mig", ownPostId: "p-mig", capturedAt: "2026-09-01T01:00:00.000Z",
      reposts: 3, skipRate: 41.5, bioLinkTaps: 7, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000,
    });
    await db.insert(tables.ownAccountBreakdowns).values({
      id: "b-mig", capturedAt: "2026-09-01T01:00:00.000Z", metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 10, timeframe: "day",
    });
    const [row] = await db.select().from(tables.ownPostInsights).where(eq(tables.ownPostInsights.id, "i-mig"));
    expect(row).toMatchObject({ reposts: 3, skipRate: 41.5, bioLinkTaps: 7, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000 });
  });
});
