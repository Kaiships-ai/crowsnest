import { beforeAll, expect, test } from "vitest";

import { db, newId, nowIso, tables } from "@/server/db";
import { getFunnel, saveFunnel } from "./funnel";

const T = "2026-10-01T08:00:00+07:00";

beforeAll(async () => {
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
});

test("returns the newest value per keyword, source and metric, joined to the plan case-insensitively", async () => {
  const id = newId();
  await db.insert(tables.plannedPosts).values({ id, state: "draft", title: "5 plugin Claude", keyword: "PLUGIN", createdAt: nowIso(), updatedAt: nowIso() });
  expect(saveFunnel({ agent: "claude", rows: [
    { keyword: "plugin", source: "chatbotx", metric: "dms", value: 10, capturedAt: "2026-10-01T08:00:00Z" },
    { keyword: "PLUGIN", source: "chatbotx", metric: "dms", value: 25, capturedAt: "2026-10-02T08:00:00Z" },
    { keyword: "PLUGIN", source: "polar", metric: "Orders", value: 3, capturedAt: "2026-10-02T08:00:00Z" },
  ] })).toEqual({ ok: true, saved: 3 });
  const plugin = getFunnel().filter((e) => e.keyword.toLowerCase() === "plugin");
  expect(plugin).toEqual([
    expect.objectContaining({ source: "chatbotx", metric: "dms", value: 25, plan: { id, title: "5 plugin Claude" } }),
    expect.objectContaining({ source: "polar", metric: "orders", value: 3, plan: { id, title: "5 plugin Claude" } }),
  ]);
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

test("a keyword no plan holds is stored and shown with no plan", () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "ORPHAN", source: "skool", metric: "members", value: 4, capturedAt: T }] });
  expect(getFunnel().find((e) => e.keyword === "ORPHAN")).toMatchObject({ value: 4, plan: null });
});

test("saving the same batch twice keeps the latest values", () => {
  const batch = { agent: "codex", rows: [{ keyword: "TWICE", source: "umami", metric: "visits", value: 7, capturedAt: "2026-10-03T08:00:00Z" }] };
  saveFunnel(batch);
  const first = getFunnel().filter((e) => e.keyword === "TWICE");
  saveFunnel(batch);
  expect(getFunnel().filter((e) => e.keyword === "TWICE")).toEqual(first);
});

test("a metric outside the source's registry is refused with the allowed list", () => {
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

test("the same capturedAt goes to the later insert", () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "TIE", source: "polar", metric: "orders", value: 1, capturedAt: T }] });
  saveFunnel({ agent: "claude", rows: [{ keyword: "tie", source: "polar", metric: "orders", value: 2, capturedAt: T }] });
  expect(getFunnel("TIE")).toEqual([expect.objectContaining({ keyword: "tie", value: 2 })]);
});

test("a keyword filter returns only that keyword in any case", () => {
  saveFunnel({ agent: "claude", rows: [
    { keyword: "ONE", source: "umami", metric: "emails", value: 1, capturedAt: T },
    { keyword: "TWO", source: "umami", metric: "emails", value: 2, capturedAt: T },
  ] });
  expect(getFunnel(" one ").map((e) => e.keyword)).toEqual(["ONE"]);
});
