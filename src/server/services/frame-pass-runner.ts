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

/**
 * Whether a failed write is the `frame_pass_jobs` partial unique index refusing a second
 * concurrent "running" row (lock_key is a constant, so only one row across the whole
 * table may be "running" at a time). The driver's message text is a fallback, not the
 * test — matching only on "UNIQUE constraint failed" ties this to a string a drizzle
 * wrapping or driver swap can change. Same shape as `media/store.ts` and
 * `sync-engine.ts#isUniqueViolation`.
 */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) return true;
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export async function runFramePass(videoId: string, deps: Partial<FramePassDeps> = {}): Promise<FramePassRunResult> {
  // Declared before `ask` so the closure below can read it. It is null here and assigned
  // the temp frame dir long before `ask` is ever called, so the call sees the real dir.
  let workDir: string | null = null;

  const extract = deps.extractFrames ?? ((v, o) => realExtractFrames(v, o));
  const ask =
    deps.runClaudeTask ??
    ((p) => realRunClaudeTask(p, workDir ? { cwd: workDir, addDirs: [workDir] } : {}));

  const jobId = newId();
  try {
    await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: nowIso() });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Another pass already holds the lock. Do NOT create a second row — report the id of
    // the job that actually holds it, so a caller polling `jobId` watches the real run.
    const [running] = await db
      .select({ id: tables.framePassJobs.id })
      .from(tables.framePassJobs)
      .where(eq(tables.framePassJobs.status, "running"))
      .limit(1);
    log.warn("frame_pass.already_running", { videoId, runningJobId: running?.id ?? null });
    return { ok: false, jobId: running?.id ?? jobId, framesSampled: null, errorCode: "FRAME_ALREADY_RUN" };
  }

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
      // Distinct from FRAME_PARSE_FAILED on purpose: this is not malformed JSON, it is the
      // validator's anti-fabrication guard (or another persistFramePass rejection) correctly
      // refusing a value that cites no frame. Blurring the two would hide the one distinction
      // this whole feature exists to make.
      return await fail(jobId, videoId, "FRAME_VALIDATION_REJECTED", (err as Error).message);
    }

    await db.update(tables.framePassJobs)
      .set({ status: "success", finishedAt: nowIso() })
      .where(eq(tables.framePassJobs.id, jobId));

    log.info("frame_pass.succeeded", { videoId, jobId, frames: frames.length, costUsd: result.costUsd, turns: result.turns });
    return { ok: true, jobId, framesSampled: frames.length, errorCode: null };
  } catch (err) {
    // Catches everything the four narrow try/catches above do not: resolveVideoFile,
    // mkdtempSync, the heartbeat update, and the final success update. Without this, any
    // one of those throwing leaves the job row stuck at "running" forever — and because
    // lock_key is a constant, one stuck row is a global outage, not a per-video one. fail()
    // is itself bulletproof (see below), so routing here is always safe.
    return await fail(jobId, videoId, "FRAME_UNKNOWN", (err as Error).message);
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Closes out a job as failed. Must never itself leave the row stuck "running" or throw:
 * `recordFramePassFailure` and the job-row update are independently guarded, so a failure
 * in one does not skip the other, and a failure in the second does not mask the original
 * error that got us here.
 */
async function fail(jobId: string, videoId: string, code: string, message: string): Promise<FramePassRunResult> {
  try {
    await recordFramePassFailure(videoId, message);
  } catch (recordErr) {
    log.error("frame_pass.record_failure_failed", { videoId, jobId, code, error: (recordErr as Error).message });
  }
  try {
    await db.update(tables.framePassJobs)
      .set({ status: "failed", finishedAt: nowIso(), errorCode: code, errorMessage: message })
      .where(eq(tables.framePassJobs.id, jobId));
  } catch (updateErr) {
    log.error("frame_pass.job_update_failed", { videoId, jobId, code, error: (updateErr as Error).message });
  }
  log.warn("frame_pass.failed", { videoId, jobId, code, message });
  return { ok: false, jobId, framesSampled: null, errorCode: code };
}
