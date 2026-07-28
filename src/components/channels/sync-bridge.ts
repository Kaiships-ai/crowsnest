/**
 * The ONLY file in this codebase allowed to reference phase-2A modules (Global
 * Constraints, phase2b plan). Delegates to the sync engine's Server Actions
 * (src/server/actions/sync-actions.ts) and adapts their richer ActionResult<T> shape
 * down to the simple BridgeResult the phase-2B UI was already built against.
 *
 * What it deliberately no longer does is start syncs. It used to expose `bridgeSyncAll`
 * and `bridgeSyncChannel`, which awaited a Server Action that ran the entire sync
 * inline: the client held one promise open for minutes, a reload lost the run, and the
 * only report at the end was a single toast. Starting a sync now goes through
 * `useSyncProgress().start()`, which returns as soon as the job row exists and then
 * polls `sync_jobs`; per-channel failures are rendered by `SyncProgressPanel`, which
 * gives each gap an actionable sentence and its own retry button rather than collapsing
 * a whole run into one string. Those exports and their gap-reconciliation helpers were
 * deleted rather than left dangling — an exported blocking sync path is an invitation to
 * reintroduce exactly the UX bug this pass removed.
 *
 * What remains is the add/import half, which has no progress to report: both are single
 * short requests, and `add-channel-dialog.tsx` is their only caller.
 */

import { addChannelAction, importReelAction } from "@/server/actions/sync-actions";

export type BridgeResult = { ok: true } | { ok: false; error: string };

export async function bridgeAddChannel(handle: string): Promise<BridgeResult> {
  const result = await addChannelAction(handle);
  if (!result.ok) return result;
  // addChannel() still creates a "thin" channel row when the profile fetch fails
  // (no follower count/avatar, syncError + syncErrorCode set on the row) rather than
  // refusing to track the handle, so ok:true here is truthful: a channel really was
  // tracked. That failure surfaces on the channel row's own warning icon, not through
  // this dialog's toast. An INVALID handle, by contrast, now throws and lands in the
  // ok:false branch above — the old normalizer accepted a pasted profile URL and
  // created a row literally named "@https://www.instagram.com/hormozi/".
  return { ok: true };
}

export async function bridgeImportReel(url: string): Promise<BridgeResult> {
  const result = await importReelAction(url);
  if (!result.ok) return result;
  return { ok: true };
}
