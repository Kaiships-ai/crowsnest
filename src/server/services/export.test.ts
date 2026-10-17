import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let buildVideoPrompt: typeof import("./export")["buildVideoPrompt"];
let buildRemixPrompt: typeof import("./export")["buildRemixPrompt"];

// Fixed (not nowIso()) so postedAt/createdAt never vary between runs — required for
// the snapshot tests below to stay stable.
const FIXED_DATE = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ buildVideoPrompt, buildRemixPrompt } = await import("./export"));
});

describe("buildVideoPrompt", () => {
  test("returns null when the video doesn't exist", async () => {
    migrate();
    const result = await buildVideoPrompt(newId());
    expect(result).toBeNull();
  });

  test("snapshot: fully analyzed video with transcript, niche profile, and similar outliers", async () => {
    migrate();
    const channelId = newId();
    const videoId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@aitoolsforcreators", trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: "export-full",
      url: "https://example.com/full", caption: "the AI tool nobody is talking about (yet)",
      postedAt: FIXED_DATE, durationSec: 34, viewCount: 2_400_000, outlierScore: 12.4, firstSeenAt: FIXED_DATE,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId,
      hookType: "curiosity-gap",
      structureSegments: [
        { label: "Hook", startSec: 0, endSec: 3, note: "opens with a direct claim" },
        { label: "Build", startSec: 3, endSec: 20, note: "explains the mechanism" },
        { label: "Payoff", startSec: 20, endSec: 34, note: "shows the before/after" },
      ],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut", "on-screen-text"],
      whyItWorked: "The cold-open claim plus fast pacing kept retention high through the payoff.",
      model: "claude-sonnet-5",
      createdAt: FIXED_DATE,
    });
    await db.insert(tables.transcripts).values({
      videoId, text: "Here's the AI tool nobody is talking about yet...", source: "whisper-local", createdAt: FIXED_DATE,
    });
    await db.insert(tables.appSettings).values({ key: "niche_profile", value: "AI tools for solo founders" });

    // One similar analyzed video so the "Similar tracked outliers" list is non-empty.
    const otherChannelId = newId();
    const otherVideoId = newId();
    await db.insert(tables.channels).values({ id: otherChannelId, platform: "instagram", handle: "@buildinpublic.daily", trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: otherVideoId, channelId: otherChannelId, platform: "instagram", externalId: "export-similar",
      url: "https://example.com/similar", caption: "3 mistakes killing your growth",
      postedAt: FIXED_DATE, outlierScore: 8.1, firstSeenAt: FIXED_DATE,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId: otherVideoId, hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [],
      whyItWorked: "because", model: "claude-sonnet-5", createdAt: FIXED_DATE,
    });

    const result = await buildVideoPrompt(videoId);
    expect(result).toMatchSnapshot();
  });

  test("graceful degradation: no analysis yet — metrics + transcript still present, sections note analysis pending", async () => {
    migrate();
    const channelId = newId();
    const videoId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@no-analysis-yet", trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: "export-degraded",
      url: "https://example.com/degraded", caption: "a video with no analysis yet",
      postedAt: FIXED_DATE, durationSec: 20, viewCount: 50_000, outlierScore: 3.2, firstSeenAt: FIXED_DATE,
    });
    await db.insert(tables.transcripts).values({
      videoId, text: "Some transcript text for this unanalyzed video.", source: "whisper-local", createdAt: FIXED_DATE,
    });

    const result = await buildVideoPrompt(videoId);
    expect(result).not.toBeNull();
    expect(result).toContain("Analysis pending");
    expect(result).toContain("Some transcript text for this unanalyzed video.");
    expect(result).toContain("@no-analysis-yet");
    expect(result).toContain("3.2×");
    expect(result).toMatchSnapshot();
  });

  test("graceful degradation: no transcript either — still returns a full document", async () => {
    migrate();
    const channelId = newId();
    const videoId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@bare", trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: "export-bare",
      url: "https://example.com/bare", caption: "totally fresh video", postedAt: FIXED_DATE, firstSeenAt: FIXED_DATE,
    });

    const result = await buildVideoPrompt(videoId);
    expect(result).not.toBeNull();
    expect(result).toContain("No transcript available.");
  });
});

/**
 * `buildRemixPrompt` exists because `buildVideoPrompt` answers the wrong question at the
 * end of a remix: it describes the outlier, and by the Script stage the user has chosen a
 * hook and a variant that the source analysis knows nothing about.
 */
describe("buildRemixPrompt", () => {
  const SOURCE_TRANSCRIPT = "ZZZ_WHOLE_SOURCE_TRANSCRIPT_BLOB_ZZZ";

  async function seedSession(over: {
    chosenHook?: string | null;
    variants?: string[];
    chosenVariantIndex?: number | null;
    withPerBeatLayout?: boolean;
  } = {}) {
    migrate();
    const channelId = newId();
    const videoId = newId();
    const sessionId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@aitools-${sessionId}`, trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `remix-${sessionId}`,
      url: "https://example.com/reel", caption: "the AI tool nobody talks about",
      postedAt: FIXED_DATE, durationSec: 34, viewCount: 2_400_000, outlierScore: 12.4, firstSeenAt: FIXED_DATE,
    });
    await db.insert(tables.transcripts).values({
      videoId, text: SOURCE_TRANSCRIPT, source: "whisper-local", createdAt: FIXED_DATE,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId,
      hookType: "curiosity-gap",
      structureSegments: [
        { label: "Hook", startSec: 0, endSec: 3, note: "opens with a direct claim", transcript: "nobody is talking about this tool" },
        { label: "Payoff", startSec: 3, endSec: 34, note: "shows the before and after", transcript: "and here is what it did to my week" },
      ],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut"],
      whyItWorked: "cold open plus pacing",
      model: "claude-sonnet-5",
      createdAt: FIXED_DATE,
      ...(over.withPerBeatLayout
        ? {
            layout: [
              {
                startSec: 0,
                endSec: 3,
                label: "Hook",
                onScreenText: { value: "NOBODY TALKS ABOUT THIS", fromFramesSec: [1] },
                animation: { value: "hard shake", fromFramesSec: [1] },
                demoCursor: { value: null, fromFramesSec: [] },
                // A value citing no frame is not a reading: it must not reach the prompt.
                toolDemo: { value: "Figma", fromFramesSec: [] },
                textPosition: { value: "upper third", fromFramesSec: [1] },
                voicePace: { value: null, fromFramesSec: [] },
              },
            ],
            framesSampled: 6,
            frameModel: "claude-code/watch",
            framePassAt: FIXED_DATE,
          }
        : {}),
    });
    await db.insert(tables.remixSessions).values({
      id: sessionId,
      sourceVideoId: videoId,
      stage: "script",
      topic: "the AI tool nobody talks about",
      targetLengthSec: 45,
      chosenHook: over.chosenHook === undefined ? "Everyone is sleeping on this one tool." : over.chosenHook,
      variants: over.variants ?? ["variant one text", "VARIANT_TWO_TEXT", "variant three text"],
      chosenVariantIndex: over.chosenVariantIndex === undefined ? 1 : over.chosenVariantIndex,
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    });
    return { sessionId, videoId };
  }

  test("returns null when the session doesn't exist", async () => {
    migrate();
    expect(await buildRemixPrompt(newId())).toBeNull();
  });

  test("carries the chosen hook, the per-beat transcript, the per-beat layout, and the chosen variant", async () => {
    const { sessionId } = await seedSession({ withPerBeatLayout: true });
    const prompt = await buildRemixPrompt(sessionId);

    expect(prompt).toContain("Everyone is sleeping on this one tool.");
    expect(prompt).toContain("nobody is talking about this tool"); // a beat's verbatim words
    expect(prompt).toContain("## Layout per beat");
    expect(prompt).toContain("NOBODY TALKS ABOUT THIS");
    expect(prompt).toContain("VARIANT_TWO_TEXT"); // the variant they picked, not variants[0]
    expect(prompt).not.toContain("variant one text");
  });

  test("does not dump the whole source transcript; the per-beat quotes are the transcript it carries", async () => {
    const { sessionId } = await seedSession();
    const prompt = await buildRemixPrompt(sessionId);
    expect(prompt).not.toContain(SOURCE_TRANSCRIPT);
  });

  test("a layout value citing no source frame is a guess and never reaches the prompt", async () => {
    const { sessionId } = await seedSession({ withPerBeatLayout: true });
    const prompt = await buildRemixPrompt(sessionId);
    expect(prompt).not.toContain("Figma");
  });

  test("names a missing hook and a missing pick instead of inventing either", async () => {
    const { sessionId } = await seedSession({ chosenHook: null, chosenVariantIndex: null });
    const prompt = await buildRemixPrompt(sessionId);

    expect(prompt).toContain("(no hook chosen)");
    expect(prompt).toContain("(no variant picked; 3 written.");
    // The unpicked variants are not smuggled in under the Script heading.
    expect(prompt).not.toContain("VARIANT_TWO_TEXT");
  });

  test("says the frame pass has not run rather than leaving the layout section blank", async () => {
    const { sessionId } = await seedSession();
    const prompt = await buildRemixPrompt(sessionId);
    expect(prompt).toContain("(frame pass not run)");
  });
});
