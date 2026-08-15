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
let seedSessionFromIdea: typeof import("./remix")["seedSessionFromIdea"];
let finishRemix: typeof import("./remix")["finishRemix"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOrCreateSession, updateStage, buildResearch, generateHooks, generateOutline, generateVariants, saveScript, quickRemix, seedSessionFromIdea, finishRemix } =
    await import("./remix"));
});

const FAKE_ANALYSIS = {
  hookType: "curiosity-gap",
  structureSegments: [
    { label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question", transcript: "wait, do this before you post" },
    { label: "Build", startSec: 3, endSec: 20, note: "explains the mechanism", transcript: "the reason it works is retention" },
  ],
  formatTags: ["talking-head"],
  styleTags: ["fast-cut"],
  whyItWorked: "strong hook",
};

function fakeLlm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateText: vi.fn().mockResolvedValue("a generated script"),
    generateParsed: vi.fn().mockResolvedValue({ hooks: ["h1", "h2", "h3", "h4", "h5"] }),
    ping: vi.fn(),
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

/** Fresh idea row (+ its source video), unique per test — mirrors seedVideo's shape. */
async function seedIdea(opts: { concept: string }) {
  const { videoId } = await seedVideo();
  const ideaId = newId();
  const now = nowIso();
  await db.insert(tables.idea).values({
    id: ideaId,
    sourceVideoId: videoId,
    concept: opts.concept,
    angle: "a short angle",
    status: "inbox",
    scoreAtCreation: 8,
    createdAt: now,
    updatedAt: now,
  });
  return { ideaId, videoId };
}

describe("seedSessionFromIdea", () => {
  test("createScriptFromIdea seeds a remix session and marks the idea scripted", async () => {
    const { ideaId, videoId } = await seedIdea({ concept: "Expose the synthetic swap" });
    const sessionId = await seedSessionFromIdea(ideaId);

    const [session] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, sessionId));
    expect(session.sourceVideoId).toBe(videoId);
    expect(session.topic).toContain("synthetic swap");

    const [idea] = await db.select().from(tables.idea).where(eq(tables.idea.id, ideaId));
    expect(idea.status).toBe("scripted");
    expect(idea.remixSessionId).toBe(sessionId);
  });
});

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

  test("grounds the prompt in researchNotes.facts when present (review finding H1)", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, {
      researchNotes: { sourceAnalysis: null, transcriptExcerpt: null, similar: [], facts: "the giraffe eats 34kg of acacia daily" },
    });
    const llm = fakeLlm();

    await generateHooks(session.id, { llm });

    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("the giraffe eats 34kg of acacia daily");
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

  test("grounds the prompt in researchNotes.facts when present (review finding H1)", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, {
      researchNotes: { sourceAnalysis: null, transcriptExcerpt: null, similar: [], facts: "the giraffe eats 34kg of acacia daily" },
    });
    const llm = fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ beats: [] }) });

    await generateOutline(session.id, { llm });

    const call = (llm.generateParsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("the giraffe eats 34kg of acacia daily");
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

  test("grounds the prompt in researchNotes.facts when present (review finding H1)", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, {
      researchNotes: { sourceAnalysis: null, transcriptExcerpt: null, similar: [], facts: "the giraffe eats 34kg of acacia daily" },
    });
    const llm = fakeLlm();

    await generateVariants(session.id, { llm });

    const call = (llm.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.user).toContain("the giraffe eats 34kg of acacia daily");
  });

  test("index option merges a single regenerated slot into existing variants[] (read-modify-write), leaving siblings untouched (review finding M2)", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["script zero", "script one (stale)", "script two"] });

    const llm = fakeLlm({ generateText: vi.fn().mockResolvedValue("script one (regenerated)") });
    const results = await generateVariants(session.id, { llm, index: 1 });

    expect(results).toEqual(["script one (regenerated)"]);
    expect(llm.generateText).toHaveBeenCalledTimes(1); // exactly one call, not `count`-many

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.variants).toEqual(["script zero", "script one (regenerated)", "script two"]);
  });

  test("index option: a failing regenerate leaves the existing variants[] completely untouched (review finding M2)", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["script zero", "script one", "script two"] });

    const llm = fakeLlm({ generateText: vi.fn().mockRejectedValue(new Error("rate limited")) });
    const results = await generateVariants(session.id, { llm, index: 1 });

    expect(results).toEqual([{ error: "rate limited" }]);

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.variants).toEqual(["script zero", "script one", "script two"]);
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

  test("records the saved variant's index on the session, so the pick is not inferred later", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["variant one", "variant two", "variant three"] });

    await saveScript(session.id, "variant three", "My Script", 2);

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.chosenVariantIndex).toBe(2);
  });

  test("leaves chosenVariantIndex alone when no index is passed, rather than defaulting it to 0", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);

    await saveScript(session.id, "some text", "My Script");

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.chosenVariantIndex).toBeNull();
  });
});

describe("finishRemix", () => {
  test("creates an undated planned post linked to the session and advances the stage to finish", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { topic: "Three mistakes killing your reach.", targetLengthSec: 45 });
    const { scriptId } = await saveScript(session.id, "the script body", "Three Mistakes", 0);

    const result = await finishRemix(session.id);

    expect(result.created).toBe(true);
    expect(result.scriptId).toBe(scriptId);
    const [plan] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.postId));
    expect(plan.remixSessionId).toBe(session.id);
    expect(plan.scriptId).toBe(scriptId);
    expect(plan.sourceVideoId).toBe(videoId);
    expect(plan.targetLengthSec).toBe(45);
    // No date is invented: finishing a script is not a decision about when to post it.
    expect(plan.plannedDate).toBeNull();
    expect(plan.state).toBe("draft");

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.stage).toBe("finish");
  });

  test("is idempotent: a second finish reuses the plan it already linked instead of duplicating it", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await saveScript(session.id, "the script body", "Three Mistakes", 0);

    const first = await finishRemix(session.id);
    const second = await finishRemix(session.id);

    expect(second.created).toBe(false);
    expect(second.postId).toBe(first.postId);
    const plans = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.remixSessionId, session.id));
    expect(plans).toHaveLength(1);
  });

  test("finishes a session with no saved script, carrying a derived title and a null scriptId", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { topic: "Why your reach died. And how to fix it." });

    const result = await finishRemix(session.id);

    expect(result.scriptId).toBeNull();
    const [plan] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.postId));
    expect(plan.scriptId).toBeNull();
    expect(plan.title).toBe("Why your reach died");
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

/**
 * The run log (v1-scope.md, Remix studio P0): "remix_sessions records no per-run
 * history... without it a failed generation leaves no trace, and this pipeline fails
 * often." Every generation call — hooks, outline, variants — must leave one row behind
 * whether it succeeded or not, and a failure must never touch the field it was trying
 * to write.
 */
describe("remix run log", () => {
  async function runsFor(sessionId: string) {
    return db.select().from(tables.remixRuns).where(eq(tables.remixRuns.sessionId, sessionId));
  }

  test("generateHooks appends a success row and leaves no trace of failure", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    await generateHooks(session.id, { llm });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("hook");
    expect(runs[0].outcome).toBe("success");
    expect(runs[0].detail).toContain("5 hooks generated");
    expect(runs[0].errorMessage).toBeNull();
    expect(runs[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("a failed generateHooks call appends a failed row and leaves the previous hookOptions intact", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, {});
    // Seed a prior successful hook list directly, the way an earlier real call would.
    await db.update(tables.remixSessions).set({ hookOptions: ["old hook one", "old hook two", "old hook three"] }).where(eq(tables.remixSessions.id, session.id));

    const llm = fakeLlm({ generateParsed: vi.fn().mockRejectedValue(new Error("model unavailable")) });

    await expect(generateHooks(session.id, { llm })).rejects.toThrow("model unavailable");

    const [row] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, session.id));
    expect(row.hookOptions).toEqual(["old hook one", "old hook two", "old hook three"]);

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("hook");
    expect(runs[0].outcome).toBe("error");
    expect(runs[0].errorMessage).toBe("model unavailable");
  });

  test("generateOutline appends its row under stage 'style'", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ beats: [{ label: "Hook", content: "x", targetSec: 3 }] }) });

    await generateOutline(session.id, { llm });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("style");
    expect(runs[0].outcome).toBe("success");
  });

  test("generateVariants records success when at least one variant succeeds, with a count in the detail", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const generateText = vi.fn().mockResolvedValueOnce("script one").mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce("script three");
    const llm = fakeLlm({ generateText });

    await generateVariants(session.id, { llm });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe("script");
    expect(runs[0].outcome).toBe("success");
    expect(runs[0].detail).toBe("2 of 3 variants succeeded");
  });

  test("generateVariants records 'error' when every variant in the call fails", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm({ generateText: vi.fn().mockRejectedValue(new Error("down")) });

    await generateVariants(session.id, { llm, count: 2 });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("error");
    expect(runs[0].detail).toBe("0 of 2 variants succeeded");
  });

  test("a single-slot regenerate (index option) logs which slot, on both outcomes", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["a", "b", "c"] });

    const llm = fakeLlm({ generateText: vi.fn().mockResolvedValue("b (regenerated)") });
    await generateVariants(session.id, { llm, index: 1 });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].detail).toBe("variant 2 regenerated");
    expect(runs[0].outcome).toBe("success");
  });

  test("run log rows accumulate across calls and survive a restart back to stage 'prompt'", async () => {
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    await generateHooks(session.id, { llm });
    await generateOutline(session.id, { llm: fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ beats: [] }) }) });
    // Restart: the stepper's own reset action, which only ever touches `stage`.
    await updateStage(session.id, { stage: "prompt" });

    const runs = await runsFor(session.id);
    expect(runs).toHaveLength(2);
  });

  test("getRemixRunLog returns newest first", async () => {
    const { getRemixRunLog } = await import("../queries/remix-runs");
    const { videoId } = await seedVideo({ withAnalysis: true });
    const session = await getOrCreateSession(videoId);
    const llm = fakeLlm();

    await generateHooks(session.id, { llm });
    await generateOutline(session.id, { llm: fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ beats: [] }) }) });

    const log = await getRemixRunLog(session.id);
    expect(log).toHaveLength(2);
    expect(log[0].stage).toBe("style"); // the more recent call
    expect(log[1].stage).toBe("hook");
  });
});
