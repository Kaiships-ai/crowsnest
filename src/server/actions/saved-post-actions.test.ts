import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let createSavedPostAction: typeof import("./saved-post-actions")["createSavedPostAction"];
let updateSavedPostNoteAction: typeof import("./saved-post-actions")["updateSavedPostNoteAction"];
let deleteSavedPostAction: typeof import("./saved-post-actions")["deleteSavedPostAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ createSavedPostAction, updateSavedPostNoteAction, deleteSavedPostAction } = await import("./saved-post-actions"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.savedPosts);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

async function seedVideo(): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@save-test-${channelId}`, trackedSince: nowIso() });
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `ext-${videoId}`,
    url: "https://example.com/post", postedAt: nowIso(), firstSeenAt: nowIso(),
  });
  return videoId;
}

describe("createSavedPostAction", () => {
  test("saves a video with an optional note", async () => {
    const videoId = await seedVideo();
    const result = await createSavedPostAction({ videoId, note: "the hook is great" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.id, result.id));
    expect(row.videoId).toBe(videoId);
    expect(row.note).toBe("the hook is great");
  });

  test("an empty or whitespace-only note is stored as null, not an empty string", async () => {
    const videoId = await seedVideo();
    const result = await createSavedPostAction({ videoId, note: "   " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.id, result.id));
    expect(row.note).toBeNull();
  });

  test("refuses a video that doesn't exist", async () => {
    const result = await createSavedPostAction({ videoId: "does-not-exist" });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_POST_VIDEO_NOT_FOUND" });
  });

  test("refuses saving the same video twice — save is a per-video toggle", async () => {
    const videoId = await seedVideo();
    const first = await createSavedPostAction({ videoId });
    expect(first.ok).toBe(true);

    const second = await createSavedPostAction({ videoId });
    expect(second).toEqual({ ok: false, error: expect.any(String), code: "SAVED_POST_ALREADY_SAVED" });

    const rows = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.videoId, videoId));
    expect(rows).toHaveLength(1);
  });
});

describe("updateSavedPostNoteAction", () => {
  test("updates the note", async () => {
    const videoId = await seedVideo();
    const created = (await createSavedPostAction({ videoId })) as { ok: true; id: string };

    const result = await updateSavedPostNoteAction(created.id, "actually the pacing is why");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.id, created.id));
    expect(row.note).toBe("actually the pacing is why");
  });

  test("clearing the note back to empty stores null, which renders as a dash", async () => {
    const videoId = await seedVideo();
    const created = (await createSavedPostAction({ videoId, note: "kept for the hook" })) as { ok: true; id: string };

    await updateSavedPostNoteAction(created.id, "   ");
    const [row] = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.id, created.id));
    expect(row.note).toBeNull();
  });

  test("fails cleanly for a saved post that doesn't exist", async () => {
    const result = await updateSavedPostNoteAction("does-not-exist", "note");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SAVED_POST_NOT_FOUND" });
  });
});

describe("deleteSavedPostAction", () => {
  test("removes the row", async () => {
    const videoId = await seedVideo();
    const created = (await createSavedPostAction({ videoId })) as { ok: true; id: string };

    const result = await deleteSavedPostAction(created.id);
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(tables.savedPosts).where(eq(tables.savedPosts.id, created.id));
    expect(rows).toHaveLength(0);
  });

  test("deleting an id that doesn't exist is a no-op success, not an error", async () => {
    const result = await deleteSavedPostAction("does-not-exist");
    expect(result).toEqual({ ok: true });
  });
});
