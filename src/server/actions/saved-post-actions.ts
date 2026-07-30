"use server";

import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";

/**
 * Server actions backing saved posts (V1 data contracts, Vault): the detail screen's
 * Save action and the Vault screen's per-row note edit and remove.
 *
 * Follows the same shape every other action module in this codebase uses: nothing
 * throws across the boundary, every failure carries a `code` so the caller can tell
 * "already saved" apart from "that post is gone" apart from a genuine surprise.
 */

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };
// Not ActionResult<Record<string, never>> for the no-payload actions below — an object
// literal's `ok: true` can't simultaneously satisfy Record<string, never>'s index
// signature. Matches channel-actions.ts's/fleet-actions.ts's own SimpleResult.
type SimpleResult = { ok: true } | { ok: false; error: string; code?: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Saves a video to the Vault. One row per video — a second call on an
 *  already-saved video is refused rather than silently duplicating it, since the
 *  detail screen's Save button only ever calls this when it is NOT already showing
 *  the "Saved" state, and a second caller racing it should get an honest answer
 *  instead of two rows for one post. */
export async function createSavedPostAction(input: { videoId: string; note?: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const [video] = await db.select({ id: tables.videos.id }).from(tables.videos).where(eq(tables.videos.id, input.videoId)).limit(1);
    if (!video) return { ok: false, error: "That post no longer exists.", code: "SAVED_POST_VIDEO_NOT_FOUND" };

    const [existing] = await db.select({ id: tables.savedPosts.id }).from(tables.savedPosts).where(eq(tables.savedPosts.videoId, input.videoId)).limit(1);
    if (existing) return { ok: false, error: "That post is already saved.", code: "SAVED_POST_ALREADY_SAVED" };

    const id = newId();
    await db.insert(tables.savedPosts).values({
      id,
      videoId: input.videoId,
      note: input.note?.trim() || null,
      createdAt: nowIso(),
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_POST_UNKNOWN" };
  }
}

/** Edits the "why kept" note on an existing saved post. An empty string clears it
 *  back to null (a dash), matching the rule that a reason is optional, never a
 *  required empty string. */
export async function updateSavedPostNoteAction(id: string, note: string): Promise<SimpleResult> {
  try {
    const [existing] = await db.select({ id: tables.savedPosts.id }).from(tables.savedPosts).where(eq(tables.savedPosts.id, id)).limit(1);
    if (!existing) return { ok: false, error: "That saved post no longer exists.", code: "SAVED_POST_NOT_FOUND" };

    await db.update(tables.savedPosts).set({ note: note.trim() || null }).where(eq(tables.savedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_POST_UNKNOWN" };
  }
}

/** Removes a saved post. Undo is a frontend concern (the Vault's toast keeps the
 *  removed row's videoId/note client-side and calls createSavedPostAction again if
 *  the user reverses it within the toast window) — nothing here is soft-deleted,
 *  matching vault-actions.ts's own createVaultItemAction/deleteVaultItemAction pair,
 *  which has no soft-delete path either. */
export async function deleteSavedPostAction(id: string): Promise<SimpleResult> {
  try {
    await db.delete(tables.savedPosts).where(eq(tables.savedPosts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_POST_UNKNOWN" };
  }
}
