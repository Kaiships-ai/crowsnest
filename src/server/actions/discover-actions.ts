"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db";
import { normalizeHandle } from "../services/sync-engine";
import { getIgStatusAction } from "./ig-actions";
import { addChannelAction, startSyncAction } from "./sync-actions";
import type { ActionResult } from "../lib/action-result";

/**
 * One-click "Follow" for the Discover tab: adds a creator as a tracked channel and
 * queues a sync for it, reusing `addChannelAction`/`startSyncAction` rather than
 * duplicating either.
 *
 * Idempotent per the orchestrator's constraint: an already-tracked (non-deleted) handle
 * is a no-op that reports `alreadyTracked: true` and starts nothing — Discover results
 * can be re-followed (e.g. after a refresh) without re-adding or re-queuing a sync.
 * `syncQueued` reflects whether `startSyncAction` actually won the lock; a sync already
 * running for another channel is not treated as a failure of this action.
 */
export async function followCreatorAction(
  handle: string
): Promise<ActionResult<{ channelId: string; syncQueued: boolean; alreadyTracked: boolean }>> {
  let normalized: string;
  try {
    normalized = normalizeHandle(handle);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const existing = await db
    .select({ id: tables.channels.id })
    .from(tables.channels)
    .where(
      and(
        eq(tables.channels.platform, "instagram"),
        eq(tables.channels.handle, normalized),
        isNull(tables.channels.deletedAt)
      )
    )
    .limit(1);
  if (existing[0]) return { ok: true, channelId: existing[0].id, syncQueued: false, alreadyTracked: true };

  const added = await addChannelAction(normalized);
  if (!added.ok) return added;

  const igServiceUp = (await getIgStatusAction()).ok;
  const syncQueued = igServiceUp && (await startSyncAction([added.channelId])).ok;
  return { ok: true, channelId: added.channelId, syncQueued, alreadyTracked: false };
}
