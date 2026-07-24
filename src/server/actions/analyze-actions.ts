"use server";

import { NoApiKeyError } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";
import { getOrCreateAnalysis } from "../services/analyze";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Thin "use server" wrapper around analyze.ts (Task 2): all real logic — caching,
 * transcript gating, the Claude call — lives in the service, which is already fully
 * covered by its own tests. This layer only translates errors into the ActionResult
 * shape (see sync-actions.ts): NoApiKeyError gets a friendly, feature-specific
 * message, everything else goes through the shared typed-SDK-error mapping
 * (llm/error-message.ts, review finding M1).
 */
function errorMessage(err: unknown): string {
  if (err instanceof NoApiKeyError) return "Add ANTHROPIC_API_KEY in Settings to enable analysis.";
  return llmErrorMessage(err);
}

export async function analyzeVideoAction(videoId: string): Promise<ActionResult> {
  try {
    const analysis = await getOrCreateAnalysis(videoId);
    if (!analysis) return { ok: false, error: "Transcript needed first — import/sync provides it." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
