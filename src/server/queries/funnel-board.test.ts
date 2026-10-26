import { beforeEach, expect, test } from "vitest";

import { db, newId, nowIso, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { saveFunnel } from "@/server/services/funnel";
import { getFunnelBoard, withPulls } from "./funnel-board";

const T = "2026-10-01T08:00:00.000Z";
const T2 = "2026-10-02T08:00:00.000Z";

beforeEach(async () => {
  migrate();
  for (const t of [tables.reelFunnel, tables.plannedPosts, tables.ownPostInsights, tables.ownPosts]) await db.delete(t);
});

async function seed(): Promise<void> {
  const now = nowIso();
  await db.insert(tables.ownPosts).values({ id: "op-alpha", externalId: "x-alpha", permalink: "https://instagram.com/reel/a", mediaType: "VIDEO", format: "Reel", postedAt: now, firstSeenAt: now });
  await db.insert(tables.ownPostInsights).values({ id: newId(), ownPostId: "op-alpha", capturedAt: T, views: 1000 });
  await db.insert(tables.plannedPosts).values([
    { id: "plan-alpha", state: "published", title: "Alpha reel", keyword: "ALPHA", publishedOwnPostId: "op-alpha", createdAt: now, updatedAt: now },
    { id: "plan-beta", state: "draft", title: "Beta reel", keyword: "BETA", createdAt: now, updatedAt: now },
  ]);
  saveFunnel({ agent: "claude", rows: [
    { keyword: "ALPHA", source: "chatbotx", metric: "dms", value: 50, capturedAt: T2 },
    { keyword: "ALPHA", source: "umami", metric: "visits", value: 20, capturedAt: T2 },
    { keyword: "ALPHA", source: "polar", metric: "orders", value: 2, capturedAt: T2 },
    { keyword: "BETA", source: "chatbotx", metric: "dms", value: 30, capturedAt: T },
    { keyword: "BETA", source: "umami", metric: "visits", value: 10, capturedAt: T },
    { keyword: "GAMMA", source: "umami", metric: "visits", value: 5, capturedAt: T2 },
    { keyword: "GAMMA", source: "polar", metric: "orders", value: 1, capturedAt: T2 },
  ] });
}

test("each step sums its keywords, takes the oldest time, and counts the keywords with no number", async () => {
  await seed();
  const { steps } = await getFunnelBoard();
  expect(steps.map((s) => [s.id, s.source, s.total])).toEqual([
    ["view", "instagram", { status: "value", value: 1000, capturedAt: T, keywordsWithoutNumber: 2 }],
    ["comment_keyword", "chatbotx", { status: "not-connected", connector: "chatbotx", keywordsWithoutNumber: 0 }],
    ["dm", "chatbotx", { status: "value", value: 80, capturedAt: T, keywordsWithoutNumber: 1 }],
    ["gift_page_visit", "umami", { status: "value", value: 35, capturedAt: T, keywordsWithoutNumber: 0 }],
    ["checkout", "polar", { status: "not-connected", connector: "polar", keywordsWithoutNumber: 0 }],
    ["purchase", "polar", { status: "value", value: 3, capturedAt: T2, keywordsWithoutNumber: 1 }],
  ]);
});

test("the rate to each step comes from the ledger, and a step next to a not-connected one reads not-connected", async () => {
  await seed();
  const { steps } = await getFunnelBoard();
  expect(steps.map((s) => s.rate && [s.rate.id, s.rate.reading.status, "value" in s.rate.reading ? s.rate.reading.value : s.rate.reading.status === "not-connected" ? s.rate.reading.connector : null])).toEqual([
    null,
    ["comment_rate", "not-connected", "chatbotx"],
    ["dm_rate", "not-connected", "chatbotx"],
    ["visit_rate", "value", 0.4375],
    ["checkout_rate", "not-connected", "polar"],
    ["purchase_rate", "not-connected", "polar"],
  ]);
  expect(steps.flatMap((s) => (s.rate ? [s.rate.target] : []))).toEqual([null, null, null, null, null]);
});

test("coverage counts the visits and orders under a keyword a planned reel holds", async () => {
  await seed();
  const board = await getFunnelBoard();
  expect(board.coverage).toEqual({ visits: { status: "value", tied: 30, total: 35 }, orders: { status: "value", tied: 2, total: 3 } });
  expect(board.keywords.map((k) => [k.keyword, k.plan?.id ?? null, k.steps.map((r) => (r.status === "value" ? r.value : r.status))])).toEqual([
    ["ALPHA", "plan-alpha", [1000, "not-connected", 50, 20, "not-connected", 2]],
    ["BETA", "plan-beta", ["missing", "not-connected", 30, 10, "not-connected", "missing"]],
    ["GAMMA", null, ["missing", "not-connected", "missing", 5, "not-connected", 1]],
  ]);
});

test("with no funnel rows a connected step is missing and a not-connected one says so, never 0", async () => {
  const board = await getFunnelBoard();
  expect(board.steps.map((s) => s.total.status)).toEqual(["missing", "not-connected", "missing", "missing", "not-connected", "missing"]);
  expect(board.steps.some((s) => "value" in s.total)).toBe(false);
  expect(board.coverage).toEqual({ visits: { status: "missing" }, orders: { status: "missing" } });
});

test("a step whose source's newest pull failed or was partial says so beside its number", async () => {
  await seed();
  const { steps } = await getFunnelBoard();
  const marked = withPulls(steps, [
    { id: "instagram-graph", state: "error" },
    { id: "umami", state: "partial" },
    { id: "chatbotx", state: "running" },
  ]);
  expect(marked.map((s) => [s.id, s.pull])).toEqual([
    ["view", "failed"],
    ["comment_keyword", null],
    ["dm", null],
    ["gift_page_visit", "partial"],
    ["checkout", null],
    ["purchase", null],
  ]);
});
