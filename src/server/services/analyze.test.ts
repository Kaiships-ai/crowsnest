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
let NoTranscriptProviderError: typeof import("@/server/transcribe")["NoTranscriptProviderError"];
let getOrCreateAnalysis: typeof import("./analyze")["getOrCreateAnalysis"];
let saveAgentAnalysis: typeof import("./analyze")["saveAgentAnalysis"];
let rowToAnalysis: typeof import("./analyze")["rowToAnalysis"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ resolveModel } = await import("@/server/llm/client"));
  ({ VideoAnalysisSchema } = await import("@/server/llm/schemas"));
  ({ NoTranscriptProviderError } = await import("@/server/transcribe"));
  ({ getOrCreateAnalysis, saveAgentAnalysis, rowToAnalysis } = await import("./analyze"));
});

const FAKE_ANALYSIS = {
  hookType: "curiosity-gap",
  structureSegments: [
    {
      label: "Hook",
      startSec: 0,
      endSec: 3,
      note: "opens with a direct question",
      transcript: "Here's the mistake almost everyone makes in their first month",
    },
  ],
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
  return { generateText: vi.fn(), generateParsed, ping: vi.fn() };
}

describe("saveAgentAnalysis", () => {
  test("validates and upserts with source=mcp, never calling the llm", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const ok = await saveAgentAnalysis(videoId, FAKE_ANALYSIS);
    expect(ok).toEqual({ ok: true });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.source).toBe("mcp");
    expect(row.hookType).toBe("curiosity-gap");
  });

  test("re-save updates the existing row in place, keeping source=mcp", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    await saveAgentAnalysis(videoId, FAKE_ANALYSIS);
    await saveAgentAnalysis(videoId, { ...FAKE_ANALYSIS, hookType: "negative-warning" });

    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(1);
    expect(rows[0].hookType).toBe("negative-warning");
    expect(rows[0].source).toBe("mcp");
  });

  test("rejects invalid fields without writing a row", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const r = await saveAgentAnalysis(videoId, { hookType: "x" }); // missing required fields
    expect(r.ok).toBe(false);
    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(0);
  });

  test("Remix and Ideas read the agent-saved analysis unchanged (via rowToAnalysis)", async () => {
    // rowToAnalysis is the exact mapping remix.ts imports and uses to describe a source
    // video's structure, so this proves the agent artifact is consumed downstream as is.
    const { videoId } = await seedVideo({ withTranscript: false });
    await saveAgentAnalysis(videoId, FAKE_ANALYSIS);
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    const mapped = rowToAnalysis(row);
    expect(mapped.hookType).toBe("curiosity-gap");
    expect(mapped.formatTags).toEqual(FAKE_ANALYSIS.formatTags);
    expect(mapped.whyItWorked).toBe(FAKE_ANALYSIS.whyItWorked);
  });

  test("rejects an unknown video id", async () => {
    migrate();
    const r = await saveAgentAnalysis("no-such-video", FAKE_ANALYSIS);
    expect(r).toEqual({ ok: false, error: "video not found" });
  });
});

describe("getOrCreateAnalysis", () => {
  test("cache hit returns the existing row without calling the llm", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    await db.insert(tables.videoAnalyses).values({ videoId, ...FAKE_ANALYSIS, model: "claude-sonnet-5", createdAt: nowIso() });

    const generateParsed = vi.fn();
    const result = await getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed) });

    expect(generateParsed).not.toHaveBeenCalled();
    expect(result).toEqual(FAKE_ANALYSIS);
  });

  test("cache miss with an existing transcript calls generateParsed with VideoAnalysisSchema and upserts video_analyses with the resolved model", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    const generateParsed = vi.fn().mockResolvedValue(FAKE_ANALYSIS);

    const result = await getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed) });

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

  test("no transcript yet: creates one via the injected transcribe function, then analyzes with its text (final-review finding B1)", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const generateParsed = vi.fn().mockResolvedValue(FAKE_ANALYSIS);
    const transcribe = vi.fn().mockResolvedValue({ text: "a freshly transcribed line", source: "whisper-local", cached: false });

    const result = await getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed), transcribe });

    expect(transcribe).toHaveBeenCalledWith(videoId);
    expect(result).toEqual(FAKE_ANALYSIS);
    const call = generateParsed.mock.calls[0][0] as { user: string };
    expect(call.user).toContain("a freshly transcribed line");
  });

  test("no transcript yet and no provider available: NoTranscriptProviderError propagates untouched, llm never called, no row persisted", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const generateParsed = vi.fn();
    const boom = new NoTranscriptProviderError([{ name: "whisper-cpp-local", reason: "not installed" }]);
    const transcribe = vi.fn().mockRejectedValue(boom);

    await expect(getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed), transcribe })).rejects.toBe(boom);
    expect(generateParsed).not.toHaveBeenCalled();

    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(0);
  });

  test("an llm error propagates untouched rather than being swallowed or wrapped", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    class FakeRateLimitError extends Error {}
    const boom = new FakeRateLimitError("rate limited");
    const generateParsed = vi.fn().mockRejectedValue(boom);

    await expect(getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed) })).rejects.toBe(boom);

    const rows = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(rows).toHaveLength(0); // failed generation must not leave a partial row
  });

  test("a beat's verbatim transcript survives the round trip through video_analyses", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    await getOrCreateAnalysis(videoId, { llm: fakeLlm(vi.fn().mockResolvedValue(FAKE_ANALYSIS)) });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.structureSegments?.[0].transcript).toBe(
      "Here's the mistake almost everyone makes in their first month"
    );
  });

  test("force re-analyzes an already-analyzed video and replaces the beats without touching the layout columns", async () => {
    const { videoId } = await seedVideo({ withTranscript: true });
    // A row from before the per-beat transcript existed, carrying a real frame pass.
    await db.insert(tables.videoAnalyses).values({
      videoId,
      hookType: "stale-hook",
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "the old summary" }],
      formatTags: [],
      styleTags: [],
      whyItWorked: "stale",
      model: "claude-sonnet-5",
      createdAt: nowIso(),
      layout: {
        onScreenText: { value: "SIGN UP", fromFramesSec: [1.5] },
        textPosition: { value: "lower third", fromFramesSec: [1.5] },
        cutRhythm: { value: "fast", fromFramesSec: [1.5, 4] },
        framing: { value: "medium", fromFramesSec: [1.5] },
      },
      framesSampled: 8,
      frameModel: "claude-frame-reader",
    });

    const generateParsed = vi.fn().mockResolvedValue(FAKE_ANALYSIS);
    await getOrCreateAnalysis(videoId, { llm: fakeLlm(generateParsed), force: true });

    expect(generateParsed).toHaveBeenCalledTimes(1); // force means the cache does not short-circuit
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.hookType).toBe("curiosity-gap");
    expect(row.structureSegments?.[0].transcript).toBe(
      "Here's the mistake almost everyone makes in their first month"
    );
    // The frame pass is a separate provenance; a text re-analysis must not clear it.
    expect(row.framesSampled).toBe(8);
    expect(row.frameModel).toBe("claude-frame-reader");
    expect(row.layout).not.toBeNull();
  });
});

describe("VideoAnalysisSchema", () => {
  test("a structureSegment carrying a verbatim transcript validates", () => {
    const parsed = VideoAnalysisSchema.parse(FAKE_ANALYSIS);
    expect(parsed.structureSegments[0].transcript).toBe(
      "Here's the mistake almost everyone makes in their first month"
    );
  });

  test("a structureSegment with no transcript is rejected, so the write path can never store a beat with no words", () => {
    const noTranscript = {
      ...FAKE_ANALYSIS,
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "opens with a direct question" }],
    };
    expect(() => VideoAnalysisSchema.parse(noTranscript)).toThrow();
  });
});
