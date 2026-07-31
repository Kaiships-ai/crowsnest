import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let setOwnChannelAction: typeof import("./channel-actions")["setOwnChannelAction"];
let unsetOwnChannelAction: typeof import("./channel-actions")["unsetOwnChannelAction"];
let removeChannelAction: typeof import("./channel-actions")["removeChannelAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ setOwnChannelAction, unsetOwnChannelAction, removeChannelAction } = await import("./channel-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
  await db.delete(tables.savedPosts);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

async function seedChannel(): Promise<string> {
  const id = newId();
  await db.insert(tables.channels).values({ id, platform: "instagram", handle: `@own-test-${id}`, trackedSince: nowIso() });
  return id;
}

async function seedVideo(channelId: string): Promise<string> {
  const id = newId();
  await db.insert(tables.videos).values({
    id,
    channelId,
    platform: "instagram",
    externalId: `own-test-${id}`,
    url: "https://example.com/v",
    postedAt: nowIso(),
    firstSeenAt: nowIso(),
  });
  return id;
}

describe("setOwnChannelAction", () => {
  test("marks the given channel as own", async () => {
    const id = await seedChannel();
    const result = await setOwnChannelAction(id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.isOwn).toBe(true);
  });

  test("switching to a second channel unmarks the first — only one channel is ever own", async () => {
    const first = await seedChannel();
    const second = await seedChannel();

    await setOwnChannelAction(first);
    await setOwnChannelAction(second);

    const rows = await db.select().from(tables.channels);
    const own = rows.filter((r) => r.isOwn);
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe(second);
  });

  test("fails cleanly for a channel that doesn't exist, rather than throwing", async () => {
    const result = await setOwnChannelAction("does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "CHANNEL_NOT_FOUND" });
  });
});

describe("unsetOwnChannelAction", () => {
  test("clears the flag without assigning it elsewhere", async () => {
    const id = await seedChannel();
    await setOwnChannelAction(id);

    const result = await unsetOwnChannelAction();
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.isOwn).toBe(false);
  });

  test("is a no-op, not an error, when no channel is marked own", async () => {
    await seedChannel();
    const result = await unsetOwnChannelAction();
    expect(result).toEqual({ ok: true });
  });
});

describe("removeChannelAction", () => {
  test("soft-deletes: sets deletedAt rather than removing the row", async () => {
    const id = await seedChannel();
    const result = await removeChannelAction(id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row).toBeDefined();
    expect(row.deletedAt).toEqual(expect.any(String));
  });

  test("clears the own-channel flag as part of removal", async () => {
    const id = await seedChannel();
    await setOwnChannelAction(id);

    await removeChannelAction(id);

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.isOwn).toBe(false);
  });

  test("fails cleanly for a channel that doesn't exist", async () => {
    const result = await removeChannelAction("does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "CHANNEL_NOT_FOUND" });
  });

  test("refuses a second removal of an already-removed channel", async () => {
    const id = await seedChannel();
    await removeChannelAction(id);

    const result = await removeChannelAction(id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "CHANNEL_ALREADY_REMOVED" });
  });

  test("refuses when a saved post points at one of the channel's videos, and does not remove it", async () => {
    const id = await seedChannel();
    const videoId = await seedVideo(id);
    await db.insert(tables.savedPosts).values({ id: newId(), videoId, createdAt: nowIso() });

    const result = await removeChannelAction(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("CHANNEL_HAS_SAVED_POSTS");
    expect(result.savedPosts).toHaveLength(1);
    expect(result.savedPosts?.[0].videoId).toBe(videoId);

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.deletedAt).toBeNull();
  });

  test("refuses when a planned post is sourced from one of the channel's videos, and does not remove it", async () => {
    const id = await seedChannel();
    const videoId = await seedVideo(id);
    await db.insert(tables.plannedPosts).values({
      id: newId(),
      title: "Plan carrying this channel's video",
      sourceVideoId: videoId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const result = await removeChannelAction(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("CHANNEL_HAS_PLANNED_POSTS");
    expect(result.plannedPosts).toHaveLength(1);

    const [row] = await db.select().from(tables.channels).where(eq(tables.channels.id, id));
    expect(row.deletedAt).toBeNull();
  });

  test("succeeds once the blocking saved post is gone", async () => {
    const id = await seedChannel();
    const videoId = await seedVideo(id);
    const savedPostId = newId();
    await db.insert(tables.savedPosts).values({ id: savedPostId, videoId, createdAt: nowIso() });

    const blocked = await removeChannelAction(id);
    expect(blocked.ok).toBe(false);

    await db.delete(tables.savedPosts).where(eq(tables.savedPosts.id, savedPostId));

    const result = await removeChannelAction(id);
    expect(result).toEqual({ ok: true });
  });

  test("a video's own removed-from-Instagram flag does not block removing its channel", async () => {
    const id = await seedChannel();
    const videoId = await seedVideo(id);
    await db.update(tables.videos).set({ deletedAt: nowIso() }).where(eq(tables.videos.id, videoId));

    const result = await removeChannelAction(id);
    expect(result).toEqual({ ok: true });
  });
});
