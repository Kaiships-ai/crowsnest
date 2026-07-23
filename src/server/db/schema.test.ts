import { beforeAll, expect, test } from "vitest";

beforeAll(() => { process.env.CROWSNEST_DB_PATH = ":memory:"; });

test("schema: insert + read a channel and video", async () => {
  const { db, newId, nowIso, tables } = await import("./index");
  const { migrate } = await import("./test-migrate");
  migrate(); // applies CREATE TABLE statements to the in-memory db
  const chId = newId();
  await db.insert(tables.channels).values({ id: chId, platform: "instagram", handle: "@demo", trackedSince: nowIso() });
  await db.insert(tables.videos).values({ id: newId(), channelId: chId, platform: "instagram", externalId: "x1", url: "https://example.com/1", postedAt: nowIso(), firstSeenAt: nowIso(), viewCount: 1000 });
  const rows = await db.select().from(tables.videos);
  expect(rows).toHaveLength(1);
  expect(rows[0].viewCount).toBe(1000);
});
