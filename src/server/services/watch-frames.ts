import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

/**
 * Stage 1 of the frame pass. Turns an mp4 into JPEGs plus the timestamp each was taken
 * at, by shelling out to the claude-video plugin's watch.py (yt-dlp plus ffmpeg, no
 * model involved). Deliberately knows nothing about Claude or about layouts.
 */
export interface SampledFrame {
  path: string;
  timestampSeconds: number;
  reason: string;
}

export class WatchExtractError extends Error {}

const DEFAULT_SCRIPT =
  process.env.WATCH_SCRIPT_PATH ??
  join(homedir(), ".claude/plugins/cache/claude-video/watch/0.2.0/skills/watch/scripts/watch.py");

/** Frame lines look like: - `/abs/frame_0002.jpg` (t=00:03, reason=scene-change) */
const FRAME_LINE = /^- `([^`]+\.jpg)` \(t=([0-9:]+), reason=([^)]+)\)/;

function toSeconds(clock: string): number {
  const parts = clock.split(":").map(Number);
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

export function parseWatchReport(stdout: string): SampledFrame[] {
  const frames: SampledFrame[] = [];
  for (const line of stdout.split("\n")) {
    const m = FRAME_LINE.exec(line.trim());
    if (!m) continue;
    frames.push({ path: m[1], timestampSeconds: toSeconds(m[2]), reason: m[3] });
  }
  return frames;
}

export async function extractFrames(
  videoPath: string,
  outDir: string,
  opts: { scriptPath?: string; maxFrames?: number; timeoutMs?: number } = {}
): Promise<SampledFrame[]> {
  const script = opts.scriptPath ?? process.env.WATCH_SCRIPT_PATH ?? DEFAULT_SCRIPT;
  const args = [script, videoPath, "--no-whisper", "--out-dir", outDir];
  if (opts.maxFrames) args.push("--max-frames", String(opts.maxFrames));

  const { stdout, stderr, code } = await run("python3", args, opts.timeoutMs ?? 120_000);
  if (code !== 0) {
    throw new WatchExtractError(`watch.py exited ${code}: ${stderr.trim().slice(-400)}`);
  }
  const frames = parseWatchReport(stdout);
  if (frames.length === 0) {
    throw new WatchExtractError("watch.py produced no frames for this video");
  }
  return frames;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // stdin is ignored, never inherited: a child that shares our stdin can consume bytes
    // the caller still needs. That silently corrupted a video id during rehearsal.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WatchExtractError(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new WatchExtractError(`${cmd} failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
