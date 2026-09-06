import { beforeAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Same in-memory test-DB pattern as own-channel.test.ts / mcp-server.test.ts:
// migrate() applies the committed ./drizzle migrations to the shared :memory: db.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

beforeEach(async () => {
  await db.delete(tables.videoAnalyses);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

test("video_analyses has a source column that accepts mcp", async () => {
  const channelId = newId();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@src-col", trackedSince: "2026-09-01T00:00:00.000Z" });
  await db.insert(tables.videos).values({
    id: "v1", channelId, platform: "instagram", externalId: "x1",
    url: "https://example.com/p", postedAt: "2026-09-01T00:00:00.000Z", firstSeenAt: "2026-09-01T00:00:00.000Z",
  });
  await db.insert(tables.videoAnalyses).values({ videoId: "v1", createdAt: "2026-09-01T00:00:00.000Z", source: "mcp" });

  const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, "v1"));
  expect(row.source).toBe("mcp");
});
