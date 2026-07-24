import { beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { LlmClient } from "@/server/llm/client";
import { HookOptionsSchema, OutlineSchema } from "@/server/llm/schemas";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getOrCreateSession: typeof import("./remix")["getOrCreateSession"];
let updateStage: typeof import("./remix")["updateStage"];
let buildResearch: typeof import("./remix")["buildResearch"];
let generateHooks: typeof import("./remix")["generateHooks"];
let generateOutline: typeof import("./remix")["generateOutline"];
let generateVariants: typeof import("./remix")["generateVariants"];
let saveScript: typeof import("./remix")["saveScript"];
let quickRemix: typeof import("./remix")["quickRemix"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOrCreateSession, updateStage, buildResearch, generateHooks, generateOutline, generateVariants, saveScript, quickRemix } =
    await import("./remix"));
});

const FAKE_ANALYSIS = {
  hookType: "curiosity-gap",
  structureSegments: [
    { label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question" },
    { label: "Build", startSec: 3, endSec: 20, note: "explains the mechanism" },
  ],
  formatTags: ["talking-head"],
  styleTags: ["fast-cut"],
  whyItWorked: "strong hook",
};

function fakeLlm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateText: vi.fn().mockResolvedValue("a generated script"),
    generateParsed: vi.fn().mockResolvedValue({ hooks: ["h1", "h2", "h3", "h4", "h5"] }),
    ...overrides,
  };
}

/** Fresh channel + video (+ optional transcript/analysis), unique per test. */
async function seedVideo(opts: { withTranscript?: boolean; withAnalysis?: boolean } = {}) {
  migrate();
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@remix-test-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `remix-${videoId}`,
    url: "https://example.com/source", caption: "the topic nobody talks about", postedAt: now,
    durationSec: 30, viewCount: 100_000, outlierScore: 8, firstSeenAt: now,
  });
  if (opts.withTranscript) {
    await db.insert(tables.transcripts).values({ videoId, text: "a".repeat(600), source: "whisper-local", createdAt: now });
  }
  if (opts.withAnalysis) {
    await db.insert(tables.videoAnalyses).values({ videoId, ...FAKE_ANALYSIS, model: "claude-sonnet-5", createdAt: now });
  }
  return { channelId, videoId };
}

describe("getOrCreateSession", () => {
  test("reuses the latest session for a video; a different video gets its own", async () => {
    const { videoId } = await seedVideo();
    const first = await getOrCreateSession(videoId);
    const second = await getOrCreateSession(videoId);
    expect(second.id).toBe(first.id);
    expect(second.stage).toBe("prompt");

    const { videoId: otherVideoId } = await seedVideo();
    const third = await getOrCreateSession(otherVideoId);
    expect(third.id).not.toBe(first.id);
  });
});

describe("updateStage", () => {
  test("persists whichever fields are given and bumps updatedAt", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const before = session.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateStage(session.id, { topic: "my topic", targetLengthSec: 60 });

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.topic).toBe("my topic");
    expect(row.targetLengthSec).toBe(60);
    expect(row.updatedAt).not.toBe(before);
  });
});

describe("buildResearch", () => {
  test("makes zero llm calls (works with no ANTHROPIC_API_KEY set) and embeds the top-5 similar outliers", async () => {
    delete process.env.ANTHROPIC_API_KEY; // if buildResearch ever called getLlm(), this would throw
    const { videoId } = await seedVideo({ withTranscript: true, withAnalysis: true });
    const session = await getOrCreateSession(videoId);

    // 6 other analyzed videos sharing the source's hookType (score 3 each) so a
    // deterministic top-5 (by outlierScore desc, since scores tie) is truncated from 6.
    for (let i = 0; i < 6; i++) {
      const { videoId: otherId } = await seedVideo({ withAnalysis: true });
      await db.update(tables.videos).set({ outlierScore: 100 - i }).where(eq(tables.videos.id, otherId));
    }

    const notes = await buildResearch(session.id);

    expect(notes.sourceAnalysis).toEqual(FAKE_ANALYSIS);
    expect(notes.transcriptExcerpt).not.toBeNull();
    expect(notes.transcriptExcerpt!.length).toBeLessThan(600); // truncated from the 600-char fixture
    expect(notes.facts).toBe("");
    expect(notes.similar).toHaveLength(5); // top-5, not all 6 candidates
    expect(notes.similar.map((s) => s.outlierScore)).toEqual([100, 99, 98, 97, 96]); // highest-scored 5

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.researchNotes).not.toBeNull();
  });

  test("no transcript / no analysis: still returns cleanly with nulls, zero llm calls", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);

    const notes = await buildResearch(session.id);
    expect(notes.sourceAnalysis).toBeNull();
    expect(notes.transcriptExcerpt).toBeNull();
    expect(notes.similar).toEqual([]);
  });
});

describe("generateHooks", () => {
  test("persists 5 hooks from the llm's HookOptionsSchema response", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    const hooks = await generateHooks(session.id, { llm });

    expect(hooks).toEqual(["h1", "h2", "h3", "h4", "h5"]);
    expect(llm.generateParsed).toHaveBeenCalledTimes(1);
    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.schema).toBe(HookOptionsSchema);

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.hookOptions).toEqual(["h1", "h2", "h3", "h4", "h5"]);
  });

  test("uses the source video's hookType as the pattern when no vaultItemId is given", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    await generateHooks(session.id, { llm });

    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("curiosity-gap");
  });

  test("uses the given Vault hook item's templateText as the pattern when vaultItemId is set", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    const vaultItemId = newId();
    await db.insert(tables.vaultItems).values({
      id: vaultItemId, type: "hook", title: "Custom Hook", templateText: "a very distinctive template pattern {topic}",
      tags: [], createdAt: nowIso(),
    });

    await generateHooks(session.id, { llm, vaultItemId });

    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("a very distinctive template pattern {topic}");
    expect(call.user).not.toContain("curiosity-gap");
  });
});

describe("generateOutline", () => {
  test("persists an outline from the llm's OutlineSchema response, using source structure by default", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const outlineFixture = { beats: [{ label: "Hook", content: "open strong", targetSec: 3 }] };
    const llm = fakeLlm({ generateParsed: vi.fn().mockResolvedValue(outlineFixture) });

    const outline = await generateOutline(session.id, { llm });

    expect(outline).toEqual(outlineFixture);
    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.schema).toBe(OutlineSchema);
    expect(call.user).toContain("Build (3-20s)"); // source structureSegments summary

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(JSON.parse(row.outline!)).toEqual(outlineFixture);
  });

  test("uses the session's Vault style item templateText when styleVaultItemId is set", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const vaultItemId = newId();
    await db.insert(tables.vaultItems).values({
      id: vaultItemId, type: "style", title: "Custom Style", templateText: "a very distinctive style description",
      tags: [], createdAt: nowIso(),
    });
    await updateStage(session.id, { styleVaultItemId: vaultItemId });

    const llm = fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ beats: [] }) });
    await generateOutline(session.id, { llm });

    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("a very distinctive style description");
  });
});

describe("generateVariants", () => {
  test("isolates a rejected variant to {error} at its own index; only successes are persisted", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);

    const generateText = vi
      .fn()
      .mockResolvedValueOnce("script one")
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce("script three");
    const llm = fakeLlm({ generateText });

    const results = await generateVariants(session.id, { llm });

    expect(results).toHaveLength(3);
    expect(results[0]).toBe("script one");
    expect(results[1]).toEqual({ error: "rate limited" });
    expect(results[2]).toBe("script three");

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.variants).toEqual(["script one", "script three"]);
  });

  test("count option controls how many variants are requested", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    const results = await generateVariants(session.id, { llm, count: 5 });

    expect(results).toHaveLength(5);
    expect(llm.generateText).toHaveBeenCalledTimes(5);
  });
});

describe("saveScript", () => {
  test("links source video and style vault item ids; hookVaultItemId stays null (no such column to link from)", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const styleVaultItemId = newId();
    await db.insert(tables.vaultItems).values({
      id: styleVaultItemId, type: "style", title: "Style", templateText: "text", tags: [], createdAt: nowIso(),
    });
    await updateStage(session.id, { styleVaultItemId, chosenHook: "my chosen hook" });

    const { scriptId } = await saveScript(session.id, "HOOK: ...\nBUILD: ...", "My Script");

    const [row] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId));
    expect(row.title).toBe("My Script");
    expect(row.content).toBe("HOOK: ...\nBUILD: ...");
    expect(row.sourceVideoId).toBe(videoId);
    expect(row.styleVaultItemId).toBe(styleVaultItemId);
    expect(row.hookVaultItemId).toBeNull();
    expect(row.status).toBe("draft");
  });
});

describe("quickRemix", () => {
  test("runs research -> hooks (auto-picks first) -> outline -> variants sequentially, ending at stage=script with every field populated", async () => {
    const { videoId } = await seedVideo({ withTranscript: true, withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { topic: "my remix topic", niche: "my niche", targetLengthSec: 30 });

    const outlineFixture = { beats: [{ label: "Hook", content: "open", targetSec: 3 }] };
    const llm = fakeLlm({
      generateParsed: vi.fn().mockImplementation(async (opts: { schema: unknown }) => {
        if (opts.schema === HookOptionsSchema) return { hooks: ["first hook", "second hook", "third hook"] };
        if (opts.schema === OutlineSchema) return outlineFixture;
        throw new Error("unexpected schema in test fake");
      }),
      generateText: vi.fn().mockResolvedValue("a full script"),
    });

    await quickRemix(session.id, llm);

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.stage).toBe("script");
    expect(row.chosenHook).toBe("first hook");
    expect(row.hookOptions).toEqual(["first hook", "second hook", "third hook"]);
    expect(row.researchNotes).not.toBeNull();
    expect(JSON.parse(row.outline!)).toEqual(outlineFixture);
    expect(row.variants).toHaveLength(3);
    expect(row.variants!.every((v) => v === "a full script")).toBe(true);
  });
});
