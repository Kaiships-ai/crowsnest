"use server";

import { eq } from "drizzle-orm";
import { NoApiKeyError } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";
import { log } from "../lib/logger";
import { db, tables } from "../db";
import { getOrCreateAnalysis } from "../services/analyze";
import { runFramePass } from "../services/frame-pass-runner";
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
  | "FRAME_MODEL_FAILED"
  | "FRAME_PARSE_FAILED"
  | "FRAME_ALREADY_RUN"
  | "FRAME_UNKNOWN";

type FramePassResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code: FramePassCode };

/**
 * Starts a frame pass for one video and returns its job id. The work happens in
 * `frame-pass-runner.ts`: frames come from watch.py, the reading comes from a Claude Code
 * subprocess limited to `--allowedTools Read`, and the result is written through
 * `persistFramePass`, which rejects any value that cites no frame.
 *
 * A pass costs roughly one model turn per frame and runs for tens of seconds, so the
 * client polls `getFramePassJobAction` rather than holding this action open.
 *
 * Only one pass runs at a time. That is enforced by a partial unique index on
 * `frame_pass_jobs`, not by the check below, so a double click cannot race past it.
 */
export async function runFramePassAction(videoId: string): Promise<FramePassResult<{ jobId: string }>> {
  const [running] = await db
    .select({ id: tables.framePassJobs.id })
    .from(tables.framePassJobs)
    .where(eq(tables.framePassJobs.status, "running"))
    .limit(1);
  if (running) {
    return { ok: false, error: "A frame pass is already running. Passes run one at a time.", code: "FRAME_ALREADY_RUN" };
  }

  try {
    const result = await runFramePass(videoId);
    if (!result.ok) {
      return {
        ok: false,
        error: "The frame pass ran but produced no reading. The Layout section shows why.",
        code: (result.errorCode ?? "FRAME_UNKNOWN") as FramePassCode,
      };
    }
    return { ok: true, jobId: result.jobId };
  } catch (err) {
    log.error("frame_pass.crashed", { videoId, error: (err as Error).message });
    return { ok: false, error: (err as Error).message, code: "FRAME_UNKNOWN" };
  }
}

/** Poll one job. An id we cannot find reads as failed, never as still running, so a lost
 *  job cannot leave the UI spinning forever. */
export async function getFramePassJobAction(
  jobId: string
): Promise<{ status: "running" | "success" | "failed"; error: string | null }> {
  const [job] = await db
    .select({ status: tables.framePassJobs.status, errorMessage: tables.framePassJobs.errorMessage })
    .from(tables.framePassJobs)
    .where(eq(tables.framePassJobs.id, jobId))
    .limit(1);
  if (!job) return { status: "failed", error: "That frame pass job no longer exists." };
  return { status: job.status as "running" | "success" | "failed", error: job.errorMessage ?? null };
}
