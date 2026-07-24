import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { detectBinary, downloadToTmp, execFileP } from "../lib/exec";
import type { TranscriptProvider } from "./types";

const DEFAULT_BIN = "whisper-cli";
const DEFAULT_MODEL_PATH = path.join(homedir(), ".cache/whisper/ggml-large-v3-turbo.bin");
// whisper-cli on a 60s reel is ~seconds, but give real-world reels + a cold model-load
// generous headroom over execFileP's normal 120s default.
const WHISPER_TIMEOUT_MS = 300_000;

function modelPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.WHISPER_MODEL_PATH ?? DEFAULT_MODEL_PATH;
}

function whisperBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.WHISPER_CPP_BIN_PATH ?? DEFAULT_BIN;
}

/** True iff whisper-cli resolves on PATH AND the model file exists on disk. */
export async function whisperAvailability(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ available: boolean; reason?: string }> {
  const bin = await detectBinary(whisperBin(env));
  if (!bin) {
    return {
      available: false,
      reason: "whisper-cli not found on PATH (run scripts/setup-local.sh or `brew install whisper-cpp`)",
    };
  }
  const model = modelPath(env);
  if (!existsSync(model)) {
    return { available: false, reason: `whisper model not found at ${model} (download ggml-large-v3-turbo.bin)` };
  }
  return { available: true };
}

/** Parses `whisper-cli --output-json` output into joined trimmed text + total duration (sec). */
export function parseWhisperJson(json: unknown): { text: string; durationSec: number } {
  const root = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  const segments = Array.isArray(root.transcription) ? root.transcription : [];
  const parts: string[] = [];
  let maxToMs = 0;
  for (const seg of segments) {
    const s = typeof seg === "object" && seg !== null ? (seg as Record<string, unknown>) : {};
    if (typeof s.text === "string" && s.text.trim().length > 0) parts.push(s.text.trim());
    const offsets = typeof s.offsets === "object" && s.offsets !== null ? (s.offsets as Record<string, unknown>) : {};
    if (typeof offsets.to === "number" && offsets.to > maxToMs) maxToMs = offsets.to;
  }
  return { text: parts.join(" "), durationSec: Math.round((maxToMs / 1000) * 10) / 10 };
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function jsonSidecar(filePath: string): string {
  return filePath.replace(/\.[^./]+$/, "") + ".json";
}

async function runWhisper(bin: string, filePath: string): Promise<{ text: string; durationSec: number }> {
  const outBase = filePath.replace(/\.[^./]+$/, "");
  await execFileP(bin, ["-m", modelPath(), "-f", filePath, "--output-json", "--output-file", outBase, "-nt"], {
    timeout: WHISPER_TIMEOUT_MS,
  });
  const raw = await readFile(jsonSidecar(filePath), "utf8");
  return parseWhisperJson(JSON.parse(raw));
}

export class WhisperCppProvider implements TranscriptProvider {
  readonly name = "whisper-cpp-local";

  async transcribe(videoUrlOrPath: string): Promise<{ text: string; language?: string; durationSec: number }> {
    const availability = await whisperAvailability();
    const bin = await detectBinary(whisperBin());
    if (!availability.available || !bin) throw new Error(availability.reason ?? "whisper-cli unavailable");

    const isRemote = isUrl(videoUrlOrPath);
    const sourcePath = isRemote ? await downloadToTmp(videoUrlOrPath) : videoUrlOrPath;
    const cleanup = new Set<string>([jsonSidecar(sourcePath)]);
    if (isRemote) cleanup.add(sourcePath);

    try {
      try {
        return await runWhisper(bin, sourcePath);
      } catch (whisperErr) {
        // whisper-cli couldn't decode the source directly (e.g. built without ffmpeg
        // support) — fall back to extracting a 16kHz mono wav via ffmpeg, then retry once.
        const ffmpegBin = await detectBinary("ffmpeg");
        if (!ffmpegBin) {
          throw new Error(
            `whisper-cli run failed and ffmpeg is unavailable for a wav fallback: ${String(whisperErr)}`
          );
        }
        const wavPath = sourcePath.replace(/\.[^./]+$/, "") + ".16k.wav";
        cleanup.add(wavPath);
        cleanup.add(jsonSidecar(wavPath));
        await execFileP(ffmpegBin, ["-y", "-i", sourcePath, "-ar", "16000", "-ac", "1", wavPath]);
        return await runWhisper(bin, wavPath);
      }
    } finally {
      await Promise.all([...cleanup].map((f) => unlink(f).catch(() => {})));
    }
  }
}
