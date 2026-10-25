"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";

type SimpleResult = { ok: true } | { ok: false; error: string };
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

export async function createFleetAction(name: string): Promise<ActionResult<{ fleetId: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Fleet name can't be empty." };
    const [{ max }] = await db.select({ max: sql<number | null>`max(${tables.fleets.sortOrder})` }).from(tables.fleets);
    const id = newId();
    await db.insert(tables.fleets).values({ id, name: trimmed, createdAt: nowIso(), sortOrder: (max ?? -1) + 1 });
    return { ok: true, fleetId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function renameFleetAction(fleetId: string, name: string): Promise<SimpleResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Fleet name can't be empty." };
    await db.update(tables.fleets).set({ name: trimmed }).where(eq(tables.fleets.id, fleetId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The `onDelete: "cascade"` on fleet_channels.fleet_id drops the memberships, so the
 *  fleet's channels become Unassigned. */
export async function deleteFleetAction(fleetId: string): Promise<SimpleResult> {
  try {
    await db.delete(tables.fleets).where(eq(tables.fleets.id, fleetId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function reorderFleetsAction(orderedFleetIds: string[]): Promise<SimpleResult> {
  try {
    await db.transaction((tx) => {
      orderedFleetIds.forEach((id, index) => {
        tx.update(tables.fleets).set({ sortOrder: index }).where(eq(tables.fleets.id, id)).run();
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commit a batch of channel moves in one transaction. Each move replaces the channel's
 * single fleet_channels row: delete any existing row, then insert one when fleetId is
 * not null (null means Unassigned, so no row). This is the Save-button commit and the
 * only place that enforces one fleet per channel.
 */
export async function moveChannelsAction(
  moves: { channelId: string; fleetId: string | null }[]
): Promise<SimpleResult> {
  try {
    if (moves.length === 0) return { ok: true };
    await db.transaction((tx) => {
      const channelIds = moves.map((m) => m.channelId);
      tx.delete(tables.fleetChannels).where(inArray(tables.fleetChannels.channelId, channelIds)).run();
      const inserts = moves
        .filter((m) => m.fleetId !== null)
        .map((m) => ({ fleetId: m.fleetId as string, channelId: m.channelId }));
      if (inserts.length > 0) tx.insert(tables.fleetChannels).values(inserts).run();
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
