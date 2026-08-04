import { beforeAll, describe, expect, test, vi } from "vitest";
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

// Fix round 1: parses fine (schema does not enforce anti-fabrication, only
// persistFramePass does) but persistFramePass must reject the "invented" field: it
// carries a value while citing zero frames.
const VALIDATION_REJECTED_JSON = JSON.stringify({
  onScreenText: { value: "invented, never actually seen", fromFramesSec: [] },
  textPosition: { value: null, fromFramesSec: [] },
  cutRhythm: { value: null, fromFramesSec: [] },
  framing: { value: null, fromFramesSec: [] },
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

  // Fix round 1, Important 2: a genuine parse failure (above) and the validator
  // correctly refusing a fabricated reading are different things and must carry
  // different codes — conflating them hides the one distinction this feature exists
  // to make.
  test("records FRAME_VALIDATION_REJECTED, not FRAME_PARSE_FAILED, when the layout parses but cites no frame", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => FRAMES,
      runClaudeTask: async () => ({ text: VALIDATION_REJECTED_JSON, costUsd: null, turns: null, durationMs: null }),
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("FRAME_VALIDATION_REJECTED");
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(analysis.framePassError).toContain("names no source frames");
    const [job] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, out.jobId));
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("FRAME_VALIDATION_REJECTED");
  });

  // Fix round 1, Important 1: lock_key is a constant, so the very first db.insert can
  // hit the partial unique index when another pass already holds the lock. That must
  // come back as a structured result, never as a rejected promise, and must not create
  // a second row.
  test("returns FRAME_ALREADY_RUN instead of rejecting when another pass already holds the lock", async () => {
    const videoId = await seedVideoWithFile();
    const otherVideoId = await seedVideoWithFile();
    const runningJobId = newId();
    await db.insert(tables.framePassJobs).values({ id: runningJobId, videoId: otherVideoId, status: "running", startedAt: nowIso() });

    try {
      const out = await runFramePass(videoId, {
        extractFrames: async () => FRAMES,
        runClaudeTask: async () => OK_TASK,
      });

      expect(out.ok).toBe(false);
      expect(out.errorCode).toBe("FRAME_ALREADY_RUN");
      expect(out.jobId).toBe(runningJobId);

      const rowsForThisVideo = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.videoId, videoId));
      expect(rowsForThisVideo).toHaveLength(0);
    } finally {
      // Release the global lock so later tests in this file are not blocked by it.
      await db.update(tables.framePassJobs).set({ status: "failed", finishedAt: nowIso() }).where(eq(tables.framePassJobs.id, runningJobId));
    }
  });

  // Fix round 1, Critical: any throw that escapes the narrow inner try/catches (here,
  // forced at the heartbeat update right after extraction, one of the four spots the
  // reviewer named) must still close the job as failed. Before the fix this row was
  // stranded at "running" forever, and because lock_key is a constant, one stranded
  // row blocks every future frame pass, not just this video's.
  test("marks the job failed instead of leaving it stuck 'running' when an unguarded step throws", async () => {
    const videoId = await seedVideoWithFile();
    const updateSpy = vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("db exploded unexpectedly");
    });

    let out: Awaited<ReturnType<typeof runFramePass>>;
    try {
      out = await runFramePass(videoId, {
        extractFrames: async () => FRAMES,
        runClaudeTask: async () => OK_TASK,
      });
    } finally {
      updateSpy.mockRestore();
    }

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("FRAME_UNKNOWN");

    const rows = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.videoId, videoId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((j) => j.status !== "running")).toBe(true);
    expect(rows.some((j) => j.status === "failed")).toBe(true);
  });
});
