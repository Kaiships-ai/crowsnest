import { beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { LlmClient } from "@/server/llm/client";

// Test-DB pattern (phase-1 final-review M7, mirrored across feed.test.ts / sync-engine.test.ts):
// env must be set in beforeAll BEFORE any dynamic import of "@/server/db".
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let resolveModel: typeof import("@/server/llm/client")["resolveModel"];
let VideoAnalysisSchema: typeof import("@/server/llm/schemas")["VideoAnalysisSchema"];
let getOrCreateAnalysis: typeof import("./analyze")["getOrCreateAnalysis"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ resolveModel } = await import("@/server/llm/client"));
  ({ VideoAnalysisSchema } = await import("@/server/llm/schemas"));
  ({ getOrCreateAnalysis } = await import("./analyze"));
});

const FAKE_ANALYSIS = {
  hookType: "curiosity-gap",
  structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "opens with a direct question" }],
  formatTags: ["talking-head"],
  styleTags: ["fast-cut"],
  whyItWorked: "The cold-open question plus fast cuts kept retention high through the payoff.",
};

/** Fresh channel + video row per test (unique ids), optionally with a transcript. */
async function seedVideo(opts: { withTranscript: boolean }) {
  migrate();
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@analyze-test-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `analyze-${videoId}`,
    url: "https://example.com/reel",
    caption: "3 mistakes killing your growth",
    postedAt: now,
    durationSec: 30,
    viewCount: 250_000,
    outlierScore: 12.4,
    firstSeenAt: now,
  });
  if (opts.withTranscript) {
    await db.insert(tables.transcripts).values({
      videoId,
      text: "Here's the mistake almost everyone makes in their first month...",
      source: "whisper-local",
      createdAt: now,
    });
  }
  return { channelId, videoId };
}

function fakeLlm(generateParsed: LlmClient["generateParsed"]): LlmClient {
  return { generateText: vi.fn(), generateParsed };
}

describe("getOrCreateAnalysis", () => {
  test("cache hit returns the existing row without calling the llm", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    await db.insert(tables.videoAnalyses).values({ videoId, ...FAKE_ANALYSIS, model: "claude-sonnet-5", createdAt: nowIso() });

    const generateParsed = vi.fn();
    const result = await getOrCreateAnalysis(videoId, fakeLlm(generateParsed));

    expect(generateParsed).not.toHaveBeenCalled();
    expect(result).toEqual(FAKE_ANALYSIS);
  });

  test("cache miss calls generateParsed with VideoAnalysisSchema and upserts video_analyses with the resolved model", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    const generateParsed = vi.fn().mockResolvedValue(FAKE_ANALYSIS);

    const result = await getOrCreateAnalysis(videoId, fakeLlm(generateParsed));

    expect(result).toEqual(FAKE_ANALYSIS);
    expect(generateParsed).toHaveBeenCalledTimes(1);
    const call = generateParsed.mock.calls[0][0] as { schema: unknown; user: string };
    expect(call.schema).toBe(VideoAnalysisSchema);
    expect(call.user).toContain("Here's the mistake"); // transcript text made it into the prompt

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row).toBeDefined();
    expect(row.model).toBe(resolveModel());
    expect(row.hookType).toBe(FAKE_ANALYSIS.hookType);
    expect(row.structureSegments).toEqual(FAKE_ANALYSIS.structureSegments);
  });

  test("no transcript yet returns null and never calls the llm", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const generateParsed = vi.fn();

    const result = await getOrCreateAnalysis(videoId, fakeLlm(generateParsed));

    expect(result).toBeNull();
    expect(generateParsed).not.toHaveBeenCalled();

    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(0);
  });

  test("an llm error propagates untouched rather than being swallowed or wrapped", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    class FakeRateLimitError extends Error {}
    const boom = new FakeRateLimitError("rate limited");
    const generateParsed = vi.fn().mockRejectedValue(boom);

    await expect(getOrCreateAnalysis(videoId, fakeLlm(generateParsed))).rejects.toBe(boom);

    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(0); // failed generation must not leave a partial row
  });
});
