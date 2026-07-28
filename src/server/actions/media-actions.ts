"use server";

import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { log } from "../lib/logger";
import { ensureAsset } from "../ig/assets";
import { igClient } from "../ig/client";
import { IgError } from "../ig/errors";

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Fetches a post's video on demand (design brief §5 / decision Q3: videos are NOT
 * downloaded during sync — most are never watched, and 30 days of a prolific channel is
 * gigabytes).
 *
 * The interesting part is why this can't just reuse a stored URL: Instagram's media URLs
 * are signed and dead within hours, so by the time someone clicks play the URL captured
 * at sync time is worthless. We therefore ask the sidecar to re-resolve the media's
 * *current* URL first, then download it. That is a real authenticated round-trip on the
 * user's click, which is why the UI shows an explicit fetching state rather than
 * pretending playback is instant.
 */
export async function downloadVideoAction(videoId: string): Promise<ActionResult<{ assetId: string }>> {
  try {
    const rows = await db
      .select({
        id: tables.videos.id,
        externalId: tables.videos.externalId,
        videoAssetId: tables.videos.videoAssetId,
        mediaType: tables.videos.mediaType,
      })
      .from(tables.videos)
      .where(eq(tables.videos.id, videoId))
      .limit(1);

    const video = rows[0];
    if (!video) return { ok: false, error: "That post is no longer in the library." };
    if (video.videoAssetId) return { ok: true, assetId: video.videoAssetId };
    if (video.mediaType === "photo") return { ok: false, error: "This post is a photo — there is no video to download." };

    log.info("video.download.requested", { videoId, externalId: video.externalId });

    const fresh = await igClient.resolveMedia(video.externalId);
    if (!fresh.videoUrl) {
      /**
       * This is no longer "Instagram didn't return a URL", and it is not dead code either.
       *
       * `resolveMedia` now raises IG_DRIFT when a resolved `video` arrives without a
       * `video_url`, and the catch below renders that as a mapper bug — so a video can no
       * longer reach this line. What can is a post we stored as one type that Instagram
       * now resolves as another: `videoUrl` is legitimately null for a carousel (the
       * videos live in the slides) and for a photo. That is a disagreement inside our own
       * data, so blaming Instagram would point at the wrong party twice over.
       *
       * The guard stays regardless of reachability: `ensureAsset` takes a `string`, so
       * TypeScript requires the narrowing.
       */
      log.warn("video.download.type_mismatch", {
        videoId,
        externalId: video.externalId,
        storedMediaType: video.mediaType,
        resolvedMediaType: fresh.mediaType,
      });
      return {
        ok: false,
        error:
          fresh.mediaType === "carousel"
            ? "This post is a carousel — its video is in one of the slides, which can't be downloaded on its own yet."
            : "This post is saved as a video, but Instagram now returns it as a photo. Re-sync the channel to correct it.",
      };
    }

    const assetId = await ensureAsset(fresh.videoUrl, "video");
    await db.update(tables.videos).set({ videoAssetId: assetId, lastRefreshedAt: nowIso() }).where(eq(tables.videos.id, videoId));

    log.info("video.download.finished", { videoId, assetId });
    return { ok: true, assetId };
  } catch (err) {
    const message = err instanceof IgError ? err.userMessage : err instanceof Error ? err.message : String(err);
    log.error("video.download.failed", { videoId, message });
    return { ok: false, error: message };
  }
}
