"use server";

import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";

type SimpleResult = { ok: true } | { ok: false; error: string };
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Minimal fleet management (final-review finding B2): schema and both the Feed's
 * Fleet filter and the Channels fleet rail were already fully fleet-ready — only
 * create/assign was ever missing. Kept deliberately small: no rename/delete, no
 * fleet-level settings, just the two mutations needed to actually use the feature.
 */

export async function createFleetAction(name: string): Promise<ActionResult<{ fleetId: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Fleet name can't be empty." };
    const id = newId();
    await db.insert(tables.fleets).values({ id, name: trimmed, createdAt: nowIso() });
    return { ok: true, fleetId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Replaces a channel's entire fleet membership set with `fleetIds` (delete-then-
 * insert, not additive) — matches the "checkbox list of all fleets, pre-checked with
 * current membership" UI shape (EditChannelFleetsDialog), where the caller always
 * knows the full intended set rather than a single fleet to add/remove.
 */
export async function setChannelFleetsAction(channelId: string, fleetIds: string[]): Promise<SimpleResult> {
  try {
    await db.delete(tables.fleetChannels).where(eq(tables.fleetChannels.channelId, channelId));
    if (fleetIds.length > 0) {
      await db.insert(tables.fleetChannels).values(fleetIds.map((fleetId) => ({ fleetId, channelId })));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
