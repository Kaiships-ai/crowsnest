import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { extractFrames as realExtractFrames, type SampledFrame } from "./watch-frames";
import { runClaudeTask as realRunClaudeTask, type ClaudeTaskResult } from "./claude-task";
import { buildLayoutPrompt, parseLayoutResult, LayoutParseError } from "./frame-pass-prompt";
import { persistFramePass, recordFramePassFailure, resolveVideoFile } from "./frame-pass";

/**
 * Orchestrates one frame pass: extract frames, have a read-only Claude subprocess read
 * them, write the result through the existing validator.
 *
 * The validator is not re-implemented here on purpose. `persistFramePass` already refuses
 * any field carrying a value while citing no frames, and that check was written for a
 * human doing this by hand. It applies to a model without changes, which is what makes
 * the anti-fabrication rule structural rather than a polite request in a prompt.
 */
export interface FramePassDeps {
  extractFrames: (videoPath: string, outDir: string) => Promise<SampledFrame[]>;
  runClaudeTask: (prompt: string) => Promise<ClaudeTaskResult>;
}

export interface FramePassRunResult {
  ok: boolean;
  jobId: string;
  framesSampled: number | null;
  errorCode: string | null;
}

const MODEL_LABEL = "claude-code/watch+sonnet";

export async function runFramePass(videoId: string, deps: Partial<FramePassDeps> = {}): Promise<FramePassRunResult> {
  const extract = deps.extractFrames ?? ((v, o) => realExtractFrames(v, o));
  const ask = deps.runClaudeTask ?? ((p) => realRunClaudeTask(p));

  const jobId = newId();
  await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: nowIso() });

  let workDir: string | null = null;
  try {
    const resolved = await resolveVideoFile(videoId);
    if (!resolved.ok) {
      return await fail(jobId, videoId, "FRAME_NO_VIDEO_ASSET", resolved.reason);
    }

    workDir = mkdtempSync(path.join(tmpdir(), "crowsnest-frames-"));

    let frames: SampledFrame[];
    try {
      frames = await extract(resolved.path, workDir);
    } catch (err) {
      return await fail(jobId, videoId, "FRAME_EXTRACT_FAILED", (err as Error).message);
    }
    await db.update(tables.framePassJobs)
      .set({ heartbeatAt: nowIso(), framesSampled: frames.length })
      .where(eq(tables.framePassJobs.id, jobId));

    let result: ClaudeTaskResult;
    try {
      result = await ask(buildLayoutPrompt(frames));
    } catch (err) {
      return await fail(jobId, videoId, "FRAME_MODEL_FAILED", (err as Error).message);
    }

    let layout;
    try {
      layout = parseLayoutResult(result.text);
    } catch (err) {
      const code = err instanceof LayoutParseError ? "FRAME_PARSE_FAILED" : "FRAME_UNKNOWN";
      return await fail(jobId, videoId, code, (err as Error).message);
    }

    try {
      await persistFramePass({ videoId, layout, framesSampled: frames.length, frameModel: MODEL_LABEL });
    } catch (err) {
      // Includes the anti-fabrication rejection. A model that invented a reading lands
      // here, and that is the guard working, not a bug to route around.
      return await fail(jobId, videoId, "FRAME_PARSE_FAILED", (err as Error).message);
    }

    await db.update(tables.framePassJobs)
      .set({ status: "success", finishedAt: nowIso() })
      .where(eq(tables.framePassJobs.id, jobId));

    log.info("frame_pass.succeeded", { videoId, jobId, frames: frames.length, costUsd: result.costUsd, turns: result.turns });
    return { ok: true, jobId, framesSampled: frames.length, errorCode: null };
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

async function fail(jobId: string, videoId: string, code: string, message: string): Promise<FramePassRunResult> {
  await recordFramePassFailure(videoId, message);
  await db.update(tables.framePassJobs)
    .set({ status: "failed", finishedAt: nowIso(), errorCode: code, errorMessage: message })
    .where(eq(tables.framePassJobs.id, jobId));
  log.warn("frame_pass.failed", { videoId, jobId, code, message });
  return { ok: false, jobId, framesSampled: null, errorCode: code };
}
