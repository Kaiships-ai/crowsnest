import { beforeAll, expect, test } from "vitest";

import { db, newId, nowIso, tables } from "@/server/db";
import { getFunnel, saveFunnel, type FunnelEntry } from "./funnel";

const T = "2026-10-01T08:00:00+07:00";

beforeAll(async () => {
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
});

const metric = (entry: FunnelEntry | undefined, id: string) => entry?.metrics.find((m) => m.id === id);

test("returns the newest value per keyword, source and metric, joined to the plan case-insensitively", async () => {
  const id = newId();
  await db.insert(tables.plannedPosts).values({ id, state: "draft", title: "5 plugin Claude", keyword: "PLUGIN", createdAt: nowIso(), updatedAt: nowIso() });
  expect(saveFunnel({ agent: "claude", rows: [
    { keyword: "plugin", source: "chatbotx", metric: "dms", value: 10, capturedAt: "2026-10-01T08:00:00Z" },
    { keyword: "PLUGIN", source: "chatbotx", metric: "dms", value: 25, capturedAt: "2026-10-02T08:00:00Z" },
    { keyword: "PLUGIN", source: "polar", metric: "Orders", value: 3, capturedAt: "2026-10-02T08:00:00Z" },
  ] })).toEqual({ ok: true, saved: 3 });
  const [plugin] = await getFunnel("plugin");
  expect(plugin).toMatchObject({ keyword: "PLUGIN", plan: { id, title: "5 plugin Claude" } });
  expect(metric(plugin, "dm")).toEqual({ id: "dm", label: "DMs", window: "reel-lifetime", target: null, status: "value", value: 25, capturedAt: "2026-10-02T08:00:00.000Z" });
  expect(metric(plugin, "purchase")).toMatchObject({ status: "value", value: 3 });
  expect(metric(plugin, "gift_page_visit")).toMatchObject({ status: "missing" });
});

test("views, follows and link taps come from the plan's published reel, and rates divide them", async () => {
  const now = nowIso();
  await db.insert(tables.ownPosts).values({ id: "op-funnel", externalId: "x-funnel", permalink: "https://instagram.com/reel/x", mediaType: "VIDEO", format: "Reel", postedAt: now, firstSeenAt: now });
  await db.insert(tables.ownPostInsights).values([
    { id: newId(), ownPostId: "op-funnel", capturedAt: "2026-10-02T00:00:00.000Z", views: 1000, followsFromPost: 20, bioLinkTaps: 5 },
    { id: newId(), ownPostId: "op-funnel", capturedAt: "2026-10-03T00:00:00.000Z", fetchError: "boom" },
  ]);
  await db.insert(tables.plannedPosts).values({ id: newId(), state: "published", title: "Reel", keyword: "REELKW", publishedOwnPostId: "op-funnel", createdAt: now, updatedAt: now });
  saveFunnel({ agent: "claude", rows: [{ keyword: "reelkw", source: "chatbotx", metric: "dms", value: 40, capturedAt: "2026-10-01T00:00:00Z" }] });

  const [reel] = await getFunnel("REELKW");
  expect(metric(reel, "view")).toMatchObject({ status: "value", value: 1000, capturedAt: "2026-10-02T00:00:00.000Z" });
  expect(metric(reel, "follow_rate")).toMatchObject({ status: "value", value: 0.02, capturedAt: "2026-10-02T00:00:00.000Z" });
  expect(metric(reel, "bio_link_tap_rate")).toMatchObject({ status: "value", value: 0.005 });
});

test("a metric whose source is not connected reads not-connected, never 0", async () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "NC", source: "umami", metric: "visits", value: 12, capturedAt: T }] });
  const [nc] = await getFunnel("NC");
  expect(metric(nc, "checkout")).toEqual({ id: "checkout", label: "Checkouts", window: "reel-lifetime", target: null, status: "not-connected", connector: "polar" });
  expect(metric(nc, "comment_keyword")).toMatchObject({ status: "not-connected", connector: "chatbotx" });
  expect(metric(nc, "checkout_rate")).toMatchObject({ status: "not-connected", connector: "polar" });
  expect(nc.metrics.filter((m) => m.status === "not-connected").some((m) => "value" in m)).toBe(false);
});

test("one bad row refuses the whole batch and writes nothing", async () => {
  const before = (await db.select().from(tables.reelFunnel)).length;
  const r = saveFunnel({ agent: "claude", rows: [
    { keyword: "ATOMIC", source: "umami", metric: "visits", value: 1, capturedAt: T },
    { keyword: "ATOMIC", source: "tiktok", metric: "visits", value: 2, capturedAt: T },
  ] });
  expect(r.ok).toBe(false);
  for (const bad of [{ value: -1 }, { value: 1, capturedAt: "2099-01-01T00:00:00Z" }]) {
    expect(saveFunnel({ agent: "claude", rows: [{ keyword: "ATOMIC", source: "umami", metric: "visits", capturedAt: T, ...bad }] }).ok).toBe(false);
  }
  expect((await db.select().from(tables.reelFunnel)).length).toBe(before);
});

test("a keyword no plan holds is stored and shown with no plan", async () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "ORPHAN", source: "skool", metric: "members", value: 4, capturedAt: T }] });
  const [orphan] = await getFunnel("ORPHAN");
  expect(orphan).toMatchObject({ keyword: "ORPHAN", plan: null });
  expect(metric(orphan, "skool_member")).toMatchObject({ status: "value", value: 4 });
});

test("saving the same batch twice keeps the latest values", async () => {
  const batch = { agent: "codex", rows: [{ keyword: "TWICE", source: "umami", metric: "visits", value: 7, capturedAt: "2026-10-03T08:00:00Z" }] };
  saveFunnel(batch);
  const first = await getFunnel("TWICE");
  saveFunnel(batch);
  expect(await getFunnel("TWICE")).toEqual(first);
});

test("a metric outside the ledger is refused with the allowed list", () => {
  const r = saveFunnel({ agent: "claude", rows: [{ keyword: "REG", source: "chatbotx", metric: "dm", value: 1, capturedAt: T }] });
  expect(r).toMatchObject({ ok: false });
  expect(!r.ok && r.error).toContain("dms");
  expect(!r.ok && r.error).toContain("rows[0].metric");
});

test("capturedAt is required", () => {
  expect(saveFunnel({ agent: "claude", rows: [{ keyword: "REQ", source: "skool", metric: "members", value: 1 }] }).ok).toBe(false);
});

test("a non-date capturedAt gets one message, not a future warning", () => {
  const r = saveFunnel({ agent: "claude", rows: [{ keyword: "REQ", source: "skool", metric: "members", value: 1, capturedAt: "yesterday" }] });
  expect(!r.ok && r.error).not.toContain("future");
});

test("the same capturedAt goes to the later insert", async () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "TIE", source: "polar", metric: "orders", value: 1, capturedAt: T }] });
  saveFunnel({ agent: "claude", rows: [{ keyword: "tie", source: "polar", metric: "orders", value: 2, capturedAt: T }] });
  const entries = await getFunnel("TIE");
  expect(entries.map((e) => e.keyword)).toEqual(["tie"]);
  expect(metric(entries[0], "purchase")).toMatchObject({ value: 2 });
});

test("a keyword filter returns only that keyword in any case", async () => {
  saveFunnel({ agent: "claude", rows: [
    { keyword: "ONE", source: "umami", metric: "emails", value: 1, capturedAt: T },
    { keyword: "TWO", source: "umami", metric: "emails", value: 2, capturedAt: T },
  ] });
  expect((await getFunnel(" one ")).map((e) => e.keyword)).toEqual(["ONE"]);
});
