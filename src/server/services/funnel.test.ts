import { beforeAll, expect, test } from "vitest";

import { db, newId, nowIso, tables } from "@/server/db";
import { getFunnel, saveFunnel } from "./funnel";

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
    { keyword: "PLUGIN", source: "polar", metric: "orders", value: 3, capturedAt: "2026-10-02T08:00:00Z" },
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
    { keyword: "ATOMIC", source: "umami", metric: "views", value: 1 },
    { keyword: "ATOMIC", source: "tiktok", metric: "views", value: 2 },
  ] });
  expect(r.ok).toBe(false);
  expect((await db.select().from(tables.reelFunnel)).length).toBe(before);
});

test("a keyword no plan holds is stored and shown with no plan", () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "ORPHAN", source: "skool", metric: "joins", value: 4 }] });
  expect(getFunnel().find((e) => e.keyword === "ORPHAN")).toMatchObject({ value: 4, plan: null });
});

test("saving the same batch twice keeps the latest values", () => {
  const batch = { agent: "codex", rows: [{ keyword: "TWICE", source: "umami", metric: "clicks", value: 7, capturedAt: "2026-10-03T08:00:00Z" }] };
  saveFunnel(batch);
  const first = getFunnel().filter((e) => e.keyword === "TWICE");
  saveFunnel(batch);
  expect(getFunnel().filter((e) => e.keyword === "TWICE")).toEqual(first);
});
