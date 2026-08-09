"use server";

import { generateIdea } from "../services/ideas";

/**
 * Server action backing the manual "Generate idea" trigger (a video's detail screen, or
 * any other UI that wants one idea right now rather than waiting for the next sync's
 * auto pass).
 *
 * Follows the same shape every other action module in this codebase uses: nothing
 * throws across the boundary, every failure carries a `code` so the caller can tell
 * apart "nothing came back" from a genuine surprise. Matches `saved-post-actions.ts`'s
 * own `ActionResult` union.
 */

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Generates (or refreshes) the one inbox idea for a video. `generateIdea` itself never
 *  throws — a bad LLM reply comes back as `{ id: "", created: false }` rather than an
 *  exception — so the only failure this wrapper can see is `id` coming back empty, which
 *  it reports as a normal `ok: false` rather than treating a caught exception as the
 *  only failure mode. */
export async function generateIdeaAction(videoId: string): Promise<ActionResult<{ id: string; created: boolean }>> {
  try {
    const result = await generateIdea(videoId);
    if (!result.id) {
      return { ok: false, error: "Could not generate an idea for that video.", code: "IDEA_GENERATE_FAILED" };
    }
    return { ok: true, id: result.id, created: result.created };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "IDEA_GENERATE_UNKNOWN" };
  }
}
