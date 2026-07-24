/**
 * The ONLY file in this codebase allowed to reference phase-2A modules (Global
 * Constraints, phase2b plan). Delegates to the real sync engine's Server Actions
 * (src/server/actions/sync-actions.ts) — this file's job is purely to adapt their
 * richer ActionResult<T> shape (which carries channelId/SyncResult/gaps alongside
 * ok:true) down to the simple BridgeResult the phase-2B UI was already built against,
 * and to translate the sync engine's "gap" reporting — a channel-level failure
 * recorded *inside* an ok:true result, never thrown (see sync-engine.ts's
 * syncOneChannel, which is explicitly documented as never throwing per-channel
 * failures) — into the ok:false shape the UI's existing Alert/toast plumbing already
 * knows how to render. No other file in phase 2B needed to change for integration.
 */

import { addChannelAction, importReelAction, syncAllAction, syncChannelAction } from "@/server/actions/sync-actions";
import type { Platform } from "@/server/providers/types";

export type BridgeResult = { ok: true } | { ok: false; error: string };

export async function bridgeAddChannel(handle: string, platform: string): Promise<BridgeResult> {
  const result = await addChannelAction(handle, platform as Platform);
  if (!result.ok) return result;
  // addChannel() never throws when keyless — it still creates a "thin" channel row
  // (no follower count/avatar, syncError set on the row) rather than failing outright,
  // so ok:true here is truthful: a channel really was tracked. addChannelAction's
  // return shape (just { channelId }) doesn't expose syncError to reconcile any
  // earlier than that — the keyless gap surfaces once this channel appears in the
  // table, through its existing syncError warning icon/tooltip (Task 5), not through
  // this dialog's own toast.
  return { ok: true };
}

export async function bridgeSyncChannel(channelId: string): Promise<BridgeResult> {
  return reconcileSyncResult(await syncChannelAction(channelId));
}

export async function bridgeSyncAll(): Promise<BridgeResult> {
  return reconcileSyncResult(await syncAllAction());
}

export async function bridgeImportReel(url: string): Promise<BridgeResult> {
  const result = await importReelAction(url);
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * A keyless run (or every provider in the fallback chain dead) never throws — it comes
 * back as an otherwise-ok:true SyncResult with zero channelsSynced and a `gaps` entry
 * per failed channel, so a naive `result.ok` check would show a false "synced" toast on
 * total failure. Maps that specific case (nothing succeeded, at least one gap) down to
 * ok:false so the UI's existing error-toast path surfaces the gap's own message —
 * "no provider configured" in the keyless case. A partial success (some channels
 * synced, some gapped) still reports ok:true since real work did happen; surfacing
 * per-gap detail on a partial run is a richer UI than the phase-2B bridge's binary
 * BridgeResult supports, and isn't what this integration pass asked for.
 */
function reconcileSyncResult(result: Awaited<ReturnType<typeof syncAllAction>>): BridgeResult {
  if (!result.ok) return result;
  if (result.channelsSynced === 0 && result.gaps.length > 0) {
    return { ok: false, error: result.gaps[0].error };
  }
  return { ok: true };
}
