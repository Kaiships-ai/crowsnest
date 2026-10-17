import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let listIdeas: typeof import("./ideas")["listIdeas"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // Same env workaround saved-posts.test.ts and own-channel.test.ts need: getMedianViews
  // (channels.ts) pulls in settings/index.ts -> config.ts, which validates the full env
  // schema at import time.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ listIdeas } = await import("./ideas"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.idea);
  await db.delete(tables.videoAnalyses);
  await db.delete(tables.videos);
  await db.delete(tables.channelSnapshots);
  await db.delete(tables.channels);
});

function tsAt(minutesAgo: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, minutesAgo)).toISOString();
}

async function seedChannel(handle: string): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle, trackedSince: tsAt(0) });
  return id;
}

async function seedVideo(
  channelId: string,
  opts: { viewCount?: number | null; likeCount?: number | null; commentCount?: number | null; outlierScore?: number | null } = {}
): Promise<string> {
  const id = newId();
  await db.insert(tables.videos).values({
    id,
    channelId,
    platform: "instagram",
    externalId: `ext-${id}`,
    url: "https://example.com/post",
    caption: "a post",
    postedAt: tsAt(0),
    firstSeenAt: tsAt(0),
    viewCount: opts.viewCount ?? 10_000,
    likeCount: opts.likeCount ?? 500,
    commentCount: opts.commentCount ?? 50,
    outlierScore: opts.outlierScore ?? null,
  });
  return id;
}

async function seedIdea(
  videoId: string,
  opts: { status?: string; scoreAtCreation?: number | null; concept?: string; notes?: string | null } = {}
): Promise<string> {
  const id = newId();
  await db.insert(tables.idea).values({
    id,
    sourceVideoId: videoId,
    concept: opts.concept ?? "A concept",
    angle: "An angle",
    status: opts.status ?? "inbox",
    notes: opts.notes ?? null,
    scoreAtCreation: opts.scoreAtCreation ?? null,
    createdAt: tsAt(0),
    updatedAt: tsAt(0),
  });
  return id;
}

describe("listIdeas", () => {
  test("empty inbox returns an empty array, not an error", async () => {
    expect(await listIdeas({ tab: "inbox" })).toEqual([]);
  });

  test("filters to the requested tab: inbox excludes shortlisted, scripted and discarded", async () => {
    const channelId = await seedChannel("@ideas-filter");
    const inboxVideo = await seedVideo(channelId);
    const shortlistedVideo = await seedVideo(channelId);
    const scriptedVideo = await seedVideo(channelId);
    const discardedVideo = await seedVideo(channelId);

    const inboxId = await seedIdea(inboxVideo, { status: "inbox", concept: "Inbox idea" });
    await seedIdea(shortlistedVideo, { status: "shortlisted", concept: "Shortlisted idea" });
    await seedIdea(scriptedVideo, { status: "scripted", concept: "Scripted idea" });
    await seedIdea(discardedVideo, { status: "discarded", concept: "Discarded idea" });

    const inbox = await listIdeas({ tab: "inbox" });
    expect(inbox.map((i) => i.id)).toEqual([inboxId]);
  });

  test("shortlist tab returns only shortlisted ideas", async () => {
    const channelId = await seedChannel("@ideas-shortlist");
    const inboxVideo = await seedVideo(channelId);
    const shortlistedVideo = await seedVideo(channelId);

    await seedIdea(inboxVideo, { status: "inbox" });
    const shortlistedId = await seedIdea(shortlistedVideo, { status: "shortlisted" });

    const shortlist = await listIdeas({ tab: "shortlist" });
    expect(shortlist.map((i) => i.id)).toEqual([shortlistedId]);
  });

  test("ordered by scoreAtCreation desc, nulls last", async () => {
    const channelId = await seedChannel("@ideas-order");
    const lowVideo = await seedVideo(channelId);
    const highVideo = await seedVideo(channelId);
    const noScoreVideo = await seedVideo(channelId);

    const lowId = await seedIdea(lowVideo, { status: "inbox", scoreAtCreation: 2.0 });
    const highId = await seedIdea(highVideo, { status: "inbox", scoreAtCreation: 8.5 });
    const noScoreId = await seedIdea(noScoreVideo, { status: "inbox", scoreAtCreation: null });

    const inbox = await listIdeas({ tab: "inbox" });
    expect(inbox.map((i) => i.id)).toEqual([highId, lowId, noScoreId]);
  });

  test("each item carries the source post's handle, score, views and engagement via feedItemColumns", async () => {
    const channelId = await seedChannel("@ideas-post");
    const videoId = await seedVideo(channelId, { viewCount: 100_000, likeCount: 8_000, commentCount: 2_000, outlierScore: 6.4 });
    const ideaId = await seedIdea(videoId, { status: "inbox", scoreAtCreation: 6.4, concept: "Borrow the same hook" });

    const [item] = await listIdeas({ tab: "inbox" });
    expect(item.id).toBe(ideaId);
    expect(item.concept).toBe("Borrow the same hook");
    expect(item.angle).toBe("An angle");
    expect(item.post.channel.handle).toBe("@ideas-post");
    expect(item.post.outlierScore).toBe(6.4);
    expect(item.post.viewCount).toBe(100_000);
    expect(item.post.engagementRate).toBeCloseTo((8_000 + 2_000) / 100_000);
  });

  test("notes come through as null (not empty string) when never set", async () => {
    const channelId = await seedChannel("@ideas-notes");
    const videoId = await seedVideo(channelId);
    await seedIdea(videoId, { status: "inbox", notes: null });

    const [item] = await listIdeas({ tab: "inbox" });
    expect(item.notes).toBeNull();
  });
});

