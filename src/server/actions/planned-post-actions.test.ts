import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

// revalidatePath needs a request-scoped work store that only exists inside a real
// request; the new publish actions call it, so it is stubbed here (same shape as
// fleet-actions.test.ts). The pre-publish actions never call it, so their tests are
// unaffected.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let createPlannedPostAction: typeof import("./planned-post-actions")["createPlannedPostAction"];
let updatePlannedPostAction: typeof import("./planned-post-actions")["updatePlannedPostAction"];
let schedulePlannedPostAction: typeof import("./planned-post-actions")["schedulePlannedPostAction"];
let unschedulePlannedPostAction: typeof import("./planned-post-actions")["unschedulePlannedPostAction"];
let deletePlannedPostAction: typeof import("./planned-post-actions")["deletePlannedPostAction"];
let attachScriptToPlanAction: typeof import("./planned-post-actions")["attachScriptToPlanAction"];
let detachScriptFromPlanAction: typeof import("./planned-post-actions")["detachScriptFromPlanAction"];
let markPlanPublishedAction: typeof import("./planned-post-actions")["markPlanPublishedAction"];
let uploadPlanVideoAction: typeof import("./planned-post-actions")["uploadPlanVideoAction"];
let setPlanCaptionAction: typeof import("./planned-post-actions")["setPlanCaptionAction"];
let schedulePublishAction: typeof import("./planned-post-actions")["schedulePublishAction"];
let cancelScheduledPublishAction: typeof import("./planned-post-actions")["cancelScheduledPublishAction"];
let publishNowAction: typeof import("./planned-post-actions")["publishNowAction"];
let retryFailedPublishAction: typeof import("./planned-post-actions")["retryFailedPublishAction"];
let DEFAULT_MAX_ATTEMPTS: typeof import("../services/publish-scheduler")["DEFAULT_MAX_ATTEMPTS"];
let deleteScriptAction: typeof import("./remix-actions")["deleteScriptAction"];
let getPlannedPosts: typeof import("../queries/planned-posts")["getPlannedPosts"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // A writable media root so uploadPlanVideoAction's content-addressed store can copy the
  // uploaded bytes somewhere real (config reads MEDIA_ROOT at import, so set it first).
  process.env.MEDIA_ROOT ??= (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "crowsnest-media-"));
  // Transitively pulls in queries/planned-posts.ts -> own-channel.ts -> graph/client.ts
  // -> config.ts, which validates the full env schema at import time.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({
    createPlannedPostAction,
    updatePlannedPostAction,
    schedulePlannedPostAction,
    unschedulePlannedPostAction,
    deletePlannedPostAction,
    attachScriptToPlanAction,
    detachScriptFromPlanAction,
    markPlanPublishedAction,
    uploadPlanVideoAction,
    setPlanCaptionAction,
    schedulePublishAction,
    cancelScheduledPublishAction,
    publishNowAction,
    retryFailedPublishAction,
  } = await import("./planned-post-actions"));
  ({ DEFAULT_MAX_ATTEMPTS } = await import("../services/publish-scheduler"));
  ({ deleteScriptAction } = await import("./remix-actions"));
  ({ getPlannedPosts } = await import("../queries/planned-posts"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.plannedPosts);
  await db.delete(tables.scripts);
  await db.delete(tables.ownPosts);
  await db.delete(tables.mediaAssets);
});

async function seedScript(): Promise<string> {
  const id = newId();
  await db.insert(tables.scripts).values({ id, title: "Draft", content: "hook body cta", status: "draft", createdAt: nowIso(), updatedAt: nowIso() });
  return id;
}

// remix_sessions.id is a real foreign key target (remixSessionId is provenance, but
// still has to point at a row that exists — foreign_keys is ON).
async function seedRemixSession(): Promise<string> {
  const channelId = newId();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@remix-src-${channelId}`, trackedSince: nowIso() });
  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `ext-${videoId}`, url: "https://example.com/post", postedAt: nowIso(), firstSeenAt: nowIso(),
  });
  const sessionId = newId();
  await db.insert(tables.remixSessions).values({ id: sessionId, sourceVideoId: videoId, stage: "prompt", createdAt: nowIso(), updatedAt: nowIso() });
  return sessionId;
}

async function seedOwnPost(): Promise<string> {
  const id = newId();
  await db.insert(tables.ownPosts).values({
    id, externalId: `ext-${id}`, permalink: "https://instagram.com/p/own", mediaType: "VIDEO", format: "Reel", postedAt: nowIso(), firstSeenAt: nowIso(),
  });
  return id;
}

describe("createPlannedPostAction", () => {
  test("creates an undated draft", async () => {
    const result = await createPlannedPostAction({ title: "Some idea" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.id));
    expect(row.state).toBe("draft");
    expect(row.plannedDate).toBeNull();
  });

  test("creating with a date sets state to scheduled", async () => {
    const result = await createPlannedPostAction({ title: "Dated", plannedDate: "2026-08-01" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.id));
    expect(row.state).toBe("scheduled");
  });

  test("a date in the past is allowed on create, not refused", async () => {
    const result = await createPlannedPostAction({ title: "Blew it already", plannedDate: "2020-01-01" });
    expect(result.ok).toBe(true);
  });

  test("refuses an empty title", async () => {
    const result = await createPlannedPostAction({ title: "   " });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_TITLE" });
  });

  test("refuses an invalid date", async () => {
    const result = await createPlannedPostAction({ title: "Bad date", plannedDate: "not-a-date" });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_DATE" });
  });

  test("refuses a scriptId that doesn't exist", async () => {
    const result = await createPlannedPostAction({ title: "Ghost script", scriptId: "does-not-exist" });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_SCRIPT_NOT_FOUND" });
  });

  test("carries a real scriptId and remixSessionId through", async () => {
    const scriptId = await seedScript();
    const remixSessionId = await seedRemixSession();
    const result = await createPlannedPostAction({ title: "With script", scriptId, remixSessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.id));
    expect(row.scriptId).toBe(scriptId);
    expect(row.remixSessionId).toBe(remixSessionId);
  });
});

describe("videoKind (content machine v1, task 1)", () => {
  test("creating with a valid videoKind persists it, and the calendar query returns it", async () => {
    const result = await createPlannedPostAction({ title: "Kitchen tour", videoKind: "talking-head" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.id));
    expect(row.videoKind).toBe("talking-head");

    const [planRow] = await getPlannedPosts();
    expect(planRow.videoKind).toBe("talking-head");
  });

  test("creating with an unknown videoKind is refused with BAD_VIDEO_KIND, and nothing is written", async () => {
    const result = await createPlannedPostAction({ title: "Bad kind", videoKind: "reel" });
    expect(result).toEqual({ ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" });

    const rows = await db.select().from(tables.plannedPosts);
    expect(rows).toHaveLength(0);
  });

  test("creating with no videoKind leaves it null", async () => {
    const result = await createPlannedPostAction({ title: "No kind given" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, result.id));
    expect(row.videoKind).toBeNull();
  });

  test("updating with a valid videoKind persists it, and the calendar query returns it", async () => {
    const created = (await createPlannedPostAction({ title: "Original" })) as { ok: true; id: string };
    const result = await updatePlannedPostAction(created.id, { videoKind: "product-promo" });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoKind).toBe("product-promo");

    const [planRow] = await getPlannedPosts();
    expect(planRow.videoKind).toBe("product-promo");
  });

  test("updating with an unknown videoKind returns BAD_VIDEO_KIND and does not write", async () => {
    const created = (await createPlannedPostAction({ title: "Original", videoKind: "talking-head" })) as { ok: true; id: string };
    const result = await updatePlannedPostAction(created.id, { videoKind: "reel" });
    expect(result).toEqual({ ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoKind).toBe("talking-head"); // unchanged
  });

  test("updating with videoKind: null clears it", async () => {
    const created = (await createPlannedPostAction({ title: "Original", videoKind: "talking-head" })) as { ok: true; id: string };
    const result = await updatePlannedPostAction(created.id, { videoKind: null });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoKind).toBeNull();
  });
});

describe("updatePlannedPostAction", () => {
  test("updates title, note, and targetLengthSec", async () => {
    const created = (await createPlannedPostAction({ title: "Original" })) as { ok: true; id: string };
    const result = await updatePlannedPostAction(created.id, { title: "Renamed", note: "why this matters", targetLengthSec: 60 });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.title).toBe("Renamed");
    expect(row.note).toBe("why this matters");
    expect(row.targetLengthSec).toBe(60);
  });

  test("refuses clearing the title to empty", async () => {
    const created = (await createPlannedPostAction({ title: "Original" })) as { ok: true; id: string };
    const result = await updatePlannedPostAction(created.id, { title: "   " });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_TITLE" });
  });

  test("fails cleanly for a plan that doesn't exist", async () => {
    const result = await updatePlannedPostAction("does-not-exist", { title: "New" });
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_FOUND" });
  });
});

describe("schedulePlannedPostAction / unschedulePlannedPostAction", () => {
  test("schedules a draft", async () => {
    const created = (await createPlannedPostAction({ title: "Draft" })) as { ok: true; id: string };
    const result = await schedulePlannedPostAction(created.id, "2026-09-01", "14:00");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("scheduled");
    expect(row.plannedDate).toBe("2026-09-01");
    expect(row.plannedTime).toBe("14:00");
  });

  test("rescheduling is calling schedule again with a new date, not a separate verb", async () => {
    const created = (await createPlannedPostAction({ title: "Draft", plannedDate: "2026-09-01" })) as { ok: true; id: string };
    await schedulePlannedPostAction(created.id, "2026-09-15");

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.plannedDate).toBe("2026-09-15");
  });

  test("unschedule returns a plan to draft, undated", async () => {
    const created = (await createPlannedPostAction({ title: "Dated", plannedDate: "2026-09-01" })) as { ok: true; id: string };
    const result = await unschedulePlannedPostAction(created.id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("draft");
    expect(row.plannedDate).toBeNull();
    expect(row.plannedTime).toBeNull();
  });

  test("schedule fails cleanly on a plan that doesn't exist", async () => {
    const result = await schedulePlannedPostAction("does-not-exist", "2026-09-01");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_FOUND" });
  });

  test("schedule rejects an invalid date", async () => {
    const created = (await createPlannedPostAction({ title: "Draft" })) as { ok: true; id: string };
    const result = await schedulePlannedPostAction(created.id, "2026-13-40");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_DATE" });
  });
});

describe("attachScriptToPlanAction / detachScriptFromPlanAction", () => {
  test("attaches a script and clears any stale detach note", async () => {
    const created = (await createPlannedPostAction({ title: "No script yet" })) as { ok: true; id: string };
    const scriptId = await seedScript();

    const result = await attachScriptToPlanAction(created.id, scriptId);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.scriptId).toBe(scriptId);
    expect(row.scriptDetachedNote).toBeNull();
  });

  test("refuses attaching a script that doesn't exist", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await attachScriptToPlanAction(created.id, "does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_SCRIPT_NOT_FOUND" });
  });

  test("detach nulls scriptId and writes a note the calendar can render", async () => {
    const scriptId = await seedScript();
    const created = (await createPlannedPostAction({ title: "Carries a script", scriptId })) as { ok: true; id: string };

    const result = await detachScriptFromPlanAction(created.id, "wrong take");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.scriptId).toBeNull();
    expect(row.scriptDetachedNote).toContain("wrong take");
  });

  test("refuses detaching from a plan that carries no script", async () => {
    const created = (await createPlannedPostAction({ title: "No script" })) as { ok: true; id: string };
    const result = await detachScriptFromPlanAction(created.id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_SCRIPT" });
  });
});

describe("markPlanPublishedAction", () => {
  test("marks a plan published against a real own post", async () => {
    const ownPostId = await seedOwnPost();
    const created = (await createPlannedPostAction({ title: "Went out", plannedDate: "2026-01-01" })) as { ok: true; id: string };

    const result = await markPlanPublishedAction(created.id, ownPostId);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.publishedOwnPostId).toBe(ownPostId);
  });

  test("marking published with null still reads back as published (B-01)", async () => {
    const created = (await createPlannedPostAction({ title: "Went out unlinked" })) as { ok: true; id: string };
    const result = await markPlanPublishedAction(created.id, null);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("published");
    const derived = (await getPlannedPosts()).find((p) => p.id === created.id);
    expect(derived?.state).toBe("published");
  });

  test("a past-dated plan marked published reads as published, not missed (B-08)", async () => {
    const created = (await createPlannedPostAction({ title: "Went out on a past date", plannedDate: "2020-01-01" })) as { ok: true; id: string };
    await schedulePlannedPostAction(created.id, "2020-01-01");
    await markPlanPublishedAction(created.id, null);

    const derived = (await getPlannedPosts()).find((p) => p.id === created.id);
    expect(derived?.state).toBe("published");
    expect(derived?.state).not.toBe("missed");
  });

  test("refuses an own post id that doesn't exist", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await markPlanPublishedAction(created.id, "does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_OWN_POST_NOT_FOUND" });
  });
});

describe("deletePlannedPostAction", () => {
  test("removes the plan", async () => {
    const created = (await createPlannedPostAction({ title: "Delete me" })) as { ok: true; id: string };
    const result = await deletePlannedPostAction(created.id);
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(rows).toHaveLength(0);
  });
});

describe("deleteScriptAction refuses when a plan carries the script (contract 6)", () => {
  test("refused with SCRIPT_CARRIED_BY_PLAN, naming the plan and its date, and nothing is deleted", async () => {
    const scriptId = await seedScript();
    await createPlannedPostAction({ title: "Carries it", scriptId, plannedDate: "2026-10-05" });

    const result = await deleteScriptAction(scriptId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SCRIPT_CARRIED_BY_PLAN");
    expect(result.plans?.[0]).toMatchObject({ title: "Carries it", plannedDate: "2026-10-05" });

    const [script] = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId));
    expect(script).toBeDefined();
  });

  test("deletes cleanly once detached from every plan that carried it", async () => {
    const scriptId = await seedScript();
    const created = (await createPlannedPostAction({ title: "Carries it", scriptId })) as { ok: true; id: string };
    await detachScriptFromPlanAction(created.id);

    const result = await deleteScriptAction(scriptId);
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(tables.scripts).where(eq(tables.scripts.id, scriptId));
    expect(rows).toHaveLength(0);
  });

  test("fails cleanly for a script that doesn't exist", async () => {
    const result = await deleteScriptAction("does-not-exist");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "SCRIPT_NOT_FOUND" });
  });
});

// --------------------------------------------------------------- publish actions (Goal 4)

/** A media_assets row a plan can point its videoAssetId at (the FK is enforced, so a
 *  bare string would violate it). No file on disk — schedule/publish-now only read the
 *  id, they never touch the bytes here. */
async function seedVideoAsset(): Promise<string> {
  const id = newId();
  const sha = "a".repeat(64);
  await db.insert(tables.mediaAssets).values({
    id,
    sha256: `${id.slice(0, 8)}${sha}`.slice(0, 64),
    kind: "video",
    contentType: "video/mp4",
    byteSize: 1024,
    storagePath: `aa/${id}.mp4`,
    downloadedAt: nowIso(),
  });
  return id;
}

async function seedPublishablePlan(): Promise<string> {
  const created = (await createPlannedPostAction({ title: "Ready" })) as { ok: true; id: string };
  const assetId = await seedVideoAsset();
  await db.update(tables.plannedPosts).set({ videoAssetId: assetId, caption: "a caption" }).where(eq(tables.plannedPosts.id, created.id));
  return created.id;
}

function configurePublish() {
  process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
  process.env.S3_BUCKET = "bucket";
  process.env.S3_KEY = "key";
  process.env.S3_SECRET = "secret";
  process.env.S3_PUBLIC_BASE = "https://media.example.com";
  process.env.IG_GRAPH_TOKEN = "tok";
  process.env.IG_GRAPH_USER_ID = "user";
}

function unconfigurePublish() {
  for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_KEY", "S3_SECRET", "S3_PUBLIC_BASE", "IG_GRAPH_TOKEN", "IG_GRAPH_USER_ID"]) {
    delete process.env[k];
  }
}

describe("uploadPlanVideoAction", () => {
  afterEach(unconfigurePublish);

  test("rejects a non-mp4 file and writes no videoAssetId", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("hi")], "clip.mov", { type: "video/quicktime" }));

    const result = await uploadPlanVideoAction(created.id, fd);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_MP4" });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoAssetId).toBeNull();
  });

  test("accepts an mp4 and attaches a media asset", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("fake mp4 bytes")], "clip.mp4", { type: "video/mp4" }));

    const result = await uploadPlanVideoAction(created.id, fd);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoAssetId).not.toBeNull();
  });
});

describe("setPlanCaptionAction", () => {
  test("stores a caption", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await setPlanCaptionAction(created.id, "  hello world  ");
    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.caption).toBe("hello world");
  });

  test("rejects a caption over the limit", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await setPlanCaptionAction(created.id, "x".repeat(2201));
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_CAPTION_TOO_LONG" });
  });
});

describe("schedulePublishAction preconditions", () => {
  afterEach(unconfigurePublish);

  test("names the missing video", async () => {
    configurePublish();
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await schedulePublishAction(created.id, "2026-09-10T14:00");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_VIDEO" });
  });

  test("names the missing caption", async () => {
    configurePublish();
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    await db.update(tables.plannedPosts).set({ videoAssetId: await seedVideoAsset() }).where(eq(tables.plannedPosts.id, created.id));
    const result = await schedulePublishAction(created.id, "2026-09-10T14:00");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_CAPTION" });
  });

  test("names the missing bucket", async () => {
    unconfigurePublish();
    process.env.IG_GRAPH_TOKEN = "tok";
    process.env.IG_GRAPH_USER_ID = "user";
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "2026-09-10T14:00");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_BUCKET" });
  });

  test("names the missing Graph token", async () => {
    unconfigurePublish();
    process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.S3_BUCKET = "bucket";
    process.env.S3_KEY = "key";
    process.env.S3_SECRET = "secret";
    process.env.S3_PUBLIC_BASE = "https://media.example.com";
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "2026-09-10T14:00");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_GRAPH" });
  });

  test("rejects an invalid schedule time", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "not-a-time");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_SCHEDULE" });
  });

  test("schedules when every precondition is met, setting scheduledAt and the idempotency key", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "2026-09-10T14:00");
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    expect(row.state).toBe("scheduled");
    expect(row.scheduledAt).not.toBeNull();
    expect(row.idempotencyKey).toBe(`${id}:${row.scheduledAt}`);
  });
});

describe("cancelScheduledPublishAction", () => {
  afterEach(unconfigurePublish);

  test("returns a scheduled publish to a draft and clears scheduledAt", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    await schedulePublishAction(id, "2026-09-10T14:00");

    const result = await cancelScheduledPublishAction(id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    expect(row.state).toBe("draft");
    expect(row.scheduledAt).toBeNull();
    expect(row.idempotencyKey).toBeNull();
  });

  test("refuses to cancel a plan that is not scheduled", async () => {
    const created = (await createPlannedPostAction({ title: "Draft" })) as { ok: true; id: string };
    const result = await cancelScheduledPublishAction(created.id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_SCHEDULED" });
  });
});

describe("publishNowAction guards", () => {
  afterEach(unconfigurePublish);

  test("refuses without a video and never claims the row", async () => {
    configurePublish();
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const result = await publishNowAction(created.id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_VIDEO" });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("draft");
  });

  test("does not double-publish a row already published", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    await db.update(tables.plannedPosts).set({ state: "published" }).where(eq(tables.plannedPosts.id, id));

    const result = await publishNowAction(id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_ALREADY_IN_FLIGHT" });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    expect(row.state).toBe("published"); // untouched
  });

  test("does not claim a row already publishing", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    await db.update(tables.plannedPosts).set({ state: "publishing" }).where(eq(tables.plannedPosts.id, id));

    const result = await publishNowAction(id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_ALREADY_IN_FLIGHT" });
  });
});

describe("retryFailedPublishAction", () => {
  test("re-arms a failed row under the attempt cap back to scheduled", async () => {
    const id = await seedPublishablePlan();
    await db.update(tables.plannedPosts).set({ state: "failed", attemptCount: 1, lastError: "boom", errorClass: "timeout" }).where(eq(tables.plannedPosts.id, id));

    const result = await retryFailedPublishAction(id);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    expect(row.state).toBe("scheduled");
    expect(row.scheduledAt).not.toBeNull();
    expect(row.lastError).toBeNull();
  });

  test("refuses a row that is not failed", async () => {
    const created = (await createPlannedPostAction({ title: "Draft" })) as { ok: true; id: string };
    const result = await retryFailedPublishAction(created.id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_FAILED" });
  });

  test("refuses once the attempt cap is hit", async () => {
    const id = await seedPublishablePlan();
    await db.update(tables.plannedPosts).set({ state: "failed", attemptCount: DEFAULT_MAX_ATTEMPTS }).where(eq(tables.plannedPosts.id, id));

    const result = await retryFailedPublishAction(id);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_RETRY_EXHAUSTED" });
  });
});
