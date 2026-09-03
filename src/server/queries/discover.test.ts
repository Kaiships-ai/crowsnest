import { beforeEach, expect, test } from "vitest";
import { db, newId, nowIso, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { listCreatorSeeds } from "./discover";

// Same test-DB pattern as feed.test.ts / channels.test.ts: migrate the in-memory
// db once per test and wipe the tables this test touches.
beforeEach(async () => {
  migrate();
  await db.delete(tables.creatorSeeds);
  await db.delete(tables.channels);
});

test("lists seeds with tracked flag and niche filter", async () => {
  await db.insert(tables.creatorSeeds).values([
    { id: newId(), platform: "instagram", handle: "alpha", niche: "tech", why: "w", source: null, createdAt: nowIso() },
    { id: newId(), platform: "instagram", handle: "beta", niche: "fitness", why: "w", source: null, createdAt: nowIso() },
  ]);
  await db.insert(tables.channels).values({
    id: newId(), platform: "instagram", handle: "alpha", trackedSince: nowIso(),
  });
  const tech = await listCreatorSeeds({ niche: "tech" });
  expect(tech).toHaveLength(1);
  expect(tech[0]).toMatchObject({ handle: "alpha", tracked: true });
  const all = await listCreatorSeeds();
  expect(all.find((r) => r.handle === "beta")?.tracked).toBe(false);
});

// Regression guard: the join predicate (not a WHERE clause) must carry the
// deletedAt check. A WHERE-clause version would drop the seed row entirely
// once its matching channel is soft-deleted; the leftJoin version keeps the
// seed and just reports tracked:false.
test("soft-deleted channel: seed still returned, tracked false", async () => {
  await db.insert(tables.creatorSeeds).values({
    id: newId(), platform: "instagram", handle: "gamma", niche: "tech", why: "w", source: null, createdAt: nowIso(),
  });
  await db.insert(tables.channels).values({
    id: newId(), platform: "instagram", handle: "gamma", trackedSince: nowIso(), deletedAt: nowIso(),
  });
  const all = await listCreatorSeeds();
  const gamma = all.find((r) => r.handle === "gamma");
  expect(gamma).toBeDefined();
  expect(gamma?.tracked).toBe(false);
});

test("orders by niche asc, then handle asc", async () => {
  await db.insert(tables.creatorSeeds).values([
    { id: newId(), platform: "instagram", handle: "zed", niche: "tech", why: "w", source: null, createdAt: nowIso() },
    { id: newId(), platform: "instagram", handle: "amy", niche: "tech", why: "w", source: null, createdAt: nowIso() },
    { id: newId(), platform: "instagram", handle: "mid", niche: "business", why: "w", source: null, createdAt: nowIso() },
  ]);
  const all = await listCreatorSeeds();
  expect(all.map((r) => [r.niche, r.handle])).toEqual([
    ["business", "mid"],
    ["tech", "amy"],
    ["tech", "zed"],
  ]);
});
