"use server";

import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { errorMessage, type ActionResult, type SimpleResult } from "../lib/action-result";
import { scriptExists } from "../queries/planned-posts";
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
