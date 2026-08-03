import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getFramePassJobAction: typeof import("./analyze-actions")["getFramePassJobAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getFramePassJobAction } = await import("./analyze-actions"));
  migrate();
});

describe("getFramePassJobAction", () => {
  test("reports a failed job with its message", async () => {
    const channelId = newId();
    const videoId = newId();
    const jobId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@a-${channelId}`, trackedSince: now });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `a-${videoId}`,
      url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
    });
    await db.insert(tables.framePassJobs).values({
      id: jobId, videoId, status: "failed", startedAt: now, finishedAt: now,
      errorCode: "FRAME_EXTRACT_FAILED", errorMessage: "ffmpeg exploded",
    });

    const out = await getFramePassJobAction(jobId);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("ffmpeg exploded");
  });

  test("reports an unknown job id as failed rather than pretending it runs", async () => {
    const out = await getFramePassJobAction(newId());
    expect(out.status).toBe("failed");
  });
});
