import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
