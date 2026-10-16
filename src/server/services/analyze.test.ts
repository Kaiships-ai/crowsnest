import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

// Test-DB pattern (phase-1 final-review M7, mirrored across feed.test.ts / sync-engine.test.ts):
// env must be set in beforeAll BEFORE any dynamic import of "@/server/db".
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let VideoAnalysisSchema: typeof import("@/server/schemas")["VideoAnalysisSchema"];
let saveAgentAnalysis: typeof import("./analyze")["saveAgentAnalysis"];
let rowToAnalysis: typeof import("./analyze")["rowToAnalysis"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ VideoAnalysisSchema } = await import("@/server/schemas"));
  ({ saveAgentAnalysis, rowToAnalysis } = await import("./analyze"));
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

  test("B-10: a summary sent with the analysis is persisted and read back", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const ok = await saveAgentAnalysis(videoId, {
      ...FAKE_ANALYSIS,
      summary: "A creator opens with a cold-open question, then pays it off with three fast-cut tips.",
    });
    expect(ok).toEqual({ ok: true });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.summary).toBe("A creator opens with a cold-open question, then pays it off with three fast-cut tips.");
  });

  test("summary stays optional: an analysis saved without one still writes, with a null summary", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    const ok = await saveAgentAnalysis(videoId, FAKE_ANALYSIS);
    expect(ok).toEqual({ ok: true });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.summary).toBeNull();
  });

  test("B-10 P1: re-saving without a summary does not clobber a previously stored one", async () => {
    const { videoId } = await seedVideo({ withTranscript: false });
    await saveAgentAnalysis(videoId, {
      ...FAKE_ANALYSIS,
      summary: "A creator opens with a cold-open question, then pays it off with three fast-cut tips.",
    });
    const ok = await saveAgentAnalysis(videoId, { ...FAKE_ANALYSIS, hookType: "negative-warning" });
    expect(ok).toEqual({ ok: true });

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(row.hookType).toBe("negative-warning");
    expect(row.summary).toBe("A creator opens with a cold-open question, then pays it off with three fast-cut tips.");
  });

  test("rejects an unknown video id", async () => {
    migrate();
    const r = await saveAgentAnalysis("no-such-video", FAKE_ANALYSIS);
    expect(r).toEqual({ ok: false, error: "video not found" });
  });

  test("keyless path: an agent-authored analysis is written and read back with no ANTHROPIC_API_KEY set", async () => {
    // P0 slice 2a: analysis.ts no longer imports the LLM client at all, so this test
    // needs no fake/mock LLM and no key of any kind — proving the whole write-then-read
    // path (saveAgentAnalysis -> rowToAnalysis, the same mapping remix.ts and the
    // crowsnest_video MCP tool both consume) is genuinely keyless end to end.
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { videoId } = await seedVideo({ withTranscript: true });
      const ok = await saveAgentAnalysis(videoId, FAKE_ANALYSIS);
      expect(ok).toEqual({ ok: true });

      const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
      const analysis = rowToAnalysis(row);
      expect(analysis.hookType).toBe(FAKE_ANALYSIS.hookType);
      expect(analysis.structureSegments).toEqual(FAKE_ANALYSIS.structureSegments);
      expect(analysis.whyItWorked).toBe(FAKE_ANALYSIS.whyItWorked);

      const [transcriptRow] = await db
        .select({ text: tables.transcripts.text })
        .from(tables.transcripts)
        .where(eq(tables.transcripts.videoId, videoId));
      expect(transcriptRow.text.length).toBeGreaterThan(0);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
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
