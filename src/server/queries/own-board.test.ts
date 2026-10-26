import { beforeEach, expect, test } from "vitest";

import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { saveFunnel } from "@/server/services/funnel";
import { getOwnBoard, getOwnReelBoard } from "./own-board";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const T_OLD = daysAgo(1.5);
const T_NEW = daysAgo(0.5);

beforeEach(async () => {
  migrate();
  for (const t of [tables.reelFunnel, tables.plannedPosts, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns]) await db.delete(t);
});

async function seed(): Promise<void> {
  await db.insert(tables.ownAccountSnapshots).values([
    { id: "s1", capturedAt: daysAgo(40), externalId: "me", username: "kai", followerCount: 900 },
    { id: "s2", capturedAt: daysAgo(10), externalId: "me", username: "kai", followerCount: 950 },
    { id: "s3", capturedAt: T_NEW, externalId: "me", username: "kai", followerCount: 1000 },
  ]);
  const post = (id: string, format: string, age: number) => ({ id, externalId: `x-${id}`, permalink: `https://instagram.com/reel/${id}`, mediaType: "VIDEO", productType: "REELS", format, postedAt: daysAgo(age), firstSeenAt: daysAgo(age) });
  await db.insert(tables.ownPosts).values([post("alpha", "Reel", 2), post("beta", "Reel", 10), post("gamma", "Carousel", 20), post("old", "Reel", 45)]);
  await db.insert(tables.ownPostInsights).values([
    { id: "i1", ownPostId: "alpha", capturedAt: T_OLD, views: 600 },
    { id: "i2", ownPostId: "alpha", capturedAt: T_NEW, views: 1000, reach: 800, likes: 50 },
    { id: "i3", ownPostId: "beta", capturedAt: T_OLD, views: 500, reach: 400 },
    { id: "i4", ownPostId: "old", capturedAt: T_OLD, views: 9999 },
  ]);
  const now = daysAgo(0);
  await db.insert(tables.plannedPosts).values({ id: "plan-alpha", state: "published", title: "Alpha reel", keyword: "ALPHA", publishedOwnPostId: "alpha", createdAt: now, updatedAt: now });
  saveFunnel({ agent: "claude", rows: [
    { keyword: "ALPHA", source: "chatbotx", metric: "dms", value: 40, capturedAt: T_NEW },
    { keyword: "ALPHA", source: "umami", metric: "visits", value: 12, capturedAt: T_NEW },
    { keyword: "ALPHA", source: "polar", metric: "orders", value: 2, capturedAt: T_NEW },
  ] });
}

test("30 days sums the window's posts, names the posts without a number, and nets followers from the snapshot before the window", async () => {
  await seed();
  const board = await getOwnBoard(30);
  expect(board.username).toBe("kai");
  expect(board.followers).toEqual({ status: "value", value: 1000, capturedAt: T_NEW });
  expect(board.netFollowers).toEqual({ status: "value", value: 100, capturedAt: T_NEW });
  expect(board.totals.views).toEqual({ status: "value", value: 1500, capturedAt: T_OLD, postsWithoutNumber: 1 });
  expect(board.totals).not.toHaveProperty("reach");
  expect(board.totals.likes).toEqual({ status: "value", value: 50, capturedAt: T_NEW, postsWithoutNumber: 2 });
  expect(board.viewsByFormat).toEqual([
    { format: "Carousel", views: { status: "missing", postsWithoutNumber: 1 } },
    { format: "Reel", views: { status: "value", value: 1500, capturedAt: T_OLD, postsWithoutNumber: 0 } },
  ]);
  expect(board.after.dm).toEqual({ status: "value", value: 40, capturedAt: T_NEW, postsWithoutNumber: 2 });
  expect(board.posts.map((p) => p.ownPostId)).toEqual(["alpha", "beta", "gamma"]);
});

test("each post carries DM, Web and Đơn by its keyword, and a post with no keyword reads no-keyword, never 0", async () => {
  await seed();
  const [alpha, beta] = (await getOwnBoard(30)).posts;
  expect(alpha.keyword).toBe("ALPHA");
  expect(alpha.after).toEqual({
    dm: expect.objectContaining({ status: "value", value: 40, capturedAt: T_NEW }),
    gift_page_visit: expect.objectContaining({ status: "value", value: 12 }),
    purchase: expect.objectContaining({ status: "value", value: 2 }),
  });
  expect(alpha.ig.views).toEqual({ status: "value", value: 1000, capturedAt: T_NEW });
  expect(alpha.ig.skipRate).toEqual({ status: "missing" });
  expect(beta.after).toEqual({ dm: { status: "no-keyword" }, gift_page_visit: { status: "no-keyword" }, purchase: { status: "no-keyword" } });
});

test("7 days keeps only the last week's posts and nets from the snapshot 10 days ago", async () => {
  await seed();
  const board = await getOwnBoard(7);
  expect(board.posts.map((p) => p.ownPostId)).toEqual(["alpha"]);
  expect(board.totals.views).toMatchObject({ status: "value", value: 1000, postsWithoutNumber: 0 });
  expect(board.netFollowers).toMatchObject({ status: "value", value: 50 });
});

test("with no snapshot before the window, net followers is missing", async () => {
  await db.insert(tables.ownAccountSnapshots).values({ id: "s", capturedAt: T_NEW, externalId: "me", username: "kai", followerCount: 10 });
  const board = await getOwnBoard(30);
  expect(board.netFollowers).toEqual({ status: "missing" });
  expect(board.totals.views).toEqual({ status: "missing", postsWithoutNumber: 0 });
});

test("Sau reel walks the funnel for the reel's keyword: not-connected steps read chưa nối, never 0", async () => {
  await seed();
  const reel = await getOwnReelBoard("alpha");
  expect(reel.history).toEqual([{ capturedAt: T_OLD, views: 600 }, { capturedAt: T_NEW, views: 1000 }]);
  expect(reel.after?.keyword).toBe("ALPHA");
  expect(reel.after?.plan).toEqual({ id: "plan-alpha", title: "Alpha reel" });
  expect(reel.after?.steps.map((s) => [s.id, s.total.status === "value" ? s.total.value : s.total.status])).toEqual([
    ["view", 1000],
    ["comment_keyword", "not-connected"],
    ["dm", 40],
    ["gift_page_visit", 12],
    ["checkout", "not-connected"],
    ["purchase", 2],
  ]);
});

test("a reel with no keyword has no Sau reel funnel, and an unknown post is an error", async () => {
  await seed();
  expect((await getOwnReelBoard("beta")).after).toBeNull();
  await expect(getOwnReelBoard("nope")).rejects.toThrow("no own post nope");
});

test("a post whose newest pull failed after its last good one carries that failure; an older failure does not", async () => {
  await seed();
  await db.insert(tables.ownPostInsights).values([
    { id: "f1", ownPostId: "alpha", capturedAt: T_OLD, fetchError: "HTTP 500" },
    { id: "f2", ownPostId: "beta", capturedAt: T_NEW, fetchError: "HTTP 400: media gone" },
    { id: "f3", ownPostId: "gamma", capturedAt: T_NEW, fetchError: "HTTP 429" },
  ]);
  const byId = new Map((await getOwnBoard(30)).posts.map((p) => [p.ownPostId, p]));
  expect(byId.get("alpha")?.pullError).toBeNull();
  expect(byId.get("beta")?.pullError).toEqual({ error: "HTTP 400: media gone", at: T_NEW });
  expect(byId.get("beta")?.ig.views).toEqual({ status: "value", value: 500, capturedAt: T_OLD });
  expect(byId.get("gamma")?.pullError).toEqual({ error: "HTTP 429", at: T_NEW });
});
