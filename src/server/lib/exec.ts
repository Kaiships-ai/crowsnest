import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const execFileRaw = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Promisified `execFile` with sane defaults for shelling out to yt-dlp / whisper-cli /
 * ffmpeg: 120s timeout, 64MB max buffer (yt-dlp `-J` payloads and whisper JSON can be
 * large). Callers may override either default per-call.
 */
export const execFileP = (
  file: string,
  args: readonly string[] = [],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> =>
  execFileRaw(file, args as string[], {
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: DEFAULT_MAX_BUFFER,
    ...options,
  });

/**
 * Resolves `bin` to an absolute path via the shell's `command -v`, or null if it isn't
 * found on PATH. Used to detect optional external binaries (yt-dlp, whisper-cli, ffmpeg)
 * without throwing — callers turn a null into a friendly "not installed" gap/reason.
 */
export async function detectBinary(bin: string): Promise<string | null> {
  try {
    // `sh -c '... "$1"' _ bin` passes `bin` as a positional arg rather than interpolating
    // it into the shell string, so it can't be reinterpreted by the shell.
    const { stdout } = await execFileP("/bin/sh", ["-c", 'command -v "$1"', "_", bin]);
    const resolved = stdout.trim();
    return resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

const DEFAULT_TMP_DIR = "data/tmp";

/**
 * Downloads a remote media URL to a local tmp mp4 via yt-dlp. Shared by the transcript
 * providers (whisper.cpp needs a local file to feed whisper-cli; Groq needs bytes to
 * upload) — either may be handed a `videoUrlOrPath` that turns out to be a URL rather
 * than an already-local path. Filename is a short hash of the URL so repeat calls for
 * the same reel resolve to the same path instead of piling up randomly-named tmp files.
 * Caller owns cleanup (delete the returned path when done).
 */
export async function downloadToTmp(url: string, destDir: string = DEFAULT_TMP_DIR): Promise<string> {
  const bin = await detectBinary(process.env.YTDLP_BIN_PATH ?? "yt-dlp");
  if (!bin) {
    throw new Error("yt-dlp not found on PATH — needed to download remote media (install with `brew install yt-dlp`)");
  }
  await mkdir(destDir, { recursive: true });
  const name = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const dest = path.join(destDir, `${name}.mp4`);
  await execFileP(bin, ["-o", dest, "--no-warnings", "-f", "mp4/best", url]);
  return dest;
}
