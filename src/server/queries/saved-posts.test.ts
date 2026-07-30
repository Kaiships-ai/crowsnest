import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getSavedPosts: typeof import("./saved-posts")["getSavedPosts"];
let getSavedPostByVideoId: typeof import("./saved-posts")["getSavedPostByVideoId"];
let isVideoSaved: typeof import("./saved-posts")["isVideoSaved"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // getMedianViews (channels.ts) pulls in settings/index.ts -> config.ts, which
  // validates the full env schema at import time — same requirement own-channel.test.ts
  // already works around.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getSavedPosts, getSavedPostByVideoId, isVideoSaved } = await import("./saved-posts"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.savedPosts);
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

async function seedVideo(channelId: string, opts: { viewCount?: number | null; outlierScore?: number | null; deletedAt?: string | null } = {}): Promise<string> {
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
    viewCount: opts.viewCount ?? 1000,
    outlierScore: opts.outlierScore ?? null,
    deletedAt: opts.deletedAt ?? null,
  });
  return id;
}

describe("getSavedPosts", () => {
  test("empty vault returns an empty array, not an error", async () => {
    expect(await getSavedPosts()).toEqual([]);
  });

  test("reads score and views live through the join, not a copy taken at save time", async () => {
    const channelId = await seedChannel("@vault-channel");
    const videoId = await seedVideo(channelId, { viewCount: 1000, outlierScore: 2.0 });

    await db.insert(tables.savedPosts).values({ id: newId(), videoId, note: "great hook", createdAt: tsAt(10) });

    const before = await getSavedPosts();
    expect(before[0].item.outlierScore).toBe(2.0);
    expect(before[0].item.viewCount).toBe(1000);

    // The score changes after saving (a later re-score) — the vault row must reflect it.
    await db.update(tables.videos).set({ outlierScore: 5.5, viewCount: 9000 }).where(eq(tables.videos.id, videoId));
    const after = await getSavedPosts();
    expect(after[0].item.outlierScore).toBe(5.5);
    expect(after[0].item.viewCount).toBe(9000);
  });

  test("note is null (not empty string) when nothing was given, and renders as a dash upstream", async () => {
    const channelId = await seedChannel("@no-note");
    const videoId = await seedVideo(channelId);
    await db.insert(tables.savedPosts).values({ id: newId(), videoId, note: null, createdAt: tsAt(0) });

    const [row] = await getSavedPosts();
    expect(row.note).toBeNull();
  });

  test("videoDeleted is true when the source video's deletedAt is set, and the row is still kept", async () => {
    const channelId = await seedChannel("@gone");
    const videoId = await seedVideo(channelId, { deletedAt: tsAt(5) });
    await db.insert(tables.savedPosts).values({ id: newId(), videoId, createdAt: tsAt(0) });

    const [row] = await getSavedPosts();
    expect(row.videoDeleted).toBe(true);
  });

  test("analyzed is true only when video_analyses has a row for this video", async () => {
    const channelId = await seedChannel("@analyzed-test");
    const analyzedVideo = await seedVideo(channelId);
    const plainVideo = await seedVideo(channelId);
    await db.insert(tables.videoAnalyses).values({ videoId: analyzedVideo, createdAt: tsAt(0) });
    await db.insert(tables.savedPosts).values([
      { id: newId(), videoId: analyzedVideo, createdAt: tsAt(10) },
      { id: newId(), videoId: plainVideo, createdAt: tsAt(20) },
    ]);

    const rows = await getSavedPosts();
    expect(rows.find((r) => r.item.videoId === analyzedVideo)?.analyzed).toBe(true);
    expect(rows.find((r) => r.item.videoId === plainVideo)?.analyzed).toBe(false);
  });

  test("sort 'recent' is most-recently-saved first", async () => {
    const channelId = await seedChannel("@sort-recent");
    const older = await seedVideo(channelId);
    const newer = await seedVideo(channelId);
    await db.insert(tables.savedPosts).values([
      { id: newId(), videoId: older, createdAt: tsAt(10) },
      { id: newId(), videoId: newer, createdAt: tsAt(50) },
    ]);

    const rows = await getSavedPosts("recent");
    expect(rows.map((r) => r.item.videoId)).toEqual([newer, older]);
  });

  test("sort 'score' is highest score first, with nulls last", async () => {
    const channelId = await seedChannel("@sort-score");
    const noScore = await seedVideo(channelId, { outlierScore: null });
    const lowScore = await seedVideo(channelId, { outlierScore: 1.2 });
    const highScore = await seedVideo(channelId, { outlierScore: 6.0 });
    await db.insert(tables.savedPosts).values([
      { id: newId(), videoId: noScore, createdAt: tsAt(10) },
      { id: newId(), videoId: lowScore, createdAt: tsAt(20) },
      { id: newId(), videoId: highScore, createdAt: tsAt(30) },
    ]);

    const rows = await getSavedPosts("score");
    expect(rows.map((r) => r.item.videoId)).toEqual([highScore, lowScore, noScore]);
  });

  test("sort 'analyzed' puts analysed posts first, ties broken by most recently saved", async () => {
    const channelId = await seedChannel("@sort-analyzed");
    const analyzedOld = await seedVideo(channelId);
    const analyzedNew = await seedVideo(channelId);
    const plain = await seedVideo(channelId);
    await db.insert(tables.videoAnalyses).values([
      { videoId: analyzedOld, createdAt: tsAt(0) },
      { videoId: analyzedNew, createdAt: tsAt(0) },
    ]);
    await db.insert(tables.savedPosts).values([
      { id: newId(), videoId: plain, createdAt: tsAt(999) }, // saved most recently, but not analyzed
      { id: newId(), videoId: analyzedOld, createdAt: tsAt(10) },
      { id: newId(), videoId: analyzedNew, createdAt: tsAt(20) },
    ]);

    const rows = await getSavedPosts("analyzed");
    expect(rows.map((r) => r.item.videoId)).toEqual([analyzedNew, analyzedOld, plain]);
  });

  test("channelMedian reads live via the same baseline the Channels screen uses", async () => {
    const channelId = await seedChannel("@median-test");
    // Enough posts to clear minUsable, so a baseline exists to read at all.
    let videoId = "";
    for (const viewCount of [100, 200, 300, 400, 500]) {
      videoId = await seedVideo(channelId, { viewCount });
    }
    // A snapshot that disagrees with the posts, which is what a real one looks like
    // once the baseline method or window has been changed since it was written.
    await db.insert(tables.channelSnapshots).values({ id: newId(), channelId, capturedAt: tsAt(0), medianViews: 4200 });
    await db.insert(tables.savedPosts).values({ id: newId(), videoId, createdAt: tsAt(0) });

    const [row] = await getSavedPosts();
    // 300, the real median of the posts, not 4200 from the snapshot. The vault, the
    // channels list and the detail screen all have to divide by the same number.
    expect(row.channelMedian).toBe(300);
  });

  test("channelMedian is null when the channel has too few posts to have a baseline", async () => {
    const channelId = await seedChannel("@thin-channel");
    const videoId = await seedVideo(channelId, { viewCount: 1000 });
    await db.insert(tables.savedPosts).values({ id: newId(), videoId, createdAt: tsAt(0) });

    const [row] = await getSavedPosts();
    // One post is not a normal. A stale snapshot used to supply a number here, which
    // made a thin channel look measured.
    expect(row.channelMedian).toBeNull();
  });
});

describe("getSavedPostByVideoId / isVideoSaved", () => {
  test("null / false when the video has never been saved", async () => {
    const channelId = await seedChannel("@never-saved");
    const videoId = await seedVideo(channelId);
    expect(await getSavedPostByVideoId(videoId)).toBeNull();
    expect(await isVideoSaved(videoId)).toBe(false);
  });

  test("resolves the row once saved", async () => {
    const channelId = await seedChannel("@was-saved");
    const videoId = await seedVideo(channelId);
    const id = newId();
    await db.insert(tables.savedPosts).values({ id, videoId, note: "why kept", createdAt: tsAt(0) });

    const row = await getSavedPostByVideoId(videoId);
    expect(row).toEqual({ id, note: "why kept", createdAt: tsAt(0) });
    expect(await isVideoSaved(videoId)).toBe(true);
  });
});
