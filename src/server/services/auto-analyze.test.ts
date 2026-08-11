import { beforeAll, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let autoAnalyzeNewOutliers: typeof import("./auto-analyze")["autoAnalyzeNewOutliers"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ autoAnalyzeNewOutliers } = await import("./auto-analyze"));
  migrate();
});

/** One fresh channel with N videos, one per entry — mirrors ideas.test.ts's
 *  `seedChannelWithAnalyzed`, but leaves `video_analyses` empty (this pass's whole job is
 *  to fill it) and lets each entry choose whether the video already has a local asset. */
async function seedChannelWithOutliers(entries: { score: number; hasAsset?: boolean }[]) {
  const channelId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@auto-analyze-${channelId}`, trackedSince: now });

  let assetSeq = 0;
  const videoIds: string[] = [];
  for (const entry of entries) {
    const videoId = newId();
    videoIds.push(videoId);
    let videoAssetId: string | null = null;
    if (entry.hasAsset) {
      videoAssetId = `asset-${channelId}-${assetSeq++}`;
      await db.insert(tables.mediaAssets).values({
        id: videoAssetId,
        sha256: videoAssetId.padEnd(64, "0").slice(0, 64),
        kind: "video",
        contentType: "video/mp4",
        byteSize: 1024,
        storagePath: `aa/${videoAssetId}.mp4`,
        downloadedAt: now,
      });
    }
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: `auto-analyze-${videoId}`,
      url: "https://example.com/source",
      caption: "the topic nobody talks about",
      postedAt: now,
      durationSec: 30,
      viewCount: 100_000,
      outlierScore: entry.score,
      videoAssetId,
      firstSeenAt: now,
    });
  }
  return { channelId, videoIds };
}

/** A `video_analyses` row for `videoId`, so a candidate query can be proven to skip it —
 *  same shape as ideas.test.ts's seeded analyses. */
async function markAnalyzed(videoId: string) {
  await db.insert(tables.videoAnalyses).values({
    videoId,
    hookType: "curiosity-gap",
    structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "cold open" }],
    formatTags: ["talking-head"],
    styleTags: ["fast-cut"],
    whyItWorked: "strong hook",
    summary: "already analyzed",
    model: "claude-sonnet-5",
    createdAt: nowIso(),
  });
}

function fakeDownload(overrides?: Partial<{ ok: boolean; error: string }>) {
  return vi.fn().mockResolvedValue({ ok: true, ...overrides });
}

function fakeAnalyze() {
  return vi.fn().mockResolvedValue({ hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [], whyItWorked: "worked" });
}

describe("autoAnalyzeNewOutliers", () => {
  test("selects only unanalyzed outliers at or above the threshold", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 2 }, { score: 4 }]);
    const [highId, lowId, midId] = videoIds;
    // lowId scores 2, below the threshold=3 default; excluded regardless of analysis state.
    await markAnalyzed(lowId); // already analyzed — would be excluded either way, proves both filters independently

    const download = fakeDownload();
    const analyze = fakeAnalyze();
    const summary = await autoAnalyzeNewOutliers(channelId, { download, analyze });

    expect(summary).toEqual({ attempted: 2, analyzed: 2, downloaded: 2, failed: 0 });
    const analyzedIds = analyze.mock.calls.map((c) => c[0]).sort();
    expect(analyzedIds).toEqual([highId, midId].sort());
  });

  test("excludes an outlier that already has a video_analyses row", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }]);
    const [analyzedId] = videoIds;
    await markAnalyzed(analyzedId);

    const analyze = fakeAnalyze();
    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze });

    expect(summary.attempted).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][0]).not.toBe(analyzedId);
  });

  test("caps at 10 and orders by score descending", async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({ score: i + 1 })); // scores 1..15
    const { channelId, videoIds } = await seedChannelWithOutliers(entries);
    // scores 1 and 2 are below threshold=3, so 13 qualify; cap keeps the top 10 (scores 6..15).
    const scoreByVideoId = new Map(videoIds.map((id, i) => [id, i + 1]));

    const analyze = fakeAnalyze();
    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze });

    expect(summary.attempted).toBe(10);
    const calledScores = analyze.mock.calls.map((c) => scoreByVideoId.get(c[0])!);
    expect(calledScores).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  });

  test("downloads only when videoAssetId is null", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5, hasAsset: true }, { score: 4, hasAsset: false }]);
    const [withAssetId, withoutAssetId] = videoIds;

    const download = fakeDownload();
    const analyze = fakeAnalyze();
    const summary = await autoAnalyzeNewOutliers(channelId, { download, analyze });

    expect(summary).toEqual({ attempted: 2, analyzed: 2, downloaded: 1, failed: 0 });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(withoutAssetId);
    expect(download).not.toHaveBeenCalledWith(withAssetId);
  });

  test("a per-item throw does not abort the pass, and is counted as a failure", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }, { score: 3.5 }]);
    const [failId] = videoIds;

    const analyze = vi.fn().mockImplementation(async (videoId: string) => {
      if (videoId === failId) throw new Error("9router is down");
      return { hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [], whyItWorked: "worked" };
    });

    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze });

    expect(summary.attempted).toBe(3);
    expect(summary.analyzed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(3); // did not abort after the throw
  });

  test("a download failure is counted as a failure and skips analyze for that item", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }]);
    const [firstId] = videoIds;

    const download = vi.fn().mockImplementation(async (videoId: string) =>
      videoId === firstId ? { ok: false, error: "expired IG URL" } : { ok: true }
    );
    const analyze = fakeAnalyze();

    const summary = await autoAnalyzeNewOutliers(channelId, { download, analyze });

    expect(summary.attempted).toBe(2);
    expect(summary.downloaded).toBe(1);
    expect(summary.analyzed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(analyze).not.toHaveBeenCalledWith(firstId);
  });

  test("a null analyze result (video row gone) is counted as a failure, not a success", async () => {
    // getOrCreateAnalysis's documented behavior when the video row vanishes between the
    // candidate query and the call itself (analyze.ts:92-95): it returns null instead of
    // throwing. The loop's success/failure split must not rely on the catch alone.
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }, { score: 3.5 }]);
    const [nullId] = videoIds;

    const analyze = vi.fn().mockImplementation(async (videoId: string) =>
      videoId === nullId ? null : { hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [], whyItWorked: "worked" }
    );

    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze });

    expect(summary.attempted).toBe(3);
    expect(summary.analyzed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(3); // did not abort on the null result
  });

  test("shouldStop() true stops the pass early", async () => {
    const { channelId } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }, { score: 3 }]);

    const analyze = fakeAnalyze();
    const shouldStop = vi.fn().mockResolvedValue(true);
    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze, shouldStop });

    expect(summary).toEqual({ attempted: 0, analyzed: 0, downloaded: 0, failed: 0 });
    expect(analyze).not.toHaveBeenCalled();
  });

  test("shouldStop() flipping true after the first item stops before the rest", async () => {
    const { channelId, videoIds } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }, { score: 3 }]);

    const analyze = fakeAnalyze();
    let calls = 0;
    const shouldStop = vi.fn().mockImplementation(async () => {
      calls += 1;
      return calls > 1; // let the first candidate through, stop before the second
    });
    const summary = await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze, shouldStop });

    expect(summary.attempted).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith(videoIds[0]);
  });

  test("tick is called once per candidate reached", async () => {
    const { channelId } = await seedChannelWithOutliers([{ score: 5 }, { score: 4 }, { score: 3 }]);

    const tick = vi.fn().mockResolvedValue(undefined);
    await autoAnalyzeNewOutliers(channelId, { download: fakeDownload(), analyze: fakeAnalyze(), tick });

    expect(tick).toHaveBeenCalledTimes(3);
  });

  test("defaults to the real downloadVideoAction and getOrCreateAnalysis when no overrides are given", async () => {
    // Threshold default (3) with no candidates at or above it: proves the function runs
    // end-to-end against the real db module and real default deps without throwing, even
    // though nothing in this suite exercises the real network/LLM path.
    const { channelId } = await seedChannelWithOutliers([{ score: 1 }]);
    const summary = await autoAnalyzeNewOutliers(channelId);
    expect(summary).toEqual({ attempted: 0, analyzed: 0, downloaded: 0, failed: 0 });
  });
});
