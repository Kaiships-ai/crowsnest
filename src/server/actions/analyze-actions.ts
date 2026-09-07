"use server";

import { eq } from "drizzle-orm";
import { log } from "../lib/logger";
import { db, tables } from "../db";
import { runFramePass } from "../services/frame-pass-runner";

/** Every code `runFramePassAction` can return. Load-bearing per the data contracts'
 *  action convention: the UI branches on `code`, not on `error`'s prose. */
export type FramePassCode =
  | "FRAME_NO_VIDEO_ASSET"
  /** No story beats to key the per-beat layout to. Fixed by analyzing, not by re-running. */
  | "FRAME_NO_BEATS"
  | "FRAME_DOWNLOAD_FAILED"
  | "FRAME_FFMPEG_MISSING"
  | "FRAME_EXTRACT_FAILED"
  | "FRAME_MODEL_FAILED"
  | "FRAME_PARSE_FAILED"
  | "FRAME_VALIDATION_REJECTED"
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
