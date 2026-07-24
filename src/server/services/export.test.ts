import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let buildVideoPrompt: typeof import("./export")["buildVideoPrompt"];
let buildScriptPrompt: typeof import("./export")["buildScriptPrompt"];

// Fixed (not nowIso()) so postedAt/createdAt never vary between runs — required for
// the snapshot tests below to stay stable.
const FIXED_DATE = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ buildVideoPrompt, buildScriptPrompt } = await import("./export"));
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

describe("buildScriptPrompt", () => {
  test("returns null when the script doesn't exist", async () => {
    migrate();
    const result = await buildScriptPrompt(newId());
    expect(result).toBeNull();
  });

  test("snapshot: script linked to hook/style vault items and an analyzed source video", async () => {
    migrate();
    const channelId = newId();
    const videoId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@formfirst.fit", trackedSince: FIXED_DATE });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: "export-script-source",
      url: "https://example.com/source", caption: "source video caption",
      postedAt: FIXED_DATE, durationSec: 30, viewCount: 300_000, outlierScore: 9.1, firstSeenAt: FIXED_DATE,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId, hookType: "negative-warning",
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "warns of a mistake" }],
      formatTags: ["talking-head"], styleTags: ["fast-cut"],
      whyItWorked: "The warning framing creates urgency.", model: "claude-sonnet-5", createdAt: FIXED_DATE,
    });

    const hookId = newId();
    const styleId = newId();
    await db.insert(tables.vaultItems).values([
      { id: hookId, type: "hook", title: "Negative Warning Hook", templateText: "you're falling behind on {topic}", tags: ["warning"], createdAt: FIXED_DATE },
      { id: styleId, type: "style", title: "Fast-Cut Listicle", templateText: "5 beats, CTA at end", tags: ["editing", "listicle"], createdAt: FIXED_DATE },
    ]);

    const scriptId = newId();
    await db.insert(tables.scripts).values({
      id: scriptId,
      title: "My Remixed Script",
      content: "HOOK: you're falling behind...\nBUILD: here's why...\nCTA: follow for more.",
      sourceVideoId: videoId,
      hookVaultItemId: hookId,
      styleVaultItemId: styleId,
      status: "draft",
      createdAt: FIXED_DATE,
      updatedAt: FIXED_DATE,
    });

    const result = await buildScriptPrompt(scriptId);
    expect(result).toMatchSnapshot();
  });

  test("graceful degradation: standalone script with no source video or vault links", async () => {
    migrate();
    const scriptId = newId();
    await db.insert(tables.scripts).values({
      id: scriptId, title: "Standalone Script", content: "just a draft, no links",
      status: "draft", createdAt: nowIso(), updatedAt: nowIso(),
    });

    const result = await buildScriptPrompt(scriptId);
    expect(result).not.toBeNull();
    expect(result).toContain("No source video linked.");
    expect(result).toContain("No hook template linked");
    expect(result).toContain("No style template linked");
    expect(result).toContain("just a draft, no links");
  });
});
