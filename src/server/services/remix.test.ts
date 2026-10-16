import { beforeAll, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getOrCreateSession: typeof import("./remix")["getOrCreateSession"];
let updateStage: typeof import("./remix")["updateStage"];
let buildResearch: typeof import("./remix")["buildResearch"];
let saveScript: typeof import("./remix")["saveScript"];
let saveAgentScript: typeof import("./remix")["saveAgentScript"];
let seedSessionFromIdea: typeof import("./remix")["seedSessionFromIdea"];
let finishRemix: typeof import("./remix")["finishRemix"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getOrCreateSession, updateStage, buildResearch, saveScript, saveAgentScript, seedSessionFromIdea, finishRemix } =
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
  test("makes no model call and embeds the top-5 similar outliers", async () => {
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

  test("no transcript / no analysis: still returns cleanly with nulls", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);

    const notes = await buildResearch(session.id);
    expect(notes.sourceAnalysis).toBeNull();
    expect(notes.transcriptExcerpt).toBeNull();
    expect(notes.similar).toEqual([]);
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

  test("finishing again re-attaches the current chosen variant after a regenerate invalidated the earlier save", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["variant zero", "variant one", "variant two"] });
    const { scriptId: staleScriptId } = await saveScript(session.id, "variant zero", "Stale Title", 0);

    const first = await finishRemix(session.id);
    expect(first.scriptId).toBe(staleScriptId);

    // Regenerate all variants (fresh text) and pick a different one, without saving
    // again — mirrors the live-db scenario: the plan already exists, the session moves
    // on, and the attached script's content ends up matching none of the current
    // variants.
    await updateStage(session.id, { variants: ["fresh zero", "fresh one", "fresh two"], chosenVariantIndex: 1 });

    const second = await finishRemix(session.id);

    expect(second.created).toBe(false); // reuses the plan `first` created, no duplicate
    expect(second.postId).toBe(first.postId);
    expect(second.scriptId).not.toBe(staleScriptId);

    const [attached] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, second.scriptId!));
    expect(attached.content).toBe("fresh one"); // variants[chosenVariantIndex], not the stale save

    const [plan] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, second.postId));
    expect(plan.scriptId).toBe(second.scriptId); // the existing plan's script_id was refreshed

    // Idempotency: nothing changed since, so a third finish must not create a second
    // plan, nor a second reconciled script for the same chosen text.
    const scriptsBefore = await db.select().from(tables.scripts).where(eq(tables.scripts.remixSessionId, session.id));
    const third = await finishRemix(session.id);
    const scriptsAfter = await db.select().from(tables.scripts).where(eq(tables.scripts.remixSessionId, session.id));

    expect(third.created).toBe(false);
    expect(third.postId).toBe(first.postId);
    expect(third.scriptId).toBe(second.scriptId);
    expect(scriptsAfter).toHaveLength(scriptsBefore.length);

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

describe("agent-written stages", () => {
  test("a stage saved by the agent renders without a model call", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { chosenHook: "Stop posting at 9am.", hookOptions: ["Stop posting at 9am.", "9am is a myth."] });
    await updateStage(session.id, { outline: { beats: [{ label: "Hook", content: "the 9am myth", targetSec: 3 }] } });
    await saveAgentScript(session.id, "Stop posting at 9am. Here is why.", "Posting time");

    const read = await getOrCreateSession(videoId);

    expect(read.chosenHook).toBe("Stop posting at 9am.");
    expect(read.hookOptions).toEqual(["Stop posting at 9am.", "9am is a myth."]);
    expect(read.outline).toEqual({ beats: [{ label: "Hook", content: "the 9am myth", targetSec: 3 }] });
    expect(read.variants).toEqual(["Stop posting at 9am. Here is why."]);
    expect(read.chosenVariantIndex).toBe(0);
  });

  test("concurrent agent saves keep both variants", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await Promise.all([saveAgentScript(session.id, "one", "1"), saveAgentScript(session.id, "two", "2")]);

    const read = await getOrCreateSession(videoId);
    expect(read.variants).toEqual(["one", "two"]);
    expect(read.chosenVariantIndex).toBe(1);
  });

  test("a retried agent save with the same text returns the same script and no duplicate", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    const first = await saveAgentScript(session.id, "same", "t");
    await saveAgentScript(session.id, "other", "t");
    const retry = await saveAgentScript(session.id, "same", "t");

    const read = await getOrCreateSession(videoId);
    const rows = await db.select().from(tables.scripts).where(eq(tables.scripts.remixSessionId, session.id));
    expect(retry.scriptId).toBe(first.scriptId);
    expect(read.variants).toEqual(["same", "other"]);
    expect(read.chosenVariantIndex).toBe(0);
    expect(rows).toHaveLength(2);
  });

  test("a failed script insert leaves no orphan variant", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    db.run(sql`CREATE TRIGGER fail_scripts BEFORE INSERT ON scripts BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    try {
      await expect(saveAgentScript(session.id, "lost", "t")).rejects.toThrow("boom");
    } finally {
      db.run(sql`DROP TRIGGER fail_scripts`);
    }
    expect((await getOrCreateSession(videoId)).variants).toBeNull();
  });

  test("an agent save after older variants is the script finish attaches", async () => {
    const { videoId } = await seedVideo();
    const session = await getOrCreateSession(videoId);
    await updateStage(session.id, { variants: ["old take"], chosenVariantIndex: 0 });
    await saveAgentScript(session.id, "new agent take", "New");

    const { scriptId } = await finishRemix(session.id);
    const [row] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId!));

    expect(row.content).toBe("new agent take");
  });
});
