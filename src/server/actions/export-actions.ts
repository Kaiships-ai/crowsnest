"use server";

import { buildScriptPrompt, buildVideoPrompt } from "../services/export";

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Thin "use server" wrappers around export.ts (Task 7): all real logic — markdown
 * assembly, graceful degradation when analysis is absent — lives in the service,
 * which is already fully covered by its own snapshot tests.
 */
export async function buildVideoPromptAction(videoId: string): Promise<ActionResult<{ prompt: string }>> {
  try {
    const prompt = await buildVideoPrompt(videoId);
    if (prompt === null) return { ok: false, error: "Video not found." };
    return { ok: true, prompt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildScriptPromptAction(scriptId: string): Promise<ActionResult<{ prompt: string }>> {
  try {
    const prompt = await buildScriptPrompt(scriptId);
    if (prompt === null) return { ok: false, error: "Script not found." };
    return { ok: true, prompt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
