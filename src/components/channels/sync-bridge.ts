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
  // requireProfile is what makes ok:true mean "this handle resolved and is now tracked".
  // Without it the add path creates a "thin" row when the profile fetch fails (no
  // follower count or avatar, syncError + syncErrorCode set) and reports success, so a
  // typo became a permanently broken column whose only explanation was a line in /logs.
  // The dialog now gets the reason in the ok:false branch and nothing is written.
  //
  // First-run keeps the lenient default on purpose: it collects handles before the
  // Instagram login step, and /profile cannot verify anything until the sidecar has a
  // session. See addChannelAction's own comment.
  //
  // A malformed handle was already rejected before this change: the old normalizer
  // accepted a pasted profile URL and created a row literally named
  // "@https://www.instagram.com/hormozi/", so normalizeHandle throws on junk.
  const result = await addChannelAction(handle, { requireProfile: true });
  if (!result.ok) return result;
  return { ok: true };
}

export async function bridgeImportReel(url: string): Promise<BridgeResult> {
  const result = await importReelAction(url);
  if (!result.ok) return result;
  return { ok: true };
}
