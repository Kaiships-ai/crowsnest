"use server";

import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { errorMessage } from "../lib/action-result";

// Deliberately not the shared `ActionResult<T>` (../lib/action-result): this module's
// actions never carry a `code`, and there is no generic payload branch, so it stays
// local rather than being force-fit to the shared shape.
type ActionResult = { ok: true } | { ok: false; error: string };

export async function createVaultItemAction(input: {
  type: "hook" | "style";
  title: string;
  templateText: string;
  tags: string[];
  sourceVideoId?: string;
}): Promise<ActionResult> {
  try {
    await db.insert(tables.vaultItems).values({
      id: newId(),
      type: input.type,
      title: input.title,
      templateText: input.templateText,
      tags: input.tags,
      sourceVideoId: input.sourceVideoId ?? null,
      createdAt: nowIso(),
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
