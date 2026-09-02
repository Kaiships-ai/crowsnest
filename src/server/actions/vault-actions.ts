"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { errorMessage } from "../lib/action-result";

// Deliberately not the shared `ActionResult<T>` (../lib/action-result): this module's
// actions never carry a `code`, and there is no generic payload branch, so it stays
// local rather than being force-fit to the shared shape.
type ActionResult = { ok: true } | { ok: false; error: string };

type VaultItemInput = {
  type: "hook" | "style";
  title: string;
  templateText: string;
  tags: string[];
  sourceVideoId?: string;
};

/** The transaction handle `db.transaction`'s callback receives — same derivation
 *  settings-actions.ts uses for its own `Tx` (structural, not shared: it comes from
 *  `db.transaction`'s own signature, not a type either module owns). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inserts one vault item, or reuses an existing row with the exact same
 * (type, sourceVideoId, title, templateText) instead of inserting a duplicate.
 *
 * This is the idempotency half of B-05 ("a retry duplicates the row that landed"):
 * the Save to Vault dialog resubmits the *same* form values on a retry, so an exact
 * content match here is the retry case — reusing the existing row's id is a no-op
 * rather than a second insert. A resubmission with genuinely edited content (a
 * different title or template text) is a new item, as it should be. Mirrors the
 * select-then-write pattern this codebase already uses for idempotency elsewhere
 * (createSavedPostAction's "already saved" check, generateIdea's select-then-update)
 * rather than a DB unique constraint, since there is no single natural key here (unlike
 * videos.externalId) — the retry itself is what supplies the identity, via content.
 *
 * Takes the transaction handle so callers can batch several of these atomically (see
 * `saveToVaultAction` below) as well as call it standalone for a single item.
 */
function insertVaultItemIdempotent(tx: Tx, input: VaultItemInput): string {
  const existing = tx
    .select({ id: tables.vaultItems.id })
    .from(tables.vaultItems)
    .where(
      and(
        eq(tables.vaultItems.type, input.type),
        input.sourceVideoId ? eq(tables.vaultItems.sourceVideoId, input.sourceVideoId) : isNull(tables.vaultItems.sourceVideoId),
        eq(tables.vaultItems.title, input.title),
        eq(tables.vaultItems.templateText, input.templateText)
      )
    )
    .limit(1)
    .all();
  if (existing[0]) return existing[0].id;

  const id = newId();
  tx.insert(tables.vaultItems)
    .values({
      id,
      type: input.type,
      title: input.title,
      templateText: input.templateText,
      tags: input.tags,
      sourceVideoId: input.sourceVideoId ?? null,
      createdAt: nowIso(),
    })
    .run();
  return id;
}

export async function createVaultItemAction(input: VaultItemInput): Promise<ActionResult> {
  try {
    db.transaction((tx) => insertVaultItemIdempotent(tx, input));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The Save to Vault dialog's full write ("hook", "style", or "both") in one call.
 *
 * Fixes B-05 ("Save to Vault both can half-write and a retry duplicates the row that
 * landed"): the dialog's "both" choice used to fire one createVaultItemAction call per
 * item via Promise.all — two independent DB round trips with no atomicity between them.
 * If the second failed after the first had already committed, that was a half-write
 * (one row landed, one didn't); retrying then resubmitted the *same* form values and
 * re-inserted the item that had already landed, duplicating it.
 *
 * Fixed the same way updateAppSettingsAction fixes its own multi-write atomicity (see
 * the comment on that function): every insert for this call runs inside one
 * `db.transaction`, so a failure on either item rolls back both — nothing is ever left
 * half-saved. Idempotency comes from `insertVaultItemIdempotent` above, so a retry that
 * resubmits unchanged content is a no-op on whichever item(s) already landed.
 */
export async function saveToVaultAction(input: { items: VaultItemInput[] }): Promise<ActionResult> {
  if (input.items.length === 0) return { ok: false, error: "Nothing to save." };
  try {
    db.transaction((tx) => {
      for (const item of input.items) insertVaultItemIdempotent(tx, item);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteVaultItemAction(id: string): Promise<ActionResult> {
  try {
    await db.delete(tables.vaultItems).where(eq(tables.vaultItems.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
