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
  expect(list.ok && list.versions.map((v) => [v.version, v.status])).toEqual([[2, "proposed"], [1, "proposed"]]);
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
  expect(list.ok && list.versions[0].diff).toBe("vs v1: added Brand new. removed Reel 2. changed Reel 1 new hook (title)");

  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, changed: true, created: 1, updated: 2, removed: 1 });
  const listed = listPlanVersions({ period: "week", periodKey: "2026-W44" });
  expect(listed.ok && listed.versions.map((v) => v.status)).toEqual(["live", "superseded"]);

  expect(undoPlanVersion({ period: "week", periodKey: "2026-W44" })).toMatchObject({ ok: true, live: { id: v1.id, version: 1 }, kept: [] });
  expect(await drafts("2026-W44")).toEqual(afterV1);
  const back = listPlanVersions({ period: "week", periodKey: "2026-W44" });
  expect(back.ok && back.versions.map((v) => v.status)).toEqual(["proposed", "live"]);
});

test("undo keeps a draft that was scheduled meanwhile and reports it", async () => {
  const v1 = propose("2026-W45", reels("s", 2));
  approvePlanVersion(v1.id);
  const v2 = propose("2026-W45", [...reels("s", 2), { key: "s-new", title: "Scheduled one", date: "2026-11-05" }]);
  approvePlanVersion(v2.id);
  const [scheduled] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.planReelKey, "s-new"));
  await db.update(tables.plannedPosts).set({ state: "scheduled", scheduledAt: "2026-11-05T09:00:00.000Z" }).where(eq(tables.plannedPosts.id, scheduled.id));

  const r = undoPlanVersion({ period: "week", periodKey: "2026-W45" });
  expect(r).toMatchObject({ ok: true, live: { version: 1 }, removed: 0, kept: [{ id: scheduled.id, title: "Scheduled one", state: "scheduled", reelKey: "s-new", reason: "not_draft", notApplied: ["removed"] }] });
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

test("undo of the only live version refuses and keeps its drafts", async () => {
  const v = propose("2026-W47", reels("o", 2));
  approvePlanVersion(v.id);
  expect(undoPlanVersion({ period: "week", periodKey: "2026-W47" })).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  expect((await drafts("2026-W47")).length).toBe(2);
  const list = listPlanVersions({ period: "week", periodKey: "2026-W47" });
  expect(list.ok && list.versions[0].status).toBe("live");
});

const P = tables.plannedPosts;
const postByKey = async (key: string) => (await db.select().from(P).where(eq(P.planReelKey, key)))[0];

test("attachments survive a remove-then-undo", async () => {
  const v1 = propose("2026-W48", reels("x", 2));
  approvePlanVersion(v1.id);
  const asset = newId();
  await db.insert(tables.mediaAssets).values({ id: asset, sha256: asset, kind: "video", contentType: "video/mp4", byteSize: 1, storagePath: `v/${asset}.mp4`, downloadedAt: nowIso() });
  await db.update(P).set({ videoAssetId: asset, caption: "cap", magnetUrl: "https://example.com/g" }).where(eq(P.planReelKey, "x-0"));
  const before = await postByKey("x-0");

  const v2 = propose("2026-W48", [reels("x", 2)[1]]);
  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, removed: 0, kept: [{ id: before.id, reelKey: "x-0", reason: "has_video", notApplied: ["removed"] }] });
  expect(await postByKey("x-0")).toEqual(before);
  expect(undoPlanVersion({ period: "week", periodKey: "2026-W48" })).toMatchObject({ ok: true, live: { version: 1 }, created: 0, kept: [{ reelKey: "x-0", reason: "has_video", notApplied: [] }] });
  expect(await postByKey("x-0")).toEqual(before);
});

test("a hand-edited draft is kept with the fields not applied, and a draft scheduled then back to draft follows the same rule", async () => {
  const v1 = propose("2026-W49", reels("e", 3));
  approvePlanVersion(v1.id);
  await db.update(P).set({ note: "my edit" }).where(eq(P.planReelKey, "e-0"));
  await db.update(P).set({ state: "scheduled", scheduledAt: "2026-12-01T09:00:00.000Z" }).where(eq(P.planReelKey, "e-1"));
  await db.update(P).set({ state: "draft", scheduledAt: null }).where(eq(P.planReelKey, "e-1"));
  const edited = await postByKey("e-0");

  const v2 = propose("2026-W49", reels("e", 3).map((r) => ({ ...r, title: `${r.title} v2`, date: "2026-12-04" })));
  const r = approvePlanVersion(v2.id);
  expect(r).toMatchObject({ ok: true, updated: 2, kept: [{ id: edited.id, reelKey: "e-0", reason: "edited", notApplied: ["title", "date"] }] });
  expect(await postByKey("e-0")).toEqual(edited);
  expect((await postByKey("e-1")).title).toBe("Reel 1 v2");
});

test("double undo goes one further back, then refuses", async () => {
  const ref = { period: "week", periodKey: "2026-W50" } as const;
  const ids = [1, 2, 3].map((n) => propose("2026-W50", [{ key: "d", title: `T${n}` }]).id);
  for (const id of ids) approvePlanVersion(id);
  expect(undoPlanVersion(ref)).toMatchObject({ ok: true, live: { version: 2 } });
  expect(undoPlanVersion(ref)).toMatchObject({ ok: true, live: { version: 1 } });
  expect((await postByKey("d")).title).toBe("T1");
  expect(undoPlanVersion(ref)).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  expect((await postByKey("d")).title).toBe("T1");
});

test("approving an older superseded version brings its reels back", async () => {
  const v1 = propose("2026-W51", [{ key: "o1", title: "Old" }]);
  const v2 = propose("2026-W51", [{ key: "o2", title: "New" }]);
  approvePlanVersion(v1.id);
  approvePlanVersion(v2.id);
  expect(approvePlanVersion(v1.id)).toMatchObject({ ok: true, changed: true, created: 1, removed: 1 });
  expect((await drafts("2026-W51")).map((d) => d.title)).toEqual(["Old"]);
  const list = listPlanVersions({ period: "week", periodKey: "2026-W51" });
  expect(list.ok && list.versions.map((v) => [v.version, v.status])).toEqual([[2, "superseded"], [1, "live"]]);
});

test("two reels can swap keywords", async () => {
  const v1 = propose("2026-W52", [{ key: "k1", title: "A", keyword: "SWAPA" }, { key: "k2", title: "B", keyword: "SWAPB" }]);
  approvePlanVersion(v1.id);
  const v2 = propose("2026-W52", [{ key: "k1", title: "A", keyword: "SWAPB" }, { key: "k2", title: "B", keyword: "SWAPA" }]);
  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, updated: 2 });
  expect((await drafts("2026-W52")).map((d) => d.keyword)).toEqual(["SWAPB", "SWAPA"]);
});

test("a month and a week of the same dates are approved together without touching each other", async () => {
  const m = propose("2026-12", [{ key: "mw", title: "Month reel", date: "2026-12-29", keyword: "MWM" }], "month");
  const w = propose("2026-W53", [{ key: "mw", title: "Week reel", date: "2026-12-29", keyword: "MWW" }]);
  expect(approvePlanVersion(m.id)).toMatchObject({ ok: true, created: 1 });
  expect(approvePlanVersion(w.id)).toMatchObject({ ok: true, created: 1, removed: 0 });
  expect((await drafts("2026-12")).map((d) => d.title)).toEqual(["Month reel"]);
  expect((await drafts("2026-W53")).map((d) => d.title)).toEqual(["Week reel"]);
});

test("W53 is refused for an ISO year with 52 weeks", () => {
  expect(proposePlan({ period: "week", periodKey: "2027-W53", agent: "claude", reels: [{ key: "a", title: "A" }] })).toMatchObject({ ok: false, code: "INVALID_PLAN" });
  expect(proposePlan({ period: "week", periodKey: "2026-W53", agent: "claude", reels: [{ key: "a", title: "A" }] })).toMatchObject({ ok: true });
});

test("plan_versions caps names per diff at 3 and returns the newest versions up to limit", () => {
  propose("2025-W01", reels("c", 1));
  propose("2025-W01", reels("c", 6));
  for (let i = 0; i < 5; i++) propose("2025-W01", reels("c", 6));
  const all = listPlanVersions({ period: "week", periodKey: "2025-W01" });
  expect(all.ok && all.versions.map((v) => v.version)).toEqual([7, 6, 5, 4, 3]);
  const two = listPlanVersions({ period: "week", periodKey: "2025-W01", limit: 7 });
  expect(two.ok && two.versions[5].diff).toBe("vs v1: added Reel 1; Reel 2; Reel 3 +2 more");
});

test("a unique violation other than the keyword index is not KEYWORD_TAKEN", () => {
  const v = propose("2025-W02", [{ key: "u", title: "U" }]);
  const sqlite = (db as unknown as { $client: { exec: (s: string) => void } }).$client;
  sqlite.exec("CREATE UNIQUE INDEX test_title_once ON planned_posts (title) WHERE title = 'U'");
  try {
    db.insert(P).values({ id: newId(), state: "draft", title: "U", createdAt: nowIso(), updatedAt: nowIso() }).run();
    expect(approvePlanVersion(v.id)).toMatchObject({ ok: false, code: "PLAN_CONFLICT" });
  } finally {
    sqlite.exec("DROP INDEX test_title_once");
  }
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

test("a draft with a target length, video kind, or remix session is kept as has_settings", async () => {
  const v1 = propose("2025-W20", reels("g", 3));
  approvePlanVersion(v1.id);
  await db.update(P).set({ videoKind: "talking_head" }).where(eq(P.planReelKey, "g-0"));
  await db.update(P).set({ targetLengthSec: 30 }).where(eq(P.planReelKey, "g-1"));
  const v2 = propose("2025-W20", [reels("g", 3)[2]]);
  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, removed: 0, kept: [{ reelKey: "g-0", reason: "has_settings" }, { reelKey: "g-1", reason: "has_settings" }] });
});

test("a plan-linked draft with no planSynced is kept as edited with every reel field not applied", async () => {
  const v1 = propose("2025-W21", [{ key: "n", title: "N" }]);
  approvePlanVersion(v1.id);
  await db.update(P).set({ planSynced: null }).where(eq(P.planReelKey, "n"));
  const v2 = propose("2025-W21", [{ key: "n", title: "N2" }]);
  expect(approvePlanVersion(v2.id)).toMatchObject({ ok: true, kept: [{ reelKey: "n", reason: "edited", notApplied: ["title", "date", "time", "keyword", "note"] }] });
});

test("plan_versions always includes the asked version, refuses an unknown one, and clamps limit", () => {
  for (let i = 0; i < 7; i++) propose("2025-W22", reels("v", 1));
  const ref = { period: "week", periodKey: "2025-W22" } as const;
  const one = listPlanVersions({ ...ref, version: 1 });
  expect(one.ok && one.versions.map((v) => [v.version, !!v.reels])).toEqual([[7, false], [6, false], [5, false], [4, false], [3, false], [1, true]]);
  expect(listPlanVersions({ ...ref, version: 9 })).toMatchObject({ ok: false, code: "INVALID_PLAN" });
  const low = listPlanVersions({ ...ref, limit: 0 });
  expect(low.ok && low.versions.map((v) => v.version)).toEqual([7]);
  const high = listPlanVersions({ ...ref, limit: 500 });
  expect(high.ok && high.versions.length).toBe(7);
});

test("a keyword a kept draft holds names that post and reel key", async () => {
  const v1 = propose("2025-W23", [{ key: "h1", title: "Holder", keyword: "HELD" }]);
  approvePlanVersion(v1.id);
  const holder = await postByKey("h1");
  await db.update(P).set({ caption: "mine" }).where(eq(P.id, holder.id));
  const v2 = propose("2025-W23", [{ key: "h1", title: "Holder", keyword: "OTHER" }, { key: "h2", title: "Taker", keyword: "held" }]);
  const r = approvePlanVersion(v2.id);
  expect(r).toMatchObject({ ok: false, code: "KEYWORD_TAKEN" });
  expect(!r.ok && r.error).toContain(`post ${holder.id} (reel key h1)`);
});

test("undo pinned to the approved version: refused for the first version, and when another went live since", () => {
  const ref = { period: "week", periodKey: "2026-W30" } as const;
  const v1 = propose("2026-W30", reels("p", 1));
  approvePlanVersion(v1.id);
  expect(undoPlanVersion(ref, v1.id)).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });

  const v2 = propose("2026-W30", reels("p", 2));
  const v3 = propose("2026-W30", reels("p", 3));
  approvePlanVersion(v2.id);
  approvePlanVersion(v3.id);
  expect(undoPlanVersion(ref, v2.id)).toMatchObject({ ok: false, code: "LIVE_CHANGED" });
  expect(undoPlanVersion(ref, v3.id)).toMatchObject({ ok: true, live: { id: v2.id } });
});
