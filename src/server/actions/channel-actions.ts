"use server";

import { eq } from "drizzle-orm";
import { db, tables } from "../db";

// Not the generic `ActionResult<T extends object>` shape the other action modules use
// for a payload-bearing result: both actions below have no success payload, and
// `ActionResult<Record<string, never>>` does not actually type-check (an object
// literal's `ok: true` property can't simultaneously satisfy `Record<string, never>`'s
// index signature). Matches `fleet-actions.ts`'s own `SimpleResult` for the same reason.
type SimpleResult = { ok: true } | { ok: false; error: string; code?: string };

/**
 * The own-channel concept: marking which one tracked channel is Kai's own account.
 *
 * Deliberately the smallest possible surface. This does not touch Instagram Insights
 * (`src/server/graph/`, `src/server/actions/graph-actions.ts`) at all — those tables
 * are keyed on the Graph API account and know nothing about `channels.id`. What this
 * DOES unblock is every screen that needs to answer "which of my tracked channels is
 * mine" without guessing: the "My channel" nav entry, the channels list's "own" health
 * state, and the header on the own-channel screen, all of which read `channels.isOwn`
 * (`getOwnChannel` / `ChannelRow.isOwn` in `queries/channels.ts`) rather than assuming
 * a hardcoded channel id.
 */

/**
 * Marks exactly one channel as Kai's own, unmarking whatever previously held it.
 *
 * Done as an explicit unset-then-set inside one transaction rather than relying solely
 * on the partial unique index (`channels_single_own`) to reject a second row: the index
 * is the correctness backstop if this ever gets bypassed, but a plain INSERT-time
 * conflict would surface as an opaque constraint-violation error rather than the
 * ordinary "you're switching which channel is yours" action this is meant to be.
 */
export async function setOwnChannelAction(channelId: string): Promise<SimpleResult> {
  try {
    const [channel] = await db.select({ id: tables.channels.id }).from(tables.channels).where(eq(tables.channels.id, channelId)).limit(1);
    if (!channel) return { ok: false, error: "That channel no longer exists.", code: "CHANNEL_NOT_FOUND" };

    // better-sqlite3 transactions are synchronous (see sync-engine.ts's acquireLock) —
    // the callback must not be `async`/`await` internally, or the two updates would no
    // longer be guaranteed to commit as one unit.
    db.transaction((tx) => {
      tx.update(tables.channels).set({ isOwn: false }).where(eq(tables.channels.isOwn, true)).run();
      tx.update(tables.channels).set({ isOwn: true }).where(eq(tables.channels.id, channelId)).run();
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Clears the own-channel flag without assigning it elsewhere. Distinct from switching
 *  it to another channel — "I don't want to mark any channel as mine right now" is a
 *  legitimate state, not an error. */
export async function unsetOwnChannelAction(): Promise<SimpleResult> {
  try {
    await db.update(tables.channels).set({ isOwn: false }).where(eq(tables.channels.isOwn, true));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
