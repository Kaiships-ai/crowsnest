import { beforeAll, describe, expect, test } from "vitest";
import { desc } from "drizzle-orm";

// In-memory DB + migrate, same pattern as schema.test.ts (Task 3).
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
});

describe("seedDatabase", () => {
  test("seeds deterministic demo fixtures: channels, videos, scores, fleets, filters, vault", async () => {
    const { db, tables } = await import("./index");
    const { migrate } = await import("./test-migrate");
    const { seedDatabase } = await import("./seed");
    migrate(); // idempotent — safe even if already applied by another test in this file

    const summary = await seedDatabase(db);
    expect(summary).toContain("4 channels");
    expect(summary).toContain("80 videos");
    expect(summary).toContain("8 planted outliers");

    const channels = await db.select().from(tables.channels);
    expect(channels).toHaveLength(4);

    const videos = await db.select().from(tables.videos);
    expect(videos).toHaveLength(80);

    // every video must have a computed outlier score (never left undefined/unset)
    for (const v of videos) {
      expect(v.outlierScore).not.toBeUndefined();
    }

    // every video has a deterministic, non-null likeCount strictly below its viewCount
    // (likeCount = 2-6% of views), and a non-null commentCount (1-4% of likes)
    for (const v of videos) {
      expect(typeof v.likeCount).toBe("number");
      expect(typeof v.commentCount).toBe("number");
      expect(typeof v.viewCount).toBe("number");
      if (typeof v.likeCount === "number" && typeof v.viewCount === "number") {
        expect(v.likeCount).toBeLessThan(v.viewCount);
      }
      if (typeof v.commentCount === "number" && typeof v.likeCount === "number") {
        expect(v.commentCount).toBeLessThan(v.likeCount);
      }
    }

    const highScorers = videos.filter((v) => (v.outlierScore ?? 0) >= 2.5);
    expect(highScorers.length).toBeGreaterThanOrEqual(8);

    const topScore = Math.max(...videos.map((v) => v.outlierScore ?? 0));
    expect(topScore).toBeGreaterThanOrEqual(38 - 0.5);
    expect(topScore).toBeLessThanOrEqual(38 + 0.5);

    const fleets = await db.select().from(tables.fleets);
    expect(fleets).toHaveLength(2);

    const savedFilters = await db.select().from(tables.savedFilters);
    const systemFilters = savedFilters.filter((f) => f.isSystem);
    expect(systemFilters).toHaveLength(2);
    expect(systemFilters.map((f) => f.name).sort()).toEqual(["Balanced", "High Conviction"]);

    const vaultItems = await db.select().from(tables.vaultItems);
    expect(vaultItems).toHaveLength(6);
    expect(vaultItems.filter((v) => v.type === "hook")).toHaveLength(3);
    expect(vaultItems.filter((v) => v.type === "style")).toHaveLength(3);
  });

  test("is deterministic: running seedDatabase twice yields identical top-5 video view/like/comment counts", async () => {
    const { db, tables } = await import("./index");
    const { migrate } = await import("./test-migrate");
    const { seedDatabase } = await import("./seed");
    migrate();

    const top5 = () =>
      db
        .select({
          viewCount: tables.videos.viewCount,
          likeCount: tables.videos.likeCount,
          commentCount: tables.videos.commentCount,
        })
        .from(tables.videos)
        .orderBy(desc(tables.videos.viewCount))
        .limit(5);

    await seedDatabase(db);
    const first = await top5();

    await seedDatabase(db);
    const second = await top5();

    expect(second).toEqual(first);
  });
});
