"use server";

import { NoApiKeyError } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";
import { getOrCreateAnalysis } from "../services/analyze";
import { NoTranscriptProviderError } from "../transcribe";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Thin "use server" wrapper around analyze.ts (Task 2): all real logic — caching,
 * on-demand transcription, the Claude call — lives in the service, which is already
 * fully covered by its own tests. This layer only translates errors into the
 * ActionResult shape (see sync-actions.ts): NoApiKeyError and NoTranscriptProviderError
 * (final-review finding B1) each get a friendly, feature-specific message, everything
 * else goes through the shared typed-SDK-error mapping (llm/error-message.ts, review
 * finding M1).
 */
function errorMessage(err: unknown): string {
  if (err instanceof NoApiKeyError) return "Add ANTHROPIC_API_KEY in Settings to enable analysis.";
  if (err instanceof NoTranscriptProviderError) {
    return `Couldn't create a transcript — ${err.reasons.map((r) => `${r.name}: ${r.reason}`).join("; ")}`;
  }
  return llmErrorMessage(err);
}

export async function analyzeVideoAction(videoId: string): Promise<ActionResult> {
  try {
    const analysis = await getOrCreateAnalysis(videoId);
    // getOrCreateAnalysis only returns null for a missing video row now that a
    // missing transcript is handled by transcribing on demand instead of bailing —
    // the old "Transcript needed first — import/sync provides it." message was false
    // (neither ever provided one) and is gone.
    if (!analysis) return { ok: false, error: "Video not found — try refreshing the page." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
