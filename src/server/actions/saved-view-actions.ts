"use server";

import { eq } from "drizzle-orm";
import { db, newId, tables } from "../db";
import { errorMessage, type ActionResult, type SimpleResult } from "../lib/action-result";

/**
 * Server actions backing the feed's "saved views" — B1 on the V1-to-product backlog.
 *
 * Before this file, the filter bar read `saved_filters` (via `getSavedFilters` in
 * `queries/feed.ts`) and presented the two rows `bootstrap.ts` seeds as though a view
 * could be added, renamed, or removed. No action wrote to that table. These three
 * actions are the write half of that read.
 *
 * The two seeded rows ("Balanced", "High Conviction") are marked `isSystem` — product
 * configuration, not something Kai made — and every mutating action here refuses to
 * touch one, the same refusal shape `deleteScriptAction` uses for a script still
 * carried by a plan: telling the caller no beats silently doing the wrong thing.
 *
 * Follows the same shape every other action module in this codebase uses: nothing
 * throws across the boundary, and every failure carries a `code`.
 * `ActionResult`/`SimpleResult`/`errorMessage` live in `../lib/action-result` — see
 * saved-post-actions.ts's comment for why.
 */

async function findSavedFilter(id: string) {
  const [row] = await db
    .select({ id: tables.savedFilters.id, isSystem: tables.savedFilters.isSystem })
    .from(tables.savedFilters)
    .where(eq(tables.savedFilters.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Saves the feed's current filters as a new view. `criteria` is whatever shape the
 * filter bar is currently holding (the same loosely-typed JSON `getSavedFilters`
 * already reads back) — this layer doesn't validate individual filter keys, it just
 * persists what the caller has live right now under a name Kai gives it.
 *
 * Always created with `isSystem: false`. There is no path here that can produce a
 * third system row — only `bootstrap.ts` does that, once, at install time.
 */
export async function createSavedViewAction(input: {
  name: string;
  criteria: Record<string, unknown>;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Give this view a name.", code: "SAVED_VIEW_NAME_REQUIRED" };

    const id = newId();
    await db.insert(tables.savedFilters).values({
      id,
      name,
      criteria: input.criteria,
      isSystem: false,
    });
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_VIEW_UNKNOWN" };
  }
}

/** Renames a saved view. Refuses on a system preset — "Balanced" and "High Conviction"
 *  are the product's defaults, not a label Kai gets to overwrite. */
export async function renameSavedViewAction(id: string, name: string): Promise<SimpleResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Give this view a name.", code: "SAVED_VIEW_NAME_REQUIRED" };

    const existing = await findSavedFilter(id);
    if (!existing) return { ok: false, error: "That view no longer exists.", code: "SAVED_VIEW_NOT_FOUND" };
    if (existing.isSystem) return { ok: false, error: "Built-in views can't be renamed.", code: "SAVED_VIEW_IS_SYSTEM" };

    await db.update(tables.savedFilters).set({ name: trimmed }).where(eq(tables.savedFilters.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_VIEW_UNKNOWN" };
  }
}

/** Deletes a saved view. Refuses on a system preset for the same reason renaming does
 *  — a preset that can be deleted by one click is one a fresh feed can silently ship
 *  without, on this one machine, forever. */
export async function deleteSavedViewAction(id: string): Promise<SimpleResult> {
  try {
    const existing = await findSavedFilter(id);
    if (!existing) return { ok: false, error: "That view no longer exists.", code: "SAVED_VIEW_NOT_FOUND" };
    if (existing.isSystem) return { ok: false, error: "Built-in views can't be deleted.", code: "SAVED_VIEW_IS_SYSTEM" };

    await db.delete(tables.savedFilters).where(eq(tables.savedFilters.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SAVED_VIEW_UNKNOWN" };
  }
}
