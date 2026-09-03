"use server";

import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, newId, nowIso, tables } from "../db";
import { errorMessage, type ActionResult, type SimpleResult } from "../lib/action-result";
import { isGraphConfigured } from "../graph/client";
import { getAssetStore } from "../media/asset-store";
import { getStorageProvider } from "../publish/storage-provider";
import { scriptExists } from "../queries/planned-posts";
import { publishPlannedPost } from "../services/publish-post";
import { DEFAULT_MAX_ATTEMPTS } from "../services/publish-scheduler";
import { isVideoKind } from "../services/video-kind";

/**
 * Server actions backing the manual planner (V1 data contracts, contract 6). Every
 * export here follows the rest of this codebase's action shape: nothing throws across
 * the boundary, every failure carries a `code`.
 *
 * What this module can never do, by construction: there is no call anywhere below to
 * Instagram, no job scheduler, and no path that sets `publishedOwnPostId` except
 * `markPlanPublishedAction`, which only ever runs from a direct, explicit call. A
 * planned post is a record of intent, not a mechanism.
 * `ActionResult`/`SimpleResult`/`errorMessage` live in `../lib/action-result`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

async function getPlan(id: string) {
  const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  return row ?? null;
}

export async function createPlannedPostAction(input: {
  title: string;
  note?: string;
  plannedDate?: string;
  plannedTime?: string;
  scriptId?: string;
  remixSessionId?: string;
  sourceVideoId?: string;
  videoKind?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "A planned post needs a title.", code: "PLAN_INVALID_TITLE" };

    if (input.plannedDate !== undefined && !isValidDate(input.plannedDate)) {
      return { ok: false, error: "That date isn't valid.", code: "PLAN_INVALID_DATE" };
    }

    if (input.scriptId !== undefined && !(await scriptExists(input.scriptId))) {
      return { ok: false, error: "That script no longer exists.", code: "PLAN_SCRIPT_NOT_FOUND" };
    }

    if (input.videoKind !== undefined && !isVideoKind(input.videoKind)) {
      return { ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" };
    }

    const id = newId();
    const now = nowIso();
    // A date in the past is allowed on create — see contract 6's failure list: refusing
    // it would stop the user recording a slot they blew, which is what "missed" exists
    // to show. It just reads as "missed" immediately, computed at read time.
    await db.insert(tables.plannedPosts).values({
      id,
      state: input.plannedDate ? "scheduled" : "draft",
      title,
      note: input.note?.trim() || null,
      plannedDate: input.plannedDate ?? null,
      plannedTime: input.plannedTime ?? null,
      scriptId: input.scriptId ?? null,
      remixSessionId: input.remixSessionId ?? null,
      sourceVideoId: input.sourceVideoId ?? null,
      videoKind: input.videoKind ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

export async function updatePlannedPostAction(
  id: string,
  patch: { title?: string; note?: string; targetLengthSec?: number | null; videoKind?: string | null }
): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    const title = patch.title !== undefined ? patch.title.trim() : undefined;
    if (title !== undefined && !title) return { ok: false, error: "A planned post needs a title.", code: "PLAN_INVALID_TITLE" };

    if (patch.videoKind !== undefined && patch.videoKind !== null && !isVideoKind(patch.videoKind)) {
      return { ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" };
    }

    await db
      .update(tables.plannedPosts)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(patch.note !== undefined ? { note: patch.note.trim() || null } : {}),
        ...(patch.targetLengthSec !== undefined ? { targetLengthSec: patch.targetLengthSec } : {}),
        ...(patch.videoKind !== undefined ? { videoKind: patch.videoKind } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/**
 * Applies a whole plan edit (fields, schedule, script) as ONE unit (B-04). The dialog
 * used to fire updatePlannedPostAction, schedule/unschedule, and attach/detach as separate
 * awaited calls, so a failure partway through left a partial edit. Here every input is
 * validated first, then all writes run in a single transaction, so the edit either lands
 * whole or not at all.
 */
export async function savePlanEditAction(
  id: string,
  edit: {
    title?: string;
    note?: string;
    targetLengthSec?: number | null;
    videoKind?: string | null;
    date?: string | null; // undefined leaves it, null unschedules, a string schedules
    scriptId?: string | null; // undefined leaves it, null detaches, a string attaches
    scriptDetachNote?: string;
  }
): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    // Validate everything up front, before any write, so a bad input can never leave a partial edit.
    const title = edit.title !== undefined ? edit.title.trim() : undefined;
    if (title !== undefined && !title) return { ok: false, error: "A planned post needs a title.", code: "PLAN_INVALID_TITLE" };
    if (edit.videoKind !== undefined && edit.videoKind !== null && !isVideoKind(edit.videoKind)) {
      return { ok: false, error: "Unknown video_kind", code: "BAD_VIDEO_KIND" };
    }
    if (typeof edit.date === "string" && !isValidDate(edit.date)) {
      return { ok: false, error: "That date is not a real calendar date.", code: "PLAN_INVALID_DATE" };
    }
    if (typeof edit.scriptId === "string" && !(await scriptExists(edit.scriptId))) {
      return { ok: false, error: "That script no longer exists.", code: "SCRIPT_NOT_FOUND" };
    }

    const now = nowIso();
    db.transaction((tx) => {
      const fields: Record<string, unknown> = { updatedAt: now };
      if (title !== undefined) fields.title = title;
      if (edit.note !== undefined) fields.note = edit.note.trim() || null;
      if (edit.targetLengthSec !== undefined) fields.targetLengthSec = edit.targetLengthSec;
      if (edit.videoKind !== undefined) fields.videoKind = edit.videoKind;
      tx.update(tables.plannedPosts).set(fields).where(eq(tables.plannedPosts.id, id)).run();

      if (edit.date !== undefined) {
        const dateSet =
          edit.date === null
            ? { state: "draft", plannedDate: null, plannedTime: null, updatedAt: now }
            : { state: "scheduled", plannedDate: edit.date, plannedTime: null, updatedAt: now };
        tx.update(tables.plannedPosts).set(dateSet).where(eq(tables.plannedPosts.id, id)).run();
      }

      if (edit.scriptId !== undefined) {
        const scriptSet =
          edit.scriptId === null
            ? { scriptId: null, scriptDetachedNote: edit.scriptDetachNote ?? null, updatedAt: now }
            : { scriptId: edit.scriptId, scriptDetachedNote: null, updatedAt: now };
        tx.update(tables.plannedPosts).set(scriptSet).where(eq(tables.plannedPosts.id, id)).run();
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Dates (and re-dates) a plan. The prototype's own "back in the pool, undated"
 *  behaviour lives in unschedulePlannedPostAction — rescheduling is calling this again
 *  with a new date, not a separate verb. */
export async function schedulePlannedPostAction(id: string, plannedDate: string, plannedTime?: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (!isValidDate(plannedDate)) return { ok: false, error: "That date isn't valid.", code: "PLAN_INVALID_DATE" };

    await db
      .update(tables.plannedPosts)
      .set({ state: "scheduled", plannedDate, plannedTime: plannedTime ?? null, updatedAt: nowIso() })
      .where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Nulls the date and returns the plan to draft — the prototype's own "back in the
 *  pool, undated" behaviour. */
export async function unschedulePlannedPostAction(id: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    await db
      .update(tables.plannedPosts)
      .set({ state: "draft", plannedDate: null, plannedTime: null, updatedAt: nowIso() })
      .where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

export async function deletePlannedPostAction(id: string): Promise<SimpleResult> {
  try {
    await db.delete(tables.plannedPosts).where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Attaches a finished script to a plan, or swaps the one it carries. Clears any
 *  stale detach note — attaching a new script means the plan is no longer in the
 *  "lost its script" state the note exists to describe. */
export async function attachScriptToPlanAction(id: string, scriptId: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (!(await scriptExists(scriptId))) return { ok: false, error: "That script no longer exists.", code: "PLAN_SCRIPT_NOT_FOUND" };

    await db
      .update(tables.plannedPosts)
      .set({ scriptId, scriptDetachedNote: null, updatedAt: nowIso() })
      .where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Deliberately detaches the script a plan carries, writing a note the calendar
 *  renders so the plan says it lost one instead of looking like it never had one. */
export async function detachScriptFromPlanAction(id: string, reason?: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (!plan.scriptId) return { ok: false, error: "This plan has no script to detach.", code: "PLAN_NO_SCRIPT" };

    const detachedAt = nowIso().slice(0, 10);
    const note = reason?.trim() ? `Script detached on ${detachedAt}: ${reason.trim()}` : `Script detached on ${detachedAt}.`;

    await db
      .update(tables.plannedPosts)
      .set({ scriptId: null, scriptDetachedNote: note, updatedAt: nowIso() })
      .where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/**
 * The only way a plan is ever marked published. `ownPostId: null` is the legal way to
 * say "it went out and I am not linking it" — validated against own_posts only when
 * non-null, since there is nothing to validate for "no link".
 */
export async function markPlanPublishedAction(id: string, ownPostId: string | null): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    if (ownPostId !== null) {
      const [ownPost] = await db.select({ id: tables.ownPosts.id }).from(tables.ownPosts).where(eq(tables.ownPosts.id, ownPostId)).limit(1);
      if (!ownPost) return { ok: false, error: "That own-channel post doesn't exist.", code: "PLAN_OWN_POST_NOT_FOUND" };
    }

    // Mark the plan published durably by storing the state, not only the optional own-post
    // id. Before this, a hand mark with a null id wrote nothing that read back as published
    // (B-01), and a past plan still derived as "missed" on the calendar (B-08). Storing the
    // state fixes both; the own-post id is still recorded when one is given.
    await db.update(tables.plannedPosts).set({ state: "published", publishedOwnPostId: ownPostId, updatedAt: nowIso() }).where(eq(tables.plannedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/* ------------------------------------------------------------------ publish (Goal 4)
 *
 * The publish lifecycle actions (implementation plan Phase D, task D1). Everything below
 * follows the same rules as the actions above: nothing throws across the boundary, every
 * failure carries a `code`, and every input is validated at this layer. These are the
 * only writers of `videoAssetId` / `caption` / `scheduledAt` from the UI; the scheduler
 * (publish-scheduler.ts) and the publish service (publish-post.ts) own the rest of the
 * state machine and are NOT touched here.
 */

/** Instagram's own caption ceiling. Validated here so a caption that Graph would reject
 *  never gets stored, let alone scheduled. */
const CAPTION_MAX = 2200;
/** A `datetime-local` value ("YYYY-MM-DDTHH:MM"), the only schedule input the UI sends. */
const SCHEDULE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Attaches an uploaded mp4 to a plan. The bytes arrive as a `File` in `FormData` (the
 * native Server-Action file convention — see node_modules/next/dist/docs mutating-data),
 * are written to a temp file, then handed to the content-addressed media store
 * (`getAssetStore().put`) so the same seam that ingests rendered media owns this too. No
 * new media infra. Rejects anything that is not an mp4.
 */
export async function uploadPlanVideoAction(id: string, formData: FormData): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file was uploaded.", code: "PLAN_NO_FILE" };
    const isMp4 = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
    if (!isMp4) return { ok: false, error: "Only an .mp4 video can be published.", code: "PLAN_NOT_MP4" };
    if (file.size === 0) return { ok: false, error: "That video file is empty.", code: "PLAN_EMPTY_FILE" };

    const bytes = Buffer.from(await file.arrayBuffer());
    // ponytail: buffer the whole file then copy it into the store. Round-0 mp4s are small
    // enough; if large uploads ever land, stream File.stream() straight to the temp path.
    const tmpPath = path.join(os.tmpdir(), `crowsnest-plan-upload-${newId()}.mp4`);
    await writeFile(tmpPath, bytes);
    let assetId: string;
    try {
      assetId = await getAssetStore().put({ path: tmpPath }, "video", "video/mp4");
    } finally {
      await rm(tmpPath, { force: true });
    }

    await db.update(tables.plannedPosts).set({ videoAssetId: assetId, updatedAt: nowIso() }).where(eq(tables.plannedPosts.id, id));
    revalidatePath("/mine");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Sets (or clears, when blank) the caption a plan publishes with. */
export async function setPlanCaptionAction(id: string, caption: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (typeof caption !== "string") return { ok: false, error: "A caption must be text.", code: "PLAN_INVALID_CAPTION" };

    const trimmed = caption.trim();
    if (trimmed.length > CAPTION_MAX) return { ok: false, error: `A caption can be at most ${CAPTION_MAX} characters.`, code: "PLAN_CAPTION_TOO_LONG" };

    await db.update(tables.plannedPosts).set({ caption: trimmed || null, updatedAt: nowIso() }).where(eq(tables.plannedPosts.id, id));
    revalidatePath("/mine");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/**
 * Arms a plan for the scheduler. Every precondition is named in the error rather than
 * silently succeeding (plan locked decision 6): a video, a caption, a configured bucket,
 * and a configured Graph token must all be present, or this refuses and says which one is
 * missing. `idempotencyKey = id:scheduledAt` (unique index) is what stops a stale tick and
 * a reschedule both claiming the same publish.
 */
export async function schedulePublishAction(id: string, scheduledAtIso: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };

    if (typeof scheduledAtIso !== "string" || !SCHEDULE_RE.test(scheduledAtIso) || Number.isNaN(Date.parse(scheduledAtIso))) {
      return { ok: false, error: "That schedule time isn't a valid date and time.", code: "PLAN_INVALID_SCHEDULE" };
    }
    if (!plan.videoAssetId) return { ok: false, error: "Attach an .mp4 video before scheduling.", code: "PLAN_NO_VIDEO" };
    if (!plan.caption || !plan.caption.trim()) return { ok: false, error: "Write a caption before scheduling.", code: "PLAN_NO_CAPTION" };
    if (!getStorageProvider()) {
      return { ok: false, error: "No storage bucket configured. Set S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_PUBLIC_BASE to publish.", code: "PLAN_NO_BUCKET" };
    }
    if (!isGraphConfigured()) {
      return { ok: false, error: "Instagram isn't connected. Set IG_GRAPH_TOKEN and IG_GRAPH_USER_ID to publish.", code: "PLAN_NO_GRAPH" };
    }

    // datetime-local is a local wall-clock value; Date() reads it as local and toISOString
    // gives the real instant the scheduler (which compares against now.toISOString()) reads.
    const iso = new Date(scheduledAtIso).toISOString();
    await db
      .update(tables.plannedPosts)
      .set({
        state: "scheduled",
        scheduledAt: iso,
        idempotencyKey: `${id}:${iso}`,
        // Keep the calendar's own date/time fields in sync so a scheduled publish still
        // renders in the month grid, which keys off plannedDate.
        plannedDate: iso.slice(0, 10),
        plannedTime: scheduledAtIso.slice(11, 16),
        lastError: null,
        errorClass: null,
        updatedAt: nowIso(),
      })
      .where(eq(tables.plannedPosts.id, id));
    revalidatePath("/mine");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Cancels a scheduled publish, back to an undated draft. Only a `scheduled` row can be
 *  cancelled — a `publishing`/`published`/`failed` one is past the point of a clean pull. */
export async function cancelScheduledPublishAction(id: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (plan.state !== "scheduled") return { ok: false, error: "Only a scheduled publish can be cancelled.", code: "PLAN_NOT_SCHEDULED" };

    await db
      .update(tables.plannedPosts)
      .set({ state: "draft", scheduledAt: null, idempotencyKey: null, plannedDate: null, plannedTime: null, updatedAt: nowIso() })
      .where(eq(tables.plannedPosts.id, id));
    revalidatePath("/mine");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/**
 * Publishes a plan immediately. Preconditions are checked first so a missing one refuses
 * without touching the row (never marks it failed). Then a single atomic claim to
 * `publishing` — the same no-double-publish guard the scheduler uses — gates the actual
 * `publishPlannedPost` call: a claim that changes 0 rows means the row is already in
 * flight or terminal, so nothing publishes twice.
 */
export async function publishNowAction(id: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (!plan.videoAssetId) return { ok: false, error: "Attach an .mp4 video before publishing.", code: "PLAN_NO_VIDEO" };
    if (!plan.caption || !plan.caption.trim()) return { ok: false, error: "Write a caption before publishing.", code: "PLAN_NO_CAPTION" };
    if (!getStorageProvider()) {
      return { ok: false, error: "No storage bucket configured. Set S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_PUBLIC_BASE to publish.", code: "PLAN_NO_BUCKET" };
    }
    if (!isGraphConfigured()) {
      return { ok: false, error: "Instagram isn't connected. Set IG_GRAPH_TOKEN and IG_GRAPH_USER_ID to publish.", code: "PLAN_NO_GRAPH" };
    }

    const claim = await db
      .update(tables.plannedPosts)
      .set({ state: "publishing", scheduledAt: null, idempotencyKey: null, updatedAt: nowIso() })
      .where(and(eq(tables.plannedPosts.id, id), inArray(tables.plannedPosts.state, ["draft", "scheduled", "failed"])));
    if ((claim as { changes?: number }).changes !== 1) {
      return { ok: false, error: "This post is already publishing or published.", code: "PLAN_ALREADY_IN_FLIGHT" };
    }

    // claimed: this action just won the atomic claim above (state -> publishing), so
    // publish-post must act on the now-"publishing" row rather than treat it as a stale
    // in-flight row and no-op. See the claim-token guard in publish-post.ts.
    const result = await publishPlannedPost(id, { claimed: true });
    revalidatePath("/mine");
    if (!result.ok) return { ok: false, error: result.lastError ?? "The publish failed.", code: "PLAN_PUBLISH_FAILED" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}

/** Re-arms a failed publish for another scheduler attempt. Only a `failed` row under the
 *  attempt cap qualifies; the scheduler's own backoff takes over from there. */
export async function retryFailedPublishAction(id: string): Promise<SimpleResult> {
  try {
    const plan = await getPlan(id);
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (plan.state !== "failed") return { ok: false, error: "Only a failed publish can be retried.", code: "PLAN_NOT_FAILED" };
    if (plan.attemptCount >= DEFAULT_MAX_ATTEMPTS) return { ok: false, error: "This publish has already hit its retry limit.", code: "PLAN_RETRY_EXHAUSTED" };

    await db
      .update(tables.plannedPosts)
      .set({ state: "scheduled", scheduledAt: nowIso(), lastError: null, errorClass: null, updatedAt: nowIso() })
      .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.state, "failed")));
    revalidatePath("/mine");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}
