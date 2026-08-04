import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

async function seedVideo(): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@j-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `j-${videoId}`,
    url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
  });
  return videoId;
}

describe("frame_pass_jobs", () => {
  test("accepts a running job", async () => {
    const videoId = await seedVideo();
    await db.insert(tables.framePassJobs).values({
      id: newId(), videoId, status: "running", startedAt: nowIso(),
    });
    const rows = await db.select().from(tables.framePassJobs);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("refuses a second running job, so passes stay serial", async () => {
    const videoId = await seedVideo();
    await expect(
      db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "running", startedAt: nowIso() })
    ).rejects.toThrow();
  });

  test("allows many finished jobs side by side", async () => {
    const videoId = await seedVideo();
    const now = nowIso();
    await db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "success", startedAt: now, finishedAt: now });
    await db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "failed", startedAt: now, finishedAt: now });
    const done = await db.select().from(tables.framePassJobs);
    expect(done.filter((r) => r.status !== "running").length).toBe(2);
  });
});
