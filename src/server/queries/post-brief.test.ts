import { beforeAll, beforeEach, describe, expect, test } from "vitest";

// Test-DB pattern (see planned-posts.test.ts): the db singleton binds CROWSNEST_DB_PATH
// at import, so env must be set in beforeAll BEFORE any dynamic import of "@/server/db".
let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getPlannedPostById: typeof import("./planned-posts")["getPlannedPostById"];
let getPostBrief: typeof import("./post-brief")["getPostBrief"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // getPostsWithLatestInsights (own-channel.ts, pulled in via planned-posts.ts) reaches
  // graph/client.ts -> config.ts, which validates the full env schema at import time.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getPlannedPostById } = await import("./planned-posts"));
  ({ getPostBrief } = await import("./post-brief"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
  await db.delete(tables.scripts);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

/** A remix session over `videoId`, with an analysis carrying one beat and its verbatim
 *  transcript, so the brief has something real to follow the link to. */
async function seedRemixSession(videoId: string): Promise<string> {
  const sessionId = newId();
  await db.insert(tables.videoAnalyses).values({
    videoId,
    hookType: "curiosity-gap",
    structureSegments: [{ label: "Hook", startSec: 0, endSec: 3, note: "opens cold", transcript: "stop scrolling for a second" }],
    formatTags: [],
    styleTags: [],
    whyItWorked: "cold open",
    model: "claude-sonnet-5",
    createdAt: nowIso(),
  });
  await db.insert(tables.remixSessions).values({
    id: sessionId,
    sourceVideoId: videoId,
    stage: "finish",
    chosenHook: "Everyone is sleeping on this.",
    variants: ["one", "two"],
    chosenVariantIndex: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return sessionId;
}

async function seedScript(content = "HOOK: ...\nBUILD: ...\nCTA: ..."): Promise<string> {
  const id = newId();
  await db.insert(tables.scripts).values({ id, title: "A Script", content, status: "draft", createdAt: nowIso(), updatedAt: nowIso() });
  return id;
}

async function seedChannel(): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({
    id: channelId,
    platform: "instagram",
    handle: `@studio-test-${channelId}`,
    trackedSince: nowIso(),
  });
  return channelId;
}

async function seedVideo(channelId: string): Promise<string> {
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `studio-${videoId}`,
    url: "https://example.com/v",
    postedAt: nowIso(),
    firstSeenAt: nowIso(),
  });
  return videoId;
}

describe("getPlannedPostById", () => {
  test("returns the row with videoKind and the script join, for a known id", async () => {
    const scriptId = await seedScript();
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "draft", title: "Studio subject", scriptId, videoKind: "talking-head", createdAt: nowIso(), updatedAt: nowIso(),
    });

    const row = await getPlannedPostById(id);
    expect(row?.title).toBe("Studio subject");
    expect(row?.videoKind).toBe("talking-head");
    expect(row?.scriptTitle).toBe("A Script");
    expect(row?.scriptContent).toBe("HOOK: ...\nBUILD: ...\nCTA: ...");
  });

  test("returns null for an unknown id", async () => {
    expect(await getPlannedPostById("does-not-exist")).toBeNull();
  });
});

describe("getPostBrief", () => {
  test("returns the plan plus a video when a sourceVideoId is set", async () => {
    const channelId = await seedChannel();
    const videoId = await seedVideo(channelId);
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "draft", title: "Has a source", videoKind: "explainer", sourceVideoId: videoId, createdAt: nowIso(), updatedAt: nowIso(),
    });

    const brief = await getPostBrief(id);
    expect(brief?.plan.title).toBe("Has a source");
    expect(brief?.plan.videoKind).toBe("explainer");
    expect(brief?.video?.item.videoId).toBe(videoId);
  });

  test("returns a null video when the plan has no sourceVideoId", async () => {
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "draft", title: "No source", createdAt: nowIso(), updatedAt: nowIso(),
    });

    const brief = await getPostBrief(id);
    expect(brief?.plan.title).toBe("No source");
    expect(brief?.video).toBeNull();
  });

  test("returns null for an unknown id", async () => {
    expect(await getPostBrief("does-not-exist")).toBeNull();
  });

  test("follows remixSessionId to the session and the analysis of the video that session remixed", async () => {
    const channelId = await seedChannel();
    const videoId = await seedVideo(channelId);
    const sessionId = await seedRemixSession(videoId);
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "draft", title: "From a remix", sourceVideoId: videoId, remixSessionId: sessionId,
      createdAt: nowIso(), updatedAt: nowIso(),
    });

    const brief = await getPostBrief(id);
    expect(brief?.remix?.session.chosenHook).toBe("Everyone is sleeping on this.");
    expect(brief?.remix?.session.chosenVariantIndex).toBe(1);
    expect(brief?.remix?.sourceAnalysis?.structureSegments[0].transcript).toBe("stop scrolling for a second");
  });

  test("remix is null when the plan carries no remixSessionId", async () => {
    const id = newId();
    await db.insert(tables.plannedPosts).values({
      id, state: "draft", title: "Hand made", createdAt: nowIso(), updatedAt: nowIso(),
    });
    expect((await getPostBrief(id))?.remix).toBeNull();
  });
});
