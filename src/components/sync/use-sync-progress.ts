"use client";

/**
 * Watches a sync run the way the DB actually reports one.
 *
 * Before this existed, "Sync now" awaited a Server Action that ran the whole sync
 * inline: no progress, no cancel, and a run started by the scheduler or in a second
 * browser tab was invisible. This hook replaces that with a poll of `sync_jobs`, which
 * is the only place a run's state genuinely lives — so a run this tab never started
 * still shows up here.
 *
 * Everything it returns comes from a column. It computes no ETA and it fabricates no
 * intermediate values between polls.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cancelSyncAction, getChannelSyncProgressAction, getSyncProgressAction, startSyncAction } from "@/server/actions/sync-actions";
import type { SyncProgress } from "@/server/services/sync-types";
import { isSyncStalled, pollIntervalMs, reducePoll, type PollOutcome, type PollState, type SyncCoverage } from "./sync-progress-view";

/**
 * `visibilitychange` is the whole story on modern browsers — minimising, switching apps
 * and switching tabs all fire it, and it is the only one of the candidate events whose
 * value we can read back synchronously for `useSyncExternalStore`. A `focus` listener
 * was tried and removed: it never changes `visibilityState`, so it produced a
 * subscription that could not move the snapshot.
 */
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function useTabVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    // Server render: assume visible, so the first client poll is scheduled immediately
    // rather than waiting for a hydration-time correction.
    () => true,
  );
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

export interface UseSyncProgressResult {
  progress: SyncProgress | null;
  isRunning: boolean;
  /**
   * How the run on screen relates to the channel this hook was given: `"channel"` for
   * its own run, `"library"` for a library-wide run that includes it, null for neither.
   * Always null on the global (no-channelId) path, where the question has no meaning.
   *
   * This exists so a consumer can word a disabled button honestly — "this channel is
   * syncing" versus "a library sync is running" — from the `channel_id` column rather
   * than by guessing from the handle the run happens to be naming this second.
   */
  coverage: SyncCoverage;
  /** A `running` row whose heartbeat has gone quiet. Strong suspicion that the process
   *  died holding the sync lock — not proof; see `statusDetail`. */
  stalled: boolean;
  /** The last poll or command failure. Never replaces `progress` — see `reducePoll`. */
  error: string | null;
  /**
   * Starts a run. Retrying only the channels that gapped is `start(gaps.map(g =>
   * g.channelId))` — there was a `retryFailed()` wrapper for exactly that, removed
   * because nothing ever called it: the panel is presentational and cannot reach the
   * hook, so every consumer went through `onRetry` -> `start(ids)` and the wrapper sat
   * there tested but unreachable.
   */
  start(channelIds?: string[]): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * `channelId` does two things: it scopes what `start()` syncs when called with no
 * arguments, and it switches the poll to `getChannelSyncProgressAction`, which answers
 * "is a run covering *this* channel" from the `channel_id` column. A run scoped to a
 * different channel is correctly invisible here; a library-wide run is not, because it
 * genuinely does cover this channel and does hold the lock its sync would need.
 */
export function useSyncProgress(opts?: { channelId?: string }): UseSyncProgressResult {
  const channelId = opts?.channelId;
  const [state, setState] = useState<PollState>({ progress: null, coverage: null, error: null });
  /**
   * Kept apart from the poll's own error, because a poll succeeding says only that
   * polling works — it says nothing about whether the button you pressed did anything.
   *
   * Folding the two together had a bug with teeth: a refused `start()` ("a sync is
   * already running") set the error, the very next poll returned `ok`, and the message
   * was wiped inside a few milliseconds. Worse, the refusal itself made `isRunning` flip
   * true, which re-ran the interval effect and fired that clearing poll immediately. The
   * click looked like it had done nothing at all. Polls now never touch this; only
   * another command clears it.
   */
  const [commandError, setCommandError] = useState<string | null>(null);
  const visible = useTabVisible();

  /** The run we are following. Null means "tell me about whatever is latest", which is
   *  how a sync started elsewhere gets adopted. */
  const jobIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    const seq = (requestSeqRef.current += 1);
    let outcome: PollOutcome;
    try {
      if (channelId === undefined) {
        const result = await getSyncProgressAction(jobIdRef.current);
        // The global path has no channel to be covered, so coverage is null by
        // definition rather than by omission.
        outcome = result.ok ? { ok: true, progress: result.progress, coverage: null } : { ok: false, error: result.error };
      } else {
        // Deliberately keyed on the channel, not on jobIdRef: asking by id would re-pin
        // us to a run that may have stopped covering this channel, and would resurrect
        // the very "is this run mine?" guesswork this call exists to remove.
        const result = await getChannelSyncProgressAction(channelId);
        outcome = result.ok ? { ok: true, progress: result.progress, coverage: result.coverage } : { ok: false, error: result.error };
      }
    } catch (err) {
      outcome = { ok: false, error: messageOf(err, "Couldn't read sync progress from the server.") };
    }

    // Two 1 s polls where the first takes 1.5 s land out of order. Applying the older
    // answer would rewind the counters on screen, so a response that a newer one has
    // already overtaken is dropped rather than rendered.
    if (!mountedRef.current || seq <= appliedSeqRef.current) return;
    appliedSeqRef.current = seq;

    if (outcome.ok) {
      // Pin the id only while the run is live. Holding it past the terminal row would
      // stop us ever noticing the next run, which is exactly the blindness this hook
      // was written to remove.
      jobIdRef.current = outcome.progress !== null && outcome.progress.status === "running" ? outcome.progress.jobId : null;
    }
    setState((prev) => reducePoll(prev, outcome));
  }, [channelId]);

  const progress = state.progress;
  const isRunning = progress !== null && progress.status === "running";

  useEffect(() => {
    const intervalMs = pollIntervalMs({ visible, running: isRunning });
    if (intervalMs === null) return;
    // Poll once up front so becoming visible again, or a run flipping to terminal,
    // refreshes now instead of after a whole idle period.
    void poll();
    const id = setInterval(() => void poll(), intervalMs);
    return () => clearInterval(id);
  }, [visible, isRunning, poll]);

  const start = useCallback(
    async (channelIds?: string[]) => {
      const ids = channelIds ?? (channelId === undefined ? undefined : [channelId]);
      setCommandError(null);
      try {
        const result = await startSyncAction(ids);
        if (!result.ok) {
          setCommandError(result.error);
          // A refused start is most often "a sync is already running". Read that run so
          // the answer to "why can't I start one" is the run itself, shown next to the
          // refusal rather than instead of it.
          await poll();
          return;
        }
        jobIdRef.current = result.jobId;
        // Anything already in flight describes the previous run; let its answer be
        // discarded rather than briefly overwrite the run just started.
        appliedSeqRef.current = requestSeqRef.current;
      } catch (err) {
        setCommandError(messageOf(err, "Couldn't start the sync."));
        return;
      }
      await poll();
    },
    [channelId, poll],
  );

  const cancel = useCallback(async () => {
    const jobId = progress?.jobId ?? jobIdRef.current;
    if (jobId === null || jobId === undefined) return;
    setCommandError(null);
    try {
      const result = await cancelSyncAction(jobId);
      if (!result.ok) {
        setCommandError(result.error);
        return;
      }
    } catch (err) {
      setCommandError(messageOf(err, "Couldn't cancel the sync."));
      return;
    }
    // Cancellation is cooperative — the engine notices `cancel_requested` at the next
    // boundary. Re-poll immediately so the button can say "cancelling…" off the real
    // column instead of off the fact that it was clicked.
    await poll();
  }, [progress, poll]);

  return {
    progress,
    isRunning,
    coverage: state.coverage,
    stalled: progress !== null && isSyncStalled(progress),
    // A refused command outranks a polling hiccup: it is the thing the user just tried
    // to do, and it stays put until they try again.
    error: commandError ?? state.error,
    start,
    cancel,
  };
}
