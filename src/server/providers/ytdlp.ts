import { detectBinary, execFileP } from "../lib/exec";
import type { VideoStats } from "./types";

const DEFAULT_BIN = "yt-dlp";

// ---- unknown-narrowing helpers (no `any`, total — never throw on odd payloads) ----
function asRecord(item: unknown): Record<string, unknown> {
  return typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function unixToIso(v: unknown): string {
  return typeof v === "number" ? new Date(v * 1000).toISOString() : new Date(0).toISOString();
}

/** Maps one `yt-dlp -J` payload (single reel) to VideoStats + the owner's canonical @handle. */
export function mapYtdlpJson(item: unknown): VideoStats & { channelHandle: string } {
  const r = asRecord(item);
  const uploaderId = str(r.uploader_id) ?? "";
  return {
    platform: "instagram",
    id: str(r.id) ?? "",
    url: str(r.webpage_url) ?? "",
    caption: str(r.description),
    postedAt: unixToIso(r.timestamp),
    durationSec: num(r.duration),
    thumbnailUrl: str(r.thumbnail),
    videoUrl: str(r.url),
    viewCount: num(r.view_count) ?? null,
    likeCount: num(r.like_count),
    commentCount: num(r.comment_count),
    channelHandle: `@${uploaderId}`,
  };
}

/**
 * Single-URL manual import via the `yt-dlp` binary — NOT part of the sync provider
 * chain (no SocialProvider registration). Used by `importReelByUrl` for "paste a reel
 * link" and for spot-checking a number a provider returned.
 */
export async function fetchReelByUrl(url: string): Promise<VideoStats & { channelHandle: string }> {
  const bin = await detectBinary(process.env.YTDLP_BIN_PATH ?? DEFAULT_BIN);
  if (!bin) {
    throw new Error("yt-dlp not found on PATH — install with `brew install yt-dlp`");
  }
  // `--` ends option parsing, so a URL starting with a dash is read as a positional.
  const { stdout } = await execFileP(bin, ["-J", "--no-warnings", "--", url]);
  const parsed: unknown = JSON.parse(stdout);
  return mapYtdlpJson(parsed);
}
