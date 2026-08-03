import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Test-DB pattern (phase-1 final-review M7): env must be set in beforeAll BEFORE any
// dynamic import of "@/server/db", mirrored across the other service tests.
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let runFramePass: typeof import("./frame-pass-runner")["runFramePass"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ runFramePass } = await import("./frame-pass-runner"));
  migrate();
});

const GOOD_JSON = JSON.stringify({
  onScreenText: { value: "Claude", fromFramesSec: [0] },
  textPosition: { value: "centered", fromFramesSec: [0] },
  cutRhythm: { value: "every 2s", fromFramesSec: [0, 3] },
  framing: { value: "talking head", fromFramesSec: [0] },
});

const FRAMES = [{ path: "/tmp/f/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" }];
const OK_TASK = { text: GOOD_JSON, costUsd: null, turns: null, durationMs: null };

async function seedVideoWithFile(): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const assetId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@r-${channelId}`, trackedSince: now });
  // mediaAssets: kind/storagePath/sha256 come from the brief, the rest (contentType,
  // byteSize, downloadedAt) are required NOT NULL columns the brief's snippet omitted.
  await db.insert(tables.mediaAssets).values({
    id: assetId,
    kind: "video",
    contentType: "video/mp4",
    byteSize: 1024,
    storagePath: "ab/test.mp4",
    sha256: newId(),
    downloadedAt: now,
  });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `r-${videoId}`,
    url: "https://example.com/reel", postedAt: now, firstSeenAt: now, videoAssetId: assetId,
  });
  return videoId;
}

describe("runFramePass", () => {
  test("writes the layout and marks the job successful", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => FRAMES,
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.ok).toBe(true);
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(analysis.layout).not.toBeNull();
    expect(analysis.framesSampled).toBe(1);
    const [job] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, out.jobId));
    expect(job.status).toBe("success");
    expect(job.finishedAt).not.toBeNull();
  });

  test("records a failure and closes the job when extraction dies", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => {
        throw new Error("ffmpeg exploded");
      },
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("FRAME_EXTRACT_FAILED");
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(analysis.framePassError).toContain("ffmpeg exploded");
    const [job] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, out.jobId));
    expect(job.status).toBe("failed");
  });

  test("records a failure when the model returns unusable JSON", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => FRAMES,
      runClaudeTask: async () => ({
        text: '{"onScreenText":{"value":"x","fromFramesSec":[0,1',
        costUsd: null, turns: null, durationMs: null,
      }),
    });
    expect(out.errorCode).toBe("FRAME_PARSE_FAILED");
  });

  test("fails before spawning anything when the video has no downloaded file", async () => {
    const channelId = newId();
    const videoId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@n-${channelId}`, trackedSince: now });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `n-${videoId}`,
      url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
    });

    let spawned = false;
    const out = await runFramePass(videoId, {
      extractFrames: async () => {
        spawned = true;
        return FRAMES;
      },
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.errorCode).toBe("FRAME_NO_VIDEO_ASSET");
    expect(spawned).toBe(false);
  });
});
