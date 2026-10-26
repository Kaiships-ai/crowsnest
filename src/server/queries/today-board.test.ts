import { beforeEach, expect, test } from "vitest";

import type { Connector } from "@/server/connectors/types";
import { db, newId, nowIso, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { runDailyPull } from "@/server/services/daily-pull";
import { saveFunnel } from "@/server/services/funnel";
import type { FunnelStep } from "./funnel-board";
import { biggestDrop, getTodayBoard } from "./today-board";

const at = (day: number, h: number) => new Date(2026, 9, day, h);

function fake(id: string, pull: NonNullable<Connector["adapter"]>["pull"]): Connector {
  return { manifest: { id, label: id, auth: "api-key", secrets: [], feeds: [] }, adapter: { testConnection: async () => ({ ok: true, message: null }), pull } };
}

beforeEach(async () => {
  migrate();
  for (const t of [tables.reelFunnel, tables.planVersions, tables.gateDrafts, tables.dailyPulls]) await db.delete(t);
});

function version(period: "week" | "month", periodKey: string, v: number, status: "proposed" | "live" | "superseded") {
  const now = nowIso();
  return { id: `${periodKey}-v${v}`, period, periodKey, version: v, status, reels: [], agent: "claude", createdAt: now, updatedAt: now };
}

test("gates count proposed plans newer than their live version and pending drafts", async () => {
  await db.insert(tables.planVersions).values([
    version("week", "2026-W44", 1, "live"),
    version("week", "2026-W44", 2, "proposed"),
    version("month", "2026-10", 1, "proposed"),
    version("month", "2026-10", 2, "live"),
    version("month", "2026-11", 1, "proposed"),
  ]);
  const now = nowIso();
  await db.insert(tables.gateDrafts).values([
    { id: "d1", tool: "x", rawInput: {}, caller: "claude", createdAt: now },
    { id: "d2", tool: "x", rawInput: {}, caller: "claude", createdAt: now },
  ]);
  const board = await getTodayBoard(at(27, 9), []);
  expect(board.gates).toEqual({ proposedPlansAhead: 2, pendingDrafts: 2 });
});

test("a partial or failed pull shows as such, never as running", async () => {
  const registry = [
    fake("ok", async () => ({ kind: "complete", rows: null })),
    fake("cut", async () => ({ kind: "partial", rows: null, missing: "page 2", reason: "rate limited" })),
    fake("down", async () => ({ kind: "failed", reason: "sidecar down" })),
  ];
  await runDailyPull(at(27, 5), registry);
  const { pulls } = await getTodayBoard(at(27, 9), registry);
  expect(pulls.map((p) => [p.id, p.state, p.lastPull?.outcome])).toEqual([
    ["ok", "running", "complete"],
    ["cut", "partial", "partial"],
    ["down", "error", "failed"],
  ]);
});

test("the offer is checkout from Umami then purchase, and with no targets the drop says so", async () => {
  saveFunnel({ agent: "claude", rows: [{ keyword: "ALPHA", source: "polar", metric: "orders", value: 4, capturedAt: "2026-10-02T08:00:00Z" }] });
  const capturedAt = "2026-10-02T08:00:00.000Z";
  await db.insert(tables.reelFunnel).values({ id: newId(), keyword: "ALPHA", source: "umami", metric: "checkouts", value: 6, capturedAt, agent: "umami", createdAt: capturedAt });
  const board = await getTodayBoard(at(27, 9), []);
  expect(board.offer.map((s) => [s.id, s.total.status, "value" in s.total ? s.total.value : null])).toEqual([
    ["checkout", "value", 6],
    ["purchase", "value", 4],
  ]);
  expect(board.drop).toEqual({ status: "no-target" });
});

const step = (id: FunnelStep["id"], target: number | null, value: number | null): FunnelStep => ({
  id,
  label: id,
  source: "umami",
  total: { status: "missing", keywordsWithoutNumber: 0 },
  rate: { id: "visit_rate", label: `${id} rate`, target, reading: value === null ? { status: "missing" } : { status: "value", value, capturedAt: "2026-10-02T08:00:00.000Z" } },
});

test("the biggest drop is the rate furthest below its target", () => {
  expect(biggestDrop([step("dm", 0.5, 0.4), step("gift_page_visit", 0.2, 0.05), step("purchase", null, 0.01)])).toEqual({
    status: "value", step: "gift_page_visit", label: "gift_page_visit rate", rate: 0.05, target: 0.2, capturedAt: "2026-10-02T08:00:00.000Z",
  });
  expect(biggestDrop([step("dm", 0.5, null)])).toEqual({ status: "missing" });
});
