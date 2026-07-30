"use server";

import { NoApiKeyError } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";
import type { VideoLayout } from "../llm/schemas";
import { log } from "../lib/logger";
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

/** Every code `runFramePassAction` can return. Load-bearing per the data contracts'
 *  action convention: the UI branches on `code`, not on `error`'s prose. */
export type FramePassCode =
  | "FRAME_NO_VIDEO_ASSET"
  | "FRAME_DOWNLOAD_FAILED"
  | "FRAME_FFMPEG_MISSING"
  | "FRAME_EXTRACT_FAILED"
  | "FRAME_NO_VISION_MODEL"
  | "FRAME_MODEL_FAILED"
  | "FRAME_PARSE_FAILED"
  | "FRAME_ALREADY_RUN"
  | "FRAME_UNKNOWN";

type FramePassResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code: FramePassCode };

/**
 * Runs a frame pass over sampled frames to fill in the video detail screen's Layout
 * section (V1 data contracts, contract 5): on-screen text, text position, cut rhythm,
 * framing. Read from frames, never from the transcript — see CONTEXT.md's Layout entry
 * and the doc comment on `videoAnalyses.layout` in schema.ts.
 *
 * THIS DOES NOT RUN A FRAME PASS, and that is not a stub standing in for a TODO — it is
 * the honest, permanent current state of this system, and this action always returns
 * it. `src/server/llm/client.ts` has no image-input path on either implementation, no
 * frame sampler exists anywhere in `src/server`, and no vision-capable model is
 * configured (`docs/product/frame-pass-spike-prep.md`, wave 0's still-open spike).
 * Building any of that — an ffmpeg frame sampler, an image-capable `LlmClient` method,
 * a `claude` subprocess bridge — is explicitly out of scope for this action: the
 * fastest path to a "working" frame pass without one of those is filling the four
 * layout fields by guessing from the transcript, which is exactly the fabrication this
 * feature exists to prevent.
 *
 * So this action always fails, always with the same code, and never writes a partial
 * `layout`. That is what makes the "not yet analyzed" state correct on day one: every
 * video shows four dashes and a "Run frame pass" control explaining why it can't run
 * yet, because that is the truth until the frame pass spike answers its open question
 * and someone builds the real pass on these already-migrated columns.
 */
export async function runFramePassAction(
  videoId: string,
  opts?: { force?: boolean; maxFrames?: number }
): Promise<FramePassResult<{ layout: VideoLayout; framesSampled: number; frameModel: string }>> {
  log.debug("frame_pass.blocked", { videoId, force: opts?.force, maxFrames: opts?.maxFrames, reason: "no vision-capable model wired up" });
  return {
    ok: false,
    error: "Layout needs a vision-capable model, which isn't wired up yet. The other tabs still work.",
    code: "FRAME_NO_VISION_MODEL",
  };
}
