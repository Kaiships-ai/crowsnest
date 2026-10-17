import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

// A datetime-local string (YYYY-MM-DDTHH:MM) always ~30 days in the future, so the
// schedule tests never rot into PLAN_SCHEDULE_IN_PAST as the calendar advances.
const FUTURE_SCHEDULE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

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
let setPlanFieldsAction: typeof import("./planned-post-actions")["setPlanFieldsAction"];
let schedulePublishAction: typeof import("./planned-post-actions")["schedulePublishAction"];
let cancelScheduledPublishAction: typeof import("./planned-post-actions")["cancelScheduledPublishAction"];
let publishNowAction: typeof import("./planned-post-actions")["publishNowAction"];
let retryFailedPublishAction: typeof import("./planned-post-actions")["retryFailedPublishAction"];
let movePlannedPostAction: typeof import("./planned-post-actions")["movePlannedPostAction"];
let DEFAULT_MAX_ATTEMPTS: typeof import("../services/publish-scheduler")["DEFAULT_MAX_ATTEMPTS"];
let deleteScriptAction: typeof import("./remix-actions")["deleteScriptAction"];
let getPlannedPosts: typeof import("../queries/planned-posts")["getPlannedPosts"];
type PlannedPostState = import("../queries/planned-posts").PlannedPostState;

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
    setPlanFieldsAction,
    schedulePublishAction,
    cancelScheduledPublishAction,
    publishNowAction,
    retryFailedPublishAction,
    movePlannedPostAction,
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

  // B-09: the calendar delete Undo re-creates a deleted plan by calling this action with
  // the full row snapshot it still holds. Undo must be lossless — every field the plan
  // carried has to come back, including the two this action historically could not carry
  // (its own id, and targetLengthSec), or Undo silently mints a different, emptier plan.
  test("re-creates a deleted plan losslessly from its full snapshot (Undo, B-09)", async () => {
    const scriptId = await seedScript();
    const remixSessionId = await seedRemixSession();
    const [session] = await db.select().from(tables.remixSessions).where(eq(tables.remixSessions.id, remixSessionId));
    const sourceVideoId = session.sourceVideoId;

    // A fully loaded plan: dated and timed, with a target length, a kind, a script, and
    // remix/source provenance.
    const created = await createPlannedPostAction({ title: "Loaded", note: "keep me", plannedDate: "2026-08-01", plannedTime: "09:30", scriptId, remixSessionId, sourceVideoId, videoKind: "talking-head" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await updatePlannedPostAction(created.id, { targetLengthSec: 42 });

    // The snapshot the calendar holds for the row, then delete it (mirrors the Undo path).
    const [snapshot] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    const deleted = await deletePlannedPostAction(created.id);
    expect(deleted.ok).toBe(true);

    // Undo: re-create from the full snapshot.
    const restored = await createPlannedPostAction({
      id: snapshot.id,
      title: snapshot.title,
      note: snapshot.note ?? undefined,
      plannedDate: snapshot.plannedDate ?? undefined,
      plannedTime: snapshot.plannedTime ?? undefined,
      targetLengthSec: snapshot.targetLengthSec ?? undefined,
      videoKind: snapshot.videoKind ?? undefined,
      scriptId: snapshot.scriptId ?? undefined,
      remixSessionId: snapshot.remixSessionId ?? undefined,
      sourceVideoId: snapshot.sourceVideoId ?? undefined,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.id).toBe(created.id);
    expect(row.plannedTime).toBe("09:30");
    expect(row.targetLengthSec).toBe(42);
    expect(row.videoKind).toBe("talking-head");
    expect(row.scriptId).toBe(scriptId);
    expect(row.remixSessionId).toBe(remixSessionId);
    expect(row.sourceVideoId).toBe(sourceVideoId);
  });

  // Follow-up to B-09: the row snapshot was lossless but the plan's own state was not —
  // a deleted "published" plan came back through the create-default (plannedDate ?
  // "scheduled" : "draft"), silently losing the fact that it had gone out.
  test("Undo restores a published plan's state, not the create-default (B-09 follow-up)", async () => {
    const created = (await createPlannedPostAction({ title: "Went out", plannedDate: "2026-08-01" })) as { ok: true; id: string };
    await markPlanPublishedAction(created.id, null);

    const [snapshot] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(snapshot.state).toBe("published");
    await deletePlannedPostAction(created.id);

    const restored = await createPlannedPostAction({
      id: snapshot.id,
      title: snapshot.title,
      plannedDate: snapshot.plannedDate ?? undefined,
      state: snapshot.state as PlannedPostState,
    });
    expect(restored.ok).toBe(true);

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("published");
    // publishedOwnPostId is deliberately not part of the snapshot this Undo restores
    // (markPlanPublishedAction is still the only writer of that link).
    expect(row.publishedOwnPostId).toBeNull();
  });

  // "missed" (queries/planned-posts.ts's PlannedPostState) is never a stored value — it
  // is derived on every read from a "scheduled" row whose plannedDate has passed. The
  // calendar cell Undo reads from holds that derived state, so this proves passing it
  // straight through does not leak "missed" into storage: it writes back "scheduled",
  // which immediately re-derives as "missed" again on the next read.
  test("Undo passed a derived 'missed' state writes back 'scheduled', which re-derives as missed", async () => {
    const created = (await createPlannedPostAction({ title: "Blew it", plannedDate: "2020-01-01" })) as { ok: true; id: string };
    const before = (await getPlannedPosts()).find((p) => p.id === created.id)!;
    expect(before.state).toBe("missed");
    await deletePlannedPostAction(created.id);

    const restored = await createPlannedPostAction({
      id: before.id,
      title: before.title,
      plannedDate: before.plannedDate ?? undefined,
      state: before.state,
    });
    expect(restored.ok).toBe(true);

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.state).toBe("scheduled"); // never the literal "missed"

    const after = (await getPlannedPosts()).find((p) => p.id === created.id)!;
    expect(after.state).toBe("missed"); // re-derived, round trip intact
  });

  // A "scheduled" plan armed for a real publish (schedulePublishAction) carries
  // scheduledAt/idempotencyKey/videoAssetId/caption alongside the "scheduled" label.
  // None of those are inputs this action accepts, so restoring the label alone can never
  // produce a half-armed row — this pins that down.
  test("Undo on an armed 'scheduled' publish restores the label without reviving the claim", async () => {
    configurePublish();
    try {
      const id = await seedPublishablePlan();
      await schedulePublishAction(id, FUTURE_SCHEDULE);
      const [snapshot] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
      expect(snapshot.state).toBe("scheduled");
      expect(snapshot.scheduledAt).not.toBeNull();
      await deletePlannedPostAction(id);

      const restored = await createPlannedPostAction({
        id: snapshot.id,
        title: snapshot.title,
        plannedDate: snapshot.plannedDate ?? undefined,
        plannedTime: snapshot.plannedTime ?? undefined,
        state: snapshot.state as PlannedPostState,
      });
      expect(restored.ok).toBe(true);

      const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
      expect(row.state).toBe("scheduled");
      expect(row.scheduledAt).toBeNull();
      expect(row.idempotencyKey).toBeNull();
      expect(row.videoAssetId).toBeNull();
      expect(row.caption).toBeNull();
    } finally {
      unconfigurePublish();
    }
  });

  // "publishing" (mid-flight, no exit control in the UI) and "failed" (retryFailedPublishAction
  // would re-arm it with no video or caption to actually publish) both depend on
  // publish-lifecycle evidence this action never receives. Undo must not revive either
  // state name; it falls back to the safe create-default instead.
  test.each(["publishing", "failed"] as const)("Undo never revives a stuck '%s' claim; falls back to the safe default", async (stuckState) => {
    const created = (await createPlannedPostAction({ title: "Stuck", plannedDate: "2026-09-01" })) as { ok: true; id: string };
    await db.update(tables.plannedPosts).set({ state: stuckState, attemptCount: 1, lastError: "boom" }).where(eq(tables.plannedPosts.id, created.id));
    const [snapshot] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    await deletePlannedPostAction(created.id);

    const restored = await createPlannedPostAction({
      id: snapshot.id,
      title: snapshot.title,
      plannedDate: snapshot.plannedDate ?? undefined,
      state: snapshot.state as PlannedPostState,
    });
    expect(restored.ok).toBe(true);

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    // Falls back to the create-default: plannedDate is present, so "scheduled" — never
    // the stuck state name, and none of its evidence (attemptCount/lastError) either.
    expect(row.state).toBe("scheduled");
    expect(row.attemptCount).toBe(0);
    expect(row.lastError).toBeNull();
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
    // A minimal ISO base media header: 4 size bytes then the "ftyp" box + a brand.
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    fd.append("file", new File([mp4], "clip.mp4", { type: "video/mp4" }));

    const result = await uploadPlanVideoAction(created.id, fd);
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoAssetId).not.toBeNull();
  });

  test("refuses an oversize, empty, or unplanned upload before reading its bytes", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const upload = async (planId: string, size: number) => {
      const file = new File([Buffer.from("x")], "clip.mp4", { type: "video/mp4" });
      Object.defineProperty(file, "size", { value: size });
      const read = vi.spyOn(file, "arrayBuffer");
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadPlanVideoAction(planId, fd);
      expect(read).not.toHaveBeenCalled();
      return result;
    };
    expect(await upload(created.id, 200 * 1024 * 1024 + 1)).toMatchObject({ code: "PLAN_FILE_TOO_LARGE" });
    expect(await upload(created.id, 0)).toMatchObject({ code: "PLAN_EMPTY_FILE" });
    expect(await upload("no-such-plan", 10)).toMatchObject({ code: "PLAN_NOT_FOUND" });
  });

  test("refuses an upload to a published plan and keeps its video", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const send = () => {
      const fd = new FormData();
      fd.append("file", new File([mp4], "clip.mp4", { type: "video/mp4" }));
      return uploadPlanVideoAction(created.id, fd);
    };
    expect(await send()).toEqual({ ok: true });
    const [before] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    await db.update(tables.plannedPosts).set({ state: "published" }).where(eq(tables.plannedPosts.id, created.id));
    mp4[11] = 0x6e;

    expect(await send()).toMatchObject({ ok: false, code: "PLAN_LOCKED" });
    const [after] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(after.videoAssetId).toBe(before.videoAssetId);
  });

  test("rejects a non-mp4 file renamed to .mp4 (no ftyp signature)", async () => {
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    const fd = new FormData();
    fd.append("file", new File([Buffer.from("not really a video at all")], "clip.mp4", { type: "video/mp4" }));

    const result = await uploadPlanVideoAction(created.id, fd);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NOT_MP4" });

    const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, created.id));
    expect(row.videoAssetId).toBeNull();
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
    const result = await schedulePublishAction(created.id, FUTURE_SCHEDULE);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_VIDEO" });
  });

  test("names the missing caption", async () => {
    configurePublish();
    const created = (await createPlannedPostAction({ title: "Plan" })) as { ok: true; id: string };
    await db.update(tables.plannedPosts).set({ videoAssetId: await seedVideoAsset() }).where(eq(tables.plannedPosts.id, created.id));
    const result = await schedulePublishAction(created.id, FUTURE_SCHEDULE);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_CAPTION" });
  });

  test("names the missing bucket", async () => {
    unconfigurePublish();
    process.env.IG_GRAPH_TOKEN = "tok";
    process.env.IG_GRAPH_USER_ID = "user";
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, FUTURE_SCHEDULE);
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
    const result = await schedulePublishAction(id, FUTURE_SCHEDULE);
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_NO_GRAPH" });
  });

  test("rejects an invalid schedule time", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "not-a-time");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_INVALID_SCHEDULE" });
  });

  test("rejects a schedule time in the past (would publish immediately)", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, "2020-01-01T00:00");
    expect(result).toEqual({ ok: false, error: expect.any(String), code: "PLAN_SCHEDULE_IN_PAST" });
  });

  test("schedules when every precondition is met, setting scheduledAt and the idempotency key", async () => {
    configurePublish();
    const id = await seedPublishablePlan();
    const result = await schedulePublishAction(id, FUTURE_SCHEDULE);
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
    await schedulePublishAction(id, FUTURE_SCHEDULE);

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

describe("ACTION-18: publish lifecycle writes revalidate /", () => {
  test("setPlanCaptionAction revalidates / and never /mine", async () => {
    const { revalidatePath } = (await import("next/cache")) as unknown as { revalidatePath: ReturnType<typeof vi.fn> };
    const created = await createPlannedPostAction({ title: "Plan", plannedDate: "2026-12-01" });
    if (!created.ok) throw new Error(created.error);
    revalidatePath.mockClear();
    await setPlanCaptionAction(created.id, "caption");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).not.toHaveBeenCalledWith("/mine");
  });
});

describe("setPlanFieldsAction", () => {
  async function seedPlan(state: PlannedPostState = "draft"): Promise<string> {
    const id = newId();
    await db.insert(tables.plannedPosts).values({ id, state, title: "P", keyword: "KEEP", magnetUrl: "https://example.com/keep", createdAt: nowIso(), updatedAt: nowIso() });
    return id;
  }
  async function row(id: string) {
    const [r] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    return r;
  }

  test.each(["", "   ", "TWO\nLINES", "TAB\tBED", "NUL\u0000X", "BELL\u0007X", "DEL\u007fX", "C1\u0085X", "LS\u2028X", "PS\u2029X", "X".repeat(65)])("refuses keyword %j and writes nothing", async (keyword) => {
    const id = await seedPlan();
    const res = await setPlanFieldsAction(id, { keyword });
    expect(res).toMatchObject({ ok: false, code: "PLAN_KEYWORD_INVALID" });
    expect(await row(id)).toMatchObject({ keyword: "KEEP" });
  });

  test.each(["", "not a url", "javascript:alert(1)", "https://user:pw@example.com/g", "https://user@example.com/g", "http:foo", "HTTP:foo", "https://ex\tample.com/a", "https://example.com/a\nb", "https://example.com/a\u0000b", `https://example.com/${"a".repeat(2049 - 20)}`])(
    "refuses magnetUrl %j and writes nothing",
    async (magnetUrl) => {
      const id = await seedPlan();
      const res = await setPlanFieldsAction(id, { magnetUrl });
      expect(res).toMatchObject({ ok: false, code: "PLAN_MAGNET_URL_INVALID" });
      expect(await row(id)).toMatchObject({ magnetUrl: "https://example.com/keep" });
    },
  );

  test("boundaries: a 64-char keyword and a 2048-char URL are stored as given, trimmed", async () => {
    const id = await seedPlan();
    const keyword = "K".repeat(64);
    const magnetUrl = `https://example.com/${"a".repeat(2048 - 20)}`;
    expect(magnetUrl).toHaveLength(2048);
    expect(await setPlanFieldsAction(id, { keyword: ` ${keyword} `, magnetUrl: ` ${magnetUrl} ` })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ keyword, magnetUrl });
  });

  test("null clears, and an inner space is kept", async () => {
    const id = await seedPlan();
    expect(await setPlanFieldsAction(id, { keyword: " FREE GUIDE ", magnetUrl: null })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ keyword: "FREE GUIDE", magnetUrl: null });
    expect(await setPlanFieldsAction(id, { keyword: null })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ keyword: null });
  });

  test("a published plan can take a keyword and guide link", async () => {
    const id = await seedPlan("published");
    expect(await setPlanFieldsAction(id, { keyword: "PLUGIN", magnetUrl: "https://example.com/g" })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ state: "published", keyword: "PLUGIN", magnetUrl: "https://example.com/g" });
  });
});

describe("movePlannedPostAction", () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv-SE");
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}`).toISOString();
  async function seed(fields: Partial<typeof tables.plannedPosts.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(tables.plannedPosts).values({ id, title: "R", state: "scheduled", plannedDate: day(2), plannedTime: "09:00", createdAt: nowIso(), updatedAt: nowIso(), ...fields });
    return id;
  }
  async function row(id: string) {
    const [r] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    return r;
  }

  test.each(["published", "publishing"] as const)("refuses a %s reel and writes nothing", async (state) => {
    const id = await seed({ state, scheduledAt: at(day(2), "09:00") });
    const before = await row(id);
    expect(await movePlannedPostAction(id, { date: day(3) })).toMatchObject({ ok: false, code: "PLAN_LOCKED" });
    expect(await row(id)).toEqual(before);
  });

  test("an armed reel's publish moves with it, same local time, new idempotency key", async () => {
    const id = await seed({ scheduledAt: at(day(2), "09:30"), idempotencyKey: "k" });
    expect(await movePlannedPostAction(id, { date: day(4) })).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ state: "scheduled", plannedDate: day(4), plannedTime: "09:00", scheduledAt: at(day(4), "09:30"), idempotencyKey: `${id}:${at(day(4), "09:30")}` });
  });

  test("a failed reel with a past scheduledAt stays failed with its error and is never re-armed", async () => {
    const id = await seed({ state: "failed", plannedDate: day(-1), scheduledAt: at(day(-1), "09:00"), lastError: "boom", attemptCount: 1 });
    expect(await movePlannedPostAction(id, { date: day(1) })).toMatchObject({ ok: true });
    const r = await row(id);
    expect(r).toMatchObject({ state: "failed", lastError: "boom", plannedDate: day(1), scheduledAt: at(day(1), "09:00") });
  });

  test("a draft stays a draft", async () => {
    const id = await seed({ state: "draft" });
    expect(await movePlannedPostAction(id, { date: day(3) })).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ state: "draft", plannedDate: day(3), scheduledAt: null });
  });

  test("refuses a past day", async () => {
    const id = await seed({});
    expect(await movePlannedPostAction(id, { date: day(-1) })).toMatchObject({ ok: false, code: "PLAN_MOVE_TO_PAST" });
    expect((await row(id)).plannedDate).toBe(day(2));
  });

  test("never lands a past scheduledAt on a scheduled reel", async () => {
    const id = await seed({ plannedDate: day(0), scheduledAt: new Date(Date.now() - 60_000).toISOString() });
    const before = await row(id);
    expect(await movePlannedPostAction(id, { date: day(0) })).toMatchObject({ ok: false, code: "PLAN_SCHEDULE_IN_PAST" });
    expect(await row(id)).toEqual(before);
  });

  test("undo restores the exact prior date, time and scheduledAt through the same action", async () => {
    const id = await seed({ plannedTime: "07:15", scheduledAt: at(day(2), "07:15") });
    const moved = await movePlannedPostAction(id, { date: day(5) });
    if (!moved.ok) throw new Error(moved.error);
    expect(await movePlannedPostAction(id, { restore: moved.prior })).toMatchObject({ ok: true });
    expect(await row(id)).toMatchObject({ state: "scheduled", plannedDate: day(2), plannedTime: "07:15", scheduledAt: at(day(2), "07:15") });
  });

  test("undo is refused once the reel was published in the meantime", async () => {
    const id = await seed({ scheduledAt: at(day(2), "09:00") });
    const moved = await movePlannedPostAction(id, { date: day(3) });
    if (!moved.ok) throw new Error(moved.error);
    await db.update(tables.plannedPosts).set({ state: "published" }).where(eq(tables.plannedPosts.id, id));
    expect(await movePlannedPostAction(id, { restore: moved.prior })).toMatchObject({ ok: false, code: "PLAN_LOCKED" });
    expect(await row(id)).toMatchObject({ state: "published", plannedDate: day(3) });
  });
});
