import { beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { LlmClient } from "@/server/llm/client";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let generateIdea: typeof import("./ideas")["generateIdea"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ generateIdea } = await import("./ideas"));
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
});
