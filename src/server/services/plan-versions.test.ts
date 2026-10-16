import { beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { db, newId, nowIso, tables } from "@/server/db";
import { approvePlanVersion, listPlanVersions, proposePlan, undoPlanVersion, type Reel } from "./plan-versions";

beforeAll(async () => {
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
});

const reels = (prefix: string, n: number): Reel[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}-${i}`, title: `Reel ${i}`, date: `2026-10-${String(26 + (i % 6)).padStart(2, "0")}`, keyword: `${prefix.toUpperCase()}${i}` }));

async function drafts(periodKey: string) {
  const rows = await db
    .select({ title: tables.plannedPosts.title, date: tables.plannedPosts.plannedDate, keyword: tables.plannedPosts.keyword, state: tables.plannedPosts.state, key: tables.plannedPosts.planReelKey })
    .from(tables.plannedPosts)
    .innerJoin(tables.planVersions, eq(tables.planVersions.id, tables.plannedPosts.planVersionId))
    .where(eq(tables.planVersions.periodKey, periodKey));
  return rows.sort((a, b) => a.key!.localeCompare(b.key!));
}

function propose(periodKey: string, list: Reel[], period: "week" | "month" = "week") {
  const r = proposePlan({ period, periodKey, agent: "claude", reels: list });
  if (!r.ok) throw new Error(r.error);
  return r;
}

test("propose stores the next version as proposed and month keys apart from weeks", () => {
  const v1 = propose("2026-W40", reels("a", 2));
  const v2 = propose("2026-W40", reels("a", 3));
  const m = propose("2026-10", reels("m", 1), "month");
  expect([v1.version, v2.version, m.version]).toEqual([1, 2, 1]);
  const list = listPlanVersions({ period: "week", periodKey: "2026-W40" });
  expect(list.ok && list.versions.map((v) => [v.version, v.status])).toEqual([[1, "proposed"], [2, "proposed"]]);
});

test("an invalid reel list is refused and stores nothing", async () => {
  const before = (await db.select().from(tables.planVersions)).length;
  for (const bad of [
    { period: "week", periodKey: "2026-W41", agent: "claude", reels: [{ key: "x", title: "" }] },
    { period: "week", periodKey: "2026-W41", agent: "claude", reels: [{ key: "x", title: "A" }, { key: "x", title: "B" }] },
    { period: "week", periodKey: "2026-10", agent: "claude", reels: [{ key: "x", title: "A" }] },
    { period: "week", periodKey: "2026-W41", agent: "claude", reels: [{ key: "x", title: "A", time: "25:00" }] },
  ]) {
    expect(proposePlan(bad)).toMatchObject({ ok: false, code: "INVALID_PLAN" });
  }
  expect((await db.select().from(tables.planVersions)).length).toBe(before);
});

test("approve creates drafts, a second approve changes nothing, v2 updates only its changed reel, undo restores v1", async () => {
  const v1reels = reels("w", 3);
  const v1 = propose("2026-W44", v1reels);
  expect(approvePlanVersion(v1.id)).toMatchObject({ ok: true, changed: true, created: 3, updated: 0, removed: 0, kept: [] });
  const afterV1 = await drafts("2026-W44");
  expect(afterV1.map((d) => [d.title, d.keyword, d.state])).toEqual([["Reel 0", "W0", "draft"], ["Reel 1", "W1", "draft"], ["Reel 2", "W2", "draft"]]);
  expect(approvePlanVersion(v1.id)).toMatchObject({ ok: true, changed: false, created: 0 });
  expect(await drafts("2026-W44")).toEqual(afterV1);

  const v2 = propose("2026-W44", [v1reels[0], { ...v1reels[1], title: "Reel 1 new hook" }, { key: "w-9", title: "Brand new" }]);
  const list = listPlanVersions({ period: "week", periodKey: "2026-W44" });
  expect(list.ok && list.versions[1].diff).toBe("vs v1: added Brand new. removed Reel 2. changed Reel 1 new hook (title)");

  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, changed: true, created: 1, updated: 2, removed: 1 });
  const listed = listPlanVersions({ period: "week", periodKey: "2026-W44" });
  expect(listed.ok && listed.versions.map((v) => v.status)).toEqual(["superseded", "live"]);

  expect(undoPlanVersion({ period: "week", periodKey: "2026-W44" })).toMatchObject({ ok: true, live: { id: v1.id, version: 1 }, kept: [] });
  expect(await drafts("2026-W44")).toEqual(afterV1);
  const back = listPlanVersions({ period: "week", periodKey: "2026-W44" });
  expect(back.ok && back.versions.map((v) => v.status)).toEqual(["live", "proposed"]);
});

test("undo keeps a draft that was scheduled meanwhile and reports it", async () => {
  const v1 = propose("2026-W45", reels("s", 2));
  approvePlanVersion(v1.id);
  const v2 = propose("2026-W45", [...reels("s", 2), { key: "s-new", title: "Scheduled one", date: "2026-11-05" }]);
  approvePlanVersion(v2.id);
  const [scheduled] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.planReelKey, "s-new"));
  await db.update(tables.plannedPosts).set({ state: "scheduled", scheduledAt: "2026-11-05T09:00:00.000Z" }).where(eq(tables.plannedPosts.id, scheduled.id));

  const r = undoPlanVersion({ period: "week", periodKey: "2026-W45" });
  expect(r).toMatchObject({ ok: true, live: { version: 1 }, removed: 0, kept: [{ id: scheduled.id, title: "Scheduled one", state: "scheduled" }] });
  expect((await drafts("2026-W45")).map((d) => [d.key, d.state])).toEqual([["s-0", "draft"], ["s-1", "draft"], ["s-new", "scheduled"]]);
});

test("a reel keyword another plan holds fails the approve with nothing changed", async () => {
  await db.insert(tables.plannedPosts).values({ id: newId(), state: "draft", title: "Manual", keyword: "TAKEN", createdAt: nowIso(), updatedAt: nowIso() });
  const v = propose("2026-W46", [{ key: "t", title: "Clash", keyword: "taken" }]);
  expect(approvePlanVersion(v.id)).toMatchObject({ ok: false, code: "KEYWORD_TAKEN" });
  const list = listPlanVersions({ period: "week", periodKey: "2026-W46" });
  expect(list.ok && list.versions[0].status).toBe("proposed");
  expect(await drafts("2026-W46")).toEqual([]);
});

test("undo of the only live version removes its drafts", async () => {
  const v = propose("2026-W47", reels("o", 2));
  approvePlanVersion(v.id);
  expect(undoPlanVersion({ period: "week", periodKey: "2026-W47" })).toMatchObject({ ok: true, live: null, removed: 2 });
  expect(await drafts("2026-W47")).toEqual([]);
  expect(undoPlanVersion({ period: "week", periodKey: "2026-W47" })).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
});

test("approving a 14-reel week takes under 150 ms at the median", () => {
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const v = propose(`2025-W${String(10 + i).padStart(2, "0")}`, reels(`p${i}`, 14));
    const t = performance.now();
    approvePlanVersion(v.id);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  expect(times[5]).toBeLessThan(150);
});
