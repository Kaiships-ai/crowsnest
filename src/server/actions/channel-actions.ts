"use server";

import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";

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

type RemoveChannelResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: "CHANNEL_NOT_FOUND" | "CHANNEL_ALREADY_REMOVED" | "CHANNEL_HAS_SAVED_POSTS" | "CHANNEL_HAS_PLANNED_POSTS" | "CHANNEL_UNKNOWN";
      /** Only set for CHANNEL_HAS_SAVED_POSTS, naming which saved posts are in the way
       *  so the caller can offer "remove those from the Vault first" with something
       *  concrete to point at, rather than a bare count. */
      savedPosts?: { id: string; videoId: string; caption: string | null }[];
      /** Only set for CHANNEL_HAS_PLANNED_POSTS, mirroring deleteScriptAction's `plans`
       *  field below for the same reason. */
      plannedPosts?: { id: string; title: string; plannedDate: string | null }[];
    };

/** Saved posts that would be orphaned by removing this channel — every `saved_posts`
 *  row whose video belongs to it. A plain inline join, matching the one-off lookup
 *  style `saved-post-actions.ts` and `remix-actions.ts`'s `getPlansCarryingScript` use,
 *  rather than a new exported query for a single call site. */
async function getSavedPostsOnChannel(channelId: string) {
  return db
    .select({ id: tables.savedPosts.id, videoId: tables.savedPosts.videoId, caption: tables.videos.caption })
    .from(tables.savedPosts)
    .innerJoin(tables.videos, eq(tables.savedPosts.videoId, tables.videos.id))
    .where(eq(tables.videos.channelId, channelId));
}

/** Planned posts that carry a source video from this channel. `scriptId`-carried
 *  scripts are a separate, already-guarded link (`deleteScriptAction`'s
 *  SCRIPT_CARRIED_BY_PLAN) — this only looks at `sourceVideoId`, the planner's own
 *  direct reference to a video on the channel being removed. */
async function getPlannedPostsOnChannel(channelId: string) {
  return db
    .select({ id: tables.plannedPosts.id, title: tables.plannedPosts.title, plannedDate: tables.plannedPosts.plannedDate })
    .from(tables.plannedPosts)
    .innerJoin(tables.videos, eq(tables.plannedPosts.sourceVideoId, tables.videos.id))
    .where(eq(tables.videos.channelId, channelId));
}

/**
 * Removes (untracks) a channel — D1, "there is no way to remove a channel at all".
 *
 * Soft delete, not hard delete: `channels.deletedAt` is set, matching the grain
 * `videos.deletedAt` already set for this database — rows are never hard-deleted here,
 * because a channel's videos carry transcripts, analyses, and (per the checks below)
 * sometimes saved posts and planned posts that a hard delete would take down with it.
 * Hard-deleting the channel row would cascade through `videos` (`channelId` is
 * `onDelete: cascade`) and from there through `saved_posts` (also cascade on
 * `videoId`), silently deleting posts Kai deliberately kept. Soft delete instead just
 * marks the channel gone: `getChannelsList`/`getOwnChannel` filter it out and it drops
 * out of sync, while every row underneath — including any saved post — stays exactly
 * as it was, in case removal was a mistake or the history is wanted later.
 *
 * Refuses rather than orphaning when a saved post or a planned post still points at
 * one of the channel's videos, the same call `deleteScriptAction` makes for a script
 * still carried by a plan: an orphaned reference (a Vault card or a calendar cell
 * pointing at a video whose channel silently vanished) is a worse failure than telling
 * Kai to clear those first. Removing the channel first unmarks it as "own" (own-ness
 * is a fact about a tracked channel; a channel that's gone can't be the one that's
 * mine) in the same update, not a separate call.
 */
export async function removeChannelAction(channelId: string): Promise<RemoveChannelResult> {
  try {
    const [channel] = await db
      .select({ id: tables.channels.id, deletedAt: tables.channels.deletedAt })
      .from(tables.channels)
      .where(eq(tables.channels.id, channelId))
      .limit(1);
    if (!channel) return { ok: false, error: "That channel no longer exists.", code: "CHANNEL_NOT_FOUND" };
    if (channel.deletedAt) return { ok: false, error: "That channel has already been removed.", code: "CHANNEL_ALREADY_REMOVED" };

    const savedPosts = await getSavedPostsOnChannel(channelId);
    if (savedPosts.length > 0) {
      const noun = savedPosts.length === 1 ? "saved post" : "saved posts";
      return {
        ok: false,
        error: `This channel has ${savedPosts.length} ${noun} in the Vault. Remove those first, or keep the channel.`,
        code: "CHANNEL_HAS_SAVED_POSTS",
        savedPosts,
      };
    }

    const plannedPosts = await getPlannedPostsOnChannel(channelId);
    if (plannedPosts.length > 0) {
      const noun = plannedPosts.length === 1 ? "planned post" : "planned posts";
      return {
        ok: false,
        error: `This channel has ${plannedPosts.length} ${noun} sourced from it. Detach or remove those plans first.`,
        code: "CHANNEL_HAS_PLANNED_POSTS",
        plannedPosts,
      };
    }

    await db.update(tables.channels).set({ deletedAt: nowIso(), isOwn: false }).where(eq(tables.channels.id, channelId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), code: "CHANNEL_UNKNOWN" };
  }
}
