import { beforeAll, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { LlmClient } from "@/server/llm/client";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let generateIdea: typeof import("./ideas")["generateIdea"];
let generateIdeasForNewOutliers: typeof import("./ideas")["generateIdeasForNewOutliers"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ generateIdea, generateIdeasForNewOutliers } = await import("./ideas"));
  migrate();
});

/** Mirrors remix.test.ts's fakeLlm — `generateParsed` returns a fixed {concept, angle}. */
function fakeLlm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateText: vi.fn().mockResolvedValue(""),
    generateParsed: vi.fn().mockResolvedValue({ concept: "A one-line concept", angle: "A short angle" }),
    ping: vi.fn(),
    ...overrides,
  };
}

/** Fresh channel + analyzed video, unique per test — same shape as remix.test.ts's seedVideo. */
async function seedAnalyzedVideo(opts: { handle: string; score: number }) {
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: opts.handle, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `ideas-${videoId}`,
    url: "https://example.com/source",
    caption: "the topic nobody talks about",
    postedAt: now,
    durationSec: 30,
    viewCount: 100_000,
    outlierScore: opts.score,
    firstSeenAt: now,
  });
  await db.insert(tables.videoAnalyses).values({
    videoId,
    hookType: "curiosity-gap",
    structureSegments: [
      { label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question" },
      { label: "Build", startSec: 3, endSec: 20, note: "explains the mechanism" },
    ],
    formatTags: ["talking-head"],
    styleTags: ["fast-cut"],
    whyItWorked: "strong hook",
    summary: "a creator explains a counterintuitive mechanism",
    model: "claude-sonnet-5",
    createdAt: now,
  });
  return { channelId, videoId };
}

/** One fresh channel with N analyzed videos, one per score in `scores` — same shape as
 *  `seedAnalyzedVideo` above, just sharing a single channel so the auto pass has more
 *  than one candidate to filter. */
async function seedChannelWithAnalyzed(scores: number[]) {
  const channelId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@auto-${channelId}`, trackedSince: now });

  const videoIds: string[] = [];
  for (const score of scores) {
    const videoId = newId();
    videoIds.push(videoId);
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: `ideas-auto-${videoId}`,
      url: "https://example.com/source",
      caption: "the topic nobody talks about",
      postedAt: now,
      durationSec: 30,
      viewCount: 100_000,
      outlierScore: score,
      firstSeenAt: now,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId,
      hookType: "curiosity-gap",
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question" }],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut"],
      whyItWorked: "strong hook",
      summary: "a creator explains a counterintuitive mechanism",
      model: "claude-sonnet-5",
      createdAt: now,
    });
  }
  return { channelId, videoIds };
}

/** One fresh channel with N analyzed videos, `score` and `postedAt` set independently
 *  per video so a test can prove the candidate query orders by score, not recency. */
async function seedChannelWithAnalyzedAt(entries: { score: number; postedAt: string }[]) {
  const channelId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@auto-${channelId}`, trackedSince: now });

  const videoIds: string[] = [];
  for (const entry of entries) {
    const videoId = newId();
    videoIds.push(videoId);
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: `ideas-auto-${videoId}`,
      url: "https://example.com/source",
      caption: "the topic nobody talks about",
      postedAt: entry.postedAt,
      durationSec: 30,
      viewCount: 100_000,
      outlierScore: entry.score,
      firstSeenAt: now,
    });
    await db.insert(tables.videoAnalyses).values({
      videoId,
      hookType: "curiosity-gap",
      structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "cold open with a question" }],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut"],
      whyItWorked: "strong hook",
      summary: "a creator explains a counterintuitive mechanism",
      model: "claude-sonnet-5",
      createdAt: now,
    });
  }
  return { channelId, videoIds };
}

describe("generateIdeasForNewOutliers", () => {
  test("the auto pass covers analyzed outliers at or above the threshold", async () => {
    const { channelId } = await seedChannelWithAnalyzed([5, 2, 4]);
    await generateIdeasForNewOutliers(channelId, { threshold: 3, cap: 20, llm: fakeLlm() });
    const rows = await db.select().from(tables.idea);
    expect(rows.length).toBe(2);
  });

  test("the cap keeps the top scorers, not the newest posts", async () => {
    // Deliberately disagree: the highest score (90) is the oldest post, and the newest
    // post (20) has the lowest score, so a newest-first cap and a score-first cap pick
    // different videos.
    const { channelId, videoIds } = await seedChannelWithAnalyzedAt([
      { score: 50, postedAt: "2026-08-05T00:00:00.000Z" }, // 2nd by score, middle by recency
      { score: 90, postedAt: "2026-08-01T00:00:00.000Z" }, // top by score, oldest by recency
      { score: 20, postedAt: "2026-08-08T00:00:00.000Z" }, // lowest by score, newest by recency
    ]);
    const [midId, topId, lowId] = videoIds;

    await generateIdeasForNewOutliers(channelId, { threshold: 1, cap: 2, llm: fakeLlm() });

    const rows = await db.select().from(tables.idea).where(inArray(tables.idea.sourceVideoId, videoIds));
    const ideaVideoIds = rows.map((r) => r.sourceVideoId).sort();
    expect(ideaVideoIds).toEqual([midId, topId].sort());
    expect(ideaVideoIds).not.toContain(lowId);
  });
});

describe("generateIdea", () => {
  test("writes one idea from the analysis and persona", async () => {
    const { videoId } = await seedAnalyzedVideo({ handle: "@oren", score: 16.2 });
    const { created } = await generateIdea(videoId, { llm: fakeLlm() });
    expect(created).toBe(true);

    const [row] = await db.select().from(tables.idea).where(eq(tables.idea.sourceVideoId, videoId));
    expect(row.status).toBe("inbox");
    expect(row.scoreAtCreation).toBeCloseTo(16.2);
  });

  test("a second generate on the same video updates, not duplicates", async () => {
    const { videoId } = await seedAnalyzedVideo({ handle: "@oren2", score: 16.2 });
    await generateIdea(videoId, { llm: fakeLlm() });
    const second = await generateIdea(videoId, { llm: fakeLlm() });
    expect(second.created).toBe(false);

    const rows = await db.select().from(tables.idea).where(eq(tables.idea.sourceVideoId, videoId));
    expect(rows.length).toBe(1);
  });

  test("never throws on a malformed LLM reply", async () => {
    const { videoId } = await seedAnalyzedVideo({ handle: "@oren3", score: 5 });
    const badLlm = fakeLlm({ generateParsed: vi.fn().mockRejectedValue(new Error("bad structured output")) });
    const result = await generateIdea(videoId, { llm: badLlm });
    expect(result).toEqual({ id: "", created: false });
  });

  test("does not rewrite an idea the user has already shortlisted or scripted", async () => {
    const { videoId } = await seedAnalyzedVideo({ handle: "@oren4", score: 8 });
    const first = await generateIdea(videoId, {
      llm: fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ concept: "First concept", angle: "First angle" }) }),
    });
    expect(first.created).toBe(true);

    await db
      .update(tables.idea)
      .set({ status: "shortlisted", notes: "already picked this one" })
      .where(eq(tables.idea.id, first.id));

    const second = await generateIdea(videoId, {
      llm: fakeLlm({ generateParsed: vi.fn().mockResolvedValue({ concept: "Second concept", angle: "Second angle" }) }),
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const [row] = await db.select().from(tables.idea).where(eq(tables.idea.sourceVideoId, videoId));
    expect(row.status).toBe("shortlisted");
    expect(row.concept).toBe("First concept");
    expect(row.angle).toBe("First angle");
    expect(row.notes).toBe("already picked this one");
  });
});
