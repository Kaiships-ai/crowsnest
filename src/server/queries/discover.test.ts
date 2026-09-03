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
