import path from "node:path";
import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { VideoLayoutSchema, type VideoLayout } from "@/server/llm/schemas";

/**
 * Resolve the on-disk video file the frame pass session should run `/watch` against.
 * Returns the absolute path when the video has a downloaded `video` media asset, or a
 * reason string when it does not (no asset yet, wrong kind). Videos are not eagerly
 * downloaded (`EAGER_VIDEO_DOWNLOAD=false`), so a freshly synced post has a thumbnail
 * but no video file until a sync with downloads has run — the workflow needs to say so
 * rather than hand `/watch` a path that is not there.
 */
export async function resolveVideoFile(videoId: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const [video] = await db
    .select({ assetId: tables.videos.videoAssetId })
    .from(tables.videos)
    .where(eq(tables.videos.id, videoId))
    .limit(1);
  if (!video) return { ok: false, reason: `no video row for id ${videoId}` };
  if (!video.assetId) return { ok: false, reason: "video has no downloaded video asset (sync with downloads first)" };

  const [asset] = await db
    .select({ kind: tables.mediaAssets.kind, storagePath: tables.mediaAssets.storagePath })
    .from(tables.mediaAssets)
    .where(eq(tables.mediaAssets.id, video.assetId))
    .limit(1);
  if (!asset) return { ok: false, reason: `video_asset_id points at a missing media_assets row` };
  if (asset.kind !== "video") return { ok: false, reason: `media asset is a ${asset.kind}, not a video` };

  const mediaRoot = process.env.MEDIA_ROOT ?? "data/media";
  return { ok: true, path: path.resolve(mediaRoot, asset.storagePath) };
}

/**
 * Persist a Layout reading (V1 data contracts, contract 5) onto a video's analysis row.
 *
 * The vision itself does not happen in this process. `src/server/llm/client.ts` has no
 * image path, the 9router proxy relays no live vision model (every `nvidia/*` is 410
 * Gone, the `combo` models behind `openclaw`/`hermes` are text-only DeepSeek), so the
 * in-app `runFramePassAction` correctly refuses. The frame pass instead runs in a Claude
 * Code terminal session: `/watch` samples the video's frames, Claude reads them, and the
 * four Layout fields come back as a `VideoLayout`. This function is where that result
 * lands in the database. See `docs/product/frame-pass-workflow.md`.
 *
 * Anti-fabrication guard (the reason the `fromFramesSec` field exists): a field may only
 * carry a non-null `value` if it names at least one frame timestamp it was read from. A
 * value with no backing frames is a guess, which is exactly what this whole feature
 * exists to prevent, so it is rejected here rather than silently stored (the UI would
 * render it as a dash anyway, but the row must not hold a lie).
 */
export interface FramePassInput {
  videoId: string;
  layout: VideoLayout;
  framesSampled: number;
  frameModel: string;
}

export class FramePassValidationError extends Error {}
export class FramePassNoVideoError extends Error {
  constructor(videoId: string) {
    super(`No video row for id ${videoId} — nothing to attach a layout to.`);
  }
}

const LAYOUT_FIELDS = ["onScreenText", "textPosition", "cutRhythm", "framing"] as const;

export async function persistFramePass(input: FramePassInput): Promise<VideoLayout> {
  const layout = VideoLayoutSchema.parse(input.layout);

  if (!Number.isInteger(input.framesSampled) || input.framesSampled <= 0) {
    throw new FramePassValidationError(`framesSampled must be a positive integer, got ${input.framesSampled}.`);
  }
  if (input.frameModel.trim() === "") {
    throw new FramePassValidationError("frameModel must name the model that read the frames.");
  }
  for (const key of LAYOUT_FIELDS) {
    const field = layout[key];
    if (field.value !== null && field.fromFramesSec.length === 0) {
      throw new FramePassValidationError(
        `Layout field "${key}" has a value but names no source frames. A reading with no backing frame is a guess; drop the value or cite the frames it came from.`
      );
    }
  }

  const [video] = await db.select({ id: tables.videos.id }).from(tables.videos).where(eq(tables.videos.id, input.videoId)).limit(1);
  if (!video) throw new FramePassNoVideoError(input.videoId);

  const now = nowIso();
  const cols = {
    layout,
    framesSampled: input.framesSampled,
    frameModel: input.frameModel,
    framePassAt: now,
    framePassError: null,
  };

  const [existing] = await db
    .select({ videoId: tables.videoAnalyses.videoId })
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, input.videoId))
    .limit(1);

  if (existing) {
    await db.update(tables.videoAnalyses).set(cols).where(eq(tables.videoAnalyses.videoId, input.videoId));
  } else {
    // No text analysis yet: the layout pass is allowed to land first. The hook/structure
    // columns stay null (Analyze fills them on its own pass), so this row is a valid
    // "layout only" analysis until then, not a half-written text analysis.
    await db.insert(tables.videoAnalyses).values({ videoId: input.videoId, createdAt: now, ...cols });
  }

  return layout;
}

/**
 * Record that a frame pass was attempted and produced no reading. Keeps the schema's
 * "never run" (both `layout` and `framePassError` null) distinct from "ran and came back
 * empty" (`framePassError` set), which the Layout section renders with different copy.
 */
export async function recordFramePassFailure(videoId: string, error: string): Promise<void> {
  const [video] = await db.select({ id: tables.videos.id }).from(tables.videos).where(eq(tables.videos.id, videoId)).limit(1);
  if (!video) throw new FramePassNoVideoError(videoId);

  const now = nowIso();
  const cols = { layout: null, framesSampled: null, frameModel: null, framePassAt: now, framePassError: error };

  const [existing] = await db
    .select({ videoId: tables.videoAnalyses.videoId })
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, videoId))
    .limit(1);

  if (existing) {
    await db.update(tables.videoAnalyses).set(cols).where(eq(tables.videoAnalyses.videoId, videoId));
  } else {
    await db.insert(tables.videoAnalyses).values({ videoId, createdAt: now, ...cols });
  }
}
