import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { errorMessage } from "../lib/action-result";
import { GroqProvider, groqAvailability } from "./groq";
import { WhisperCppProvider, whisperAvailability } from "./whispercpp";

type TranscriptSource = "whisper-local" | "groq";

/** Thrown by getOrCreateTranscript when no transcript provider could produce a result. */
export class NoTranscriptProviderError extends Error {
  readonly reasons: { name: string; reason: string }[];
  constructor(reasons: { name: string; reason: string }[]) {
    super(`no transcript provider available — ${reasons.map((r) => `${r.name}: ${r.reason}`).join("; ")}`);
    this.name = "NoTranscriptProviderError";
    this.reasons = reasons;
  }
}

/**
 * Thrown by getOrCreateTranscript when the video has no locally-downloaded video asset
 * yet. `videos.videoUrl` (an expiring Instagram CDN URL) no longer exists on the schema
 * — there is deliberately no remote-URL fallback here, so a caller can't silently get an
 * empty transcript for a video sync hasn't downloaded bytes for yet.
 */
export class VideoNotDownloadedError extends Error {
  constructor(videoId: string) {
    super(`video ${videoId} has no downloaded video asset yet — sync must download it before it can be transcribed`);
    this.name = "VideoNotDownloadedError";
  }
}

const whisperProvider = new WhisperCppProvider();
const groqProvider = new GroqProvider();

async function persist(
  videoId: string,
  text: string,
  source: TranscriptSource
): Promise<{ text: string; source: string; cached: boolean }> {
  const createdAt = nowIso();
  await db
    .insert(tables.transcripts)
    .values({ videoId, text, source, createdAt })
    .onConflictDoUpdate({ target: tables.transcripts.videoId, set: { text, source, createdAt } });
  return { text, source, cached: false };
}

/**
 * Cache-first transcript lookup: returns the committed `transcripts` row for `videoId`
 * if one exists, otherwise runs the provider fallback chain (local whisper.cpp, then
 * Groq) against the video's media URL, persists the result, and returns it. Throws
 * `NoTranscriptProviderError` (carrying a reason per provider) when neither is usable.
 */
export async function getOrCreateTranscript(
  videoId: string
): Promise<{ text: string; source: string; cached: boolean }> {
  const cached = await db.select().from(tables.transcripts).where(eq(tables.transcripts.videoId, videoId)).limit(1);
  const cachedRow = cached[0];
  if (cachedRow) {
    return { text: cachedRow.text, source: cachedRow.source, cached: true };
  }

  const videoRows = await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  const video = videoRows[0];
  if (!video) throw new Error(`getOrCreateTranscript: video ${videoId} not found`);

  // Resolve bytes from the local asset store — never from a remote URL. `videoAssetId`
  // is only set once sync has actually downloaded the media, so its absence means
  // exactly "not downloaded yet", not "unavailable transcript provider".
  if (!video.videoAssetId) throw new VideoNotDownloadedError(videoId);
  // Dynamic import (not a top-level one): `../media/store` pulls in `@/server/config`,
  // which validates the environment at module load and throws if IG_SERVICE_TOKEN is
  // missing. A top-level import would make that validation fire the moment anything
  // merely imports this module (e.g. analyze.ts, for the NoTranscriptProviderError
  // class) even when it never calls getOrCreateTranscript — deferring it to here means
  // it only runs when a real local-asset lookup is actually about to happen.
  const { getAsset, resolveAssetPath } = await import("../media/store");
  const asset = await getAsset(video.videoAssetId);
  if (!asset) throw new VideoNotDownloadedError(videoId);
  const mediaPath = resolveAssetPath(asset.storagePath);

  const reasons: { name: string; reason: string }[] = [];

  const whisperAvail = await whisperAvailability();
  if (whisperAvail.available) {
    try {
      const result = await whisperProvider.transcribe(mediaPath);
      return await persist(videoId, result.text, "whisper-local");
    } catch (err) {
      reasons.push({ name: whisperProvider.name, reason: errorMessage(err) });
    }
  } else {
    reasons.push({ name: whisperProvider.name, reason: whisperAvail.reason ?? "unavailable" });
  }

  const groqAvail = groqAvailability();
  if (groqAvail.available) {
    try {
      const result = await groqProvider.transcribe(mediaPath);
      return await persist(videoId, result.text, "groq");
    } catch (err) {
      reasons.push({ name: groqProvider.name, reason: errorMessage(err) });
    }
  } else {
    reasons.push({ name: groqProvider.name, reason: groqAvail.reason ?? "unavailable" });
  }

  throw new NoTranscriptProviderError(reasons);
}

/** Current availability of each transcript provider, for a Settings-style status list. */
export async function availableTranscriptProviders(): Promise<
  { name: string; available: boolean; reason?: string }[]
> {
  const whisper = await whisperAvailability();
  const groq = groqAvailability();
  return [
    { name: whisperProvider.name, available: whisper.available, reason: whisper.reason },
    { name: groqProvider.name, available: groq.available, reason: groq.reason },
  ];
}
