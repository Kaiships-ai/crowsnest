"use server";

import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { errorMessage, type ActionResult, type SimpleResult } from "../lib/action-result";
import { generateIdea } from "../services/ideas";
import { seedSessionFromIdea } from "../services/remix";

/**
 * Server actions backing the ideas loop: the manual "Generate idea" trigger (a video's
 * detail screen), and the Ideas inbox's own status/notes edits (Task 9).
 *
 * Follows the same shape every other action module in this codebase uses: nothing
 * throws across the boundary, every failure carries a `code` so the caller can tell
 * apart "nothing came back" from a genuine surprise. `ActionResult`/`SimpleResult`
 * import from `../lib/action-result` — the shape saved-post-actions.ts defines.
 */

/** The four values `idea.status` accepts (db/schema.ts's comment on the `idea` table).
 *  Not exported from schema.ts as a type, so it's restated here — the one place a
 *  caller-supplied status string gets checked before it reaches the database. */
const IDEA_STATUSES = ["inbox", "shortlisted", "scripted", "discarded"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

function isIdeaStatus(value: string): value is IdeaStatus {
  return (IDEA_STATUSES as readonly string[]).includes(value);
}

/** Generates (or refreshes) the one inbox idea for a video. `generateIdea` itself never
 *  throws — a bad LLM reply comes back as `{ id: "", created: false }` rather than an
 *  exception — so the only failure this wrapper can see is `id` coming back empty, which
 *  it reports as a normal `ok: false` rather than treating a caught exception as the
 *  only failure mode. */
export async function generateIdeaAction(videoId: string): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const result = await generateIdea(videoId);
    if (!result.id) {
      return { ok: false, error: "Could not generate an idea for that video.", code: "IDEA_GENERATE_FAILED" };
    }
    return { ok: true, id: result.id, created: result.created };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "IDEA_GENERATE_UNKNOWN" };
  }
}

/**
 * Moves an idea between the four statuses — Shortlist, Discard, and (once the remix
 * flow marks one scripted) Create script all funnel through this one action rather than
 * each getting its own setter, the same "one verb, validated" shape `setIdeaNotesAction`
 * below uses for notes.
 *
 * Discard is soft: it sets `status: "discarded"`, same as every other transition here —
 * there is no separate delete path, so the Ideas inbox can always reverse a discard by
 * calling this again with `"inbox"` (or whichever status it was in before).
 */
export async function setIdeaStatusAction(id: string, status: string): Promise<SimpleResult> {
  if (!isIdeaStatus(status)) {
    return { ok: false, error: `"${status}" is not a valid idea status.`, code: "IDEA_STATUS_INVALID" };
  }
  try {
    const [existing] = await db.select({ id: tables.idea.id }).from(tables.idea).where(eq(tables.idea.id, id)).limit(1);
    if (!existing) return { ok: false, error: "That idea no longer exists.", code: "IDEA_NOT_FOUND" };

    await db.update(tables.idea).set({ status, updatedAt: nowIso() }).where(eq(tables.idea.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "IDEA_STATUS_UNKNOWN" };
  }
}

/**
 * The Ideas inbox's "Create script" button: seeds (or reuses) a remix session from an
 * idea and marks it scripted, via `seedSessionFromIdea`. Wraps that function's own
 * "idea not found" throw into the same `ok: false` shape every other action here
 * uses, rather than letting it cross the server-action boundary as an exception.
 */
export async function createScriptFromIdeaAction(id: string): Promise<ActionResult<{ sessionId: string }>> {
  try {
    const sessionId = await seedSessionFromIdea(id);
    return { ok: true, sessionId };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "IDEA_CREATE_SCRIPT_FAILED" };
  }
}

/** Edits the "Your notes" field on an idea — wired to the inbox detail pane's textarea
 *  on blur, not per keystroke. An empty string clears it back to null, same convention
 *  `updateSavedPostNoteAction` uses for the Vault's own note field. */
export async function setIdeaNotesAction(id: string, notes: string): Promise<SimpleResult> {
  try {
    const [existing] = await db.select({ id: tables.idea.id }).from(tables.idea).where(eq(tables.idea.id, id)).limit(1);
    if (!existing) return { ok: false, error: "That idea no longer exists.", code: "IDEA_NOT_FOUND" };

    await db.update(tables.idea).set({ notes: notes.trim() || null, updatedAt: nowIso() }).where(eq(tables.idea.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "IDEA_NOTES_UNKNOWN" };
  }
}
