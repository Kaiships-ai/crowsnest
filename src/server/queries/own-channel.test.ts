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
let getOwnReels: typeof import("./own-channel")["getOwnReels"];
let getReelViewHistory: typeof import("./own-channel")["getReelViewHistory"];
let getAccountBreakdowns: typeof import("./own-channel")["getAccountBreakdowns"];
let getPostsWithLatestInsights: typeof import("./own-channel")["getPostsWithLatestInsights"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOwnChannelOverview, getOwnPosts, getOwnPostInsightHistory, getOwnComments, OWN_COMMENTS_FETCH_ERROR_KEY, getOwnReels, getReelViewHistory, getAccountBreakdowns, getPostsWithLatestInsights } = await import("./own-channel"));
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

  test("ACTION-15: profileVisits and followsFromPost are wired; watchTimeSec is not", async () => {
    const overview = await getOwnChannelOverview();
    expect(overview.metrics.profileVisits.wired).toBe(true);
    expect(overview.metrics.followsFromPost.wired).toBe(true);
    expect(overview.metrics.watchTimeSec.wired).toBe(false);
    expect(overview.metrics.reach.wired).toBe(true);
    expect(overview.metrics.saved.wired).toBe(true);
    expect(overview.metrics.shares.wired).toBe(true);
  });
});

describe("getOwnChannelOverview — partial coverage", () => {
  test("a metric missing on some measured posts reports how many, instead of passing a subset off as the total", async () => {
    const a = await seedPost();
    const b = await seedPost();
    await seedInsights(a, { reach: 10 });
    await seedInsights(b, { reach: 20 });
    await db.update(tables.ownPostInsights).set({ profileVisits: 5 }).where(eq(tables.ownPostInsights.ownPostId, a));
    const overview = await getOwnChannelOverview();
    expect(overview.metrics.profileVisits).toMatchObject({ value: 5, sampleSize: 1, missingSampleSize: 1 });
    expect(overview.metrics.reach).toMatchObject({ value: 30, sampleSize: 2, missingSampleSize: 0 });
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

describe("getOwnReels (ACTION-19)", () => {
  test("reels only, newest first, views from the latest snapshot", async () => {
    const post = (id: string, productType: string, postedAt: string) => db.insert(tables.ownPosts).values({ id, externalId: `x-${id}`, permalink: `https://i/${id}`, mediaType: "VIDEO", productType, format: "Reel", postedAt, firstSeenAt: postedAt, thumbnailUrl: `https://cdn/${id}` });
    const snap = (ownPostId: string, capturedAt: string, views: number) => db.insert(tables.ownPostInsights).values({ id: `${ownPostId}-${capturedAt}`, ownPostId, capturedAt, views });
    await post("r1", "REELS", "2026-09-01T00:00:00.000Z");
    await post("r2", "REELS", "2026-09-10T00:00:00.000Z");
    await post("r3", "REELS", "2026-09-20T00:00:00.000Z");
    await post("c1", "FEED", "2026-09-25T00:00:00.000Z");
    for (const id of ["r1", "r2", "r3"]) { await snap(id, "2026-09-26T00:00:00.000Z", 10); await snap(id, "2026-09-27T00:00:00.000Z", 20); }
    const reels = await getOwnReels();
    expect(reels.map((r) => r.ownPostId)).toEqual(["r3", "r2", "r1"]);
    expect(reels.every((r) => r.latest?.views === 20)).toBe(true);
    expect(reels[0].thumbnailUrl).toBe("https://cdn/r3");
    expect((await getReelViewHistory()).some((h) => h.ownPostId === "c1")).toBe(false);
  });

  test("a newer failed capture does not hide the newest good snapshot or its measured-at", async () => {
    const id = await seedPost();
    await seedInsights(id, { capturedAt: "2026-09-26T00:00:00.000Z", views: 10 });
    await seedInsights(id, { capturedAt: "2026-09-27T00:00:00.000Z", views: 20 });
    await seedInsights(id, { capturedAt: "2026-09-28T00:00:00.000Z", fetchError: "HTTP 500" });
    const [reel] = await getOwnReels();
    expect(reel.latest).toMatchObject({ views: 20, capturedAt: "2026-09-27T00:00:00.000Z", fetchError: null });
  });

  test("a reel with only failed captures reads as not measured", async () => {
    const id = await seedPost();
    await seedInsights(id, { fetchError: "HTTP 500" });
    const [reel] = await getOwnReels();
    expect(reel.latest).toBeNull();
  });

  test("view history keeps only snapshots inside the first 168 hours, Graph's +0000 timestamps included", async () => {
    await db.insert(tables.ownPosts).values({ id: "r1", externalId: "x-r1", permalink: "https://i/r1", mediaType: "VIDEO", productType: "REELS", format: "Reel", postedAt: "2026-09-01T00:00:00+0000", firstSeenAt: "2026-09-01T00:00:00.000Z" });
    for (const [capturedAt, views] of [["2026-09-01T02:00:00.000Z", 1], ["2026-09-07T23:59:00.000Z", 2], ["2026-09-08T00:00:00.000Z", 3], ["2026-09-20T00:00:00.000Z", 4]] as const) {
      await db.insert(tables.ownPostInsights).values({ id: `r1-${capturedAt}`, ownPostId: "r1", capturedAt, views });
    }
    expect((await getReelViewHistory()).map((h) => h.views).sort()).toEqual([1, 2]);
  });
});

describe("getPostsWithLatestInsights", () => {
  test("a newer failed capture does not hide the newest good numbers (calendar, Overview, MCP)", async () => {
    const id = await seedPost();
    await seedInsights(id, { capturedAt: "2026-09-26T00:00:00.000Z", reach: 10 });
    await seedInsights(id, { capturedAt: "2026-09-27T00:00:00.000Z", reach: 20 });
    await seedInsights(id, { capturedAt: "2026-09-28T00:00:00.000Z", fetchError: "HTTP 500" });
    await seedInsights(id, { capturedAt: "2026-09-29T00:00:00.000Z", fetchError: "HTTP 500 again" });
    const [post] = await getPostsWithLatestInsights();
    expect(post).toMatchObject({ reach: 20, measuredAt: "2026-09-27T00:00:00.000Z", insightsError: null });
  });

  test("a post with only failed captures shows its newest failure", async () => {
    const id = await seedPost();
    await seedInsights(id, { capturedAt: "2026-09-27T00:00:00.000Z", fetchError: "old" });
    await seedInsights(id, { capturedAt: "2026-09-28T00:00:00.000Z", fetchError: "new" });
    const never = await seedPost({ postedAt: isoDaysAgo(3) });
    const posts = await getPostsWithLatestInsights();
    expect(posts.find((p) => p.ownPostId === id)).toMatchObject({ reach: null, measuredAt: "2026-09-28T00:00:00.000Z", insightsError: "new" });
    expect(posts.find((p) => p.ownPostId === never)).toMatchObject({ measuredAt: null, insightsError: null });
  });
});

describe("getAccountBreakdowns", () => {
  test("newest batch per metric, sorted by value, with the stored refusal", async () => {
    const row = (id: string, capturedAt: string, metric: string, dimension: string, key: string, value: number) => ({ id, capturedAt, metric, dimension, key, value, timeframe: null });
    await db.insert(tables.ownAccountBreakdowns).values([
      row("1", "2026-09-27T00:00:00.000Z", "views", "follower_type", "FOLLOWER", 1),
      row("2", "2026-09-28T00:00:00.000Z", "views", "follower_type", "FOLLOWER", 30),
      row("3", "2026-09-28T00:00:00.000Z", "views", "follower_type", "NON_FOLLOWER", 70),
      row("4", "2026-09-28T00:00:00.000Z", "engaged_audience_demographics", "age", "18-24", 20),
      row("5", "2026-09-28T00:00:00.000Z", "engaged_audience_demographics", "age", "25-34", 40),
    ]);
    await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "not enough users" });
    const b = await getAccountBreakdowns();
    expect(b.followerSplit).toEqual([{ key: "NON_FOLLOWER", value: 70 }, { key: "FOLLOWER", value: 30 }]);
    expect(b.audience.age.map((a) => a.key)).toEqual(["25-34", "18-24"]);
    expect(b.audience.country).toEqual([]);
    expect(b.audienceError).toBe("not enough users");
    expect(b.followerSplitAt).toBe("2026-09-28T00:00:00.000Z");
    expect(b.followerSplitError).toBeNull();
  });

  test("returns the stored follower split failure", async () => {
    await db.insert(tables.appSettings).values({ key: "own_follower_split_fetch_error", value: "HTTP 400: bad" });
    expect((await getAccountBreakdowns()).followerSplitError).toBe("HTTP 400: bad");
  });
});
