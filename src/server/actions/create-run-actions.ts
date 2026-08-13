"use server";

import { db, newId, nowIso, tables } from "../db";
import { errorMessage, type ActionResult } from "../lib/action-result";
import { getCreateRun, updateCreateRun } from "../queries/create-runs";

/**
 * Thin "use server" wrappers around the create-runs query layer (D1, create-run
 * tracking). Follows the same shape every other action module in this codebase uses —
 * see saved-post-actions.ts — nothing throws across the boundary.
 *
 * `stopCreateRunAction` lives here rather than in a later task's file because it is a
 * genuine server action (called from the studio's Stop button); Task 4 only calls it,
 * it does not own it.
 */

/** Starts a cook: inserts a `running` create_runs row and hands back its id. The ws
 *  layer that actually spawns the child process is what calls `updateCreateRun` from
 *  here on (pid, heartbeat, terminal status) — this action only claims the row. */
export async function startCreateRunAction(input: { postId: string; slug: string }): Promise<ActionResult<{ runId: string }>> {
  try {
    const id = newId();
    db.insert(tables.createRuns)
      .values({
        id,
        postId: input.postId,
        slug: input.slug,
        status: "running",
        startedAt: nowIso(),
      })
      .run();
    return { ok: true, runId: id };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Stops a cook: kills the tracked pid's process group, then marks the row canceled
 * regardless of whether a live process was actually found to kill — a run whose child
 * already exited on its own is still a run the user asked to stop, and it should not
 * stay `running` forever just because there was nothing left to signal.
 */
export async function stopCreateRunAction(runId: string): Promise<ActionResult<{ stopped: boolean }>> {
  try {
    const run = getCreateRun(runId);
    if (!run) return { ok: false, error: `No create run with id ${runId}` };

    if (run.pid != null) {
      try {
        // Negative pid signals the whole process group so ffmpeg/kokoro/sub-agent
        // children die with the cook, not orphaned. Matches session.ts's kill().
        process.kill(-run.pid, "SIGTERM");
      } catch {
        // ESRCH (group already gone) or EPERM: nothing left to signal.
      }
    }

    updateCreateRun(runId, { status: "canceled", finishedAt: nowIso() });
    return { ok: true, stopped: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
