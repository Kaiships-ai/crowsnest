import { createHash } from "node:crypto";
import { db, newId, nowIso, tables } from "../db";
import { eq } from "drizzle-orm";
import { log } from "../lib/logger";
import { igClient, type IgClient } from "./client";
import { IgError } from "./errors";

/**
 * Turns an expiring Instagram CDN URL into a durable local asset row.
 *
 * The sidecar does the actual download (it owns the authenticated session and the right
 * headers) and returns content-addressed metadata; this module records it. Nothing here
 * ever hands a CDN URL back to a caller — that is the whole point of the rebuild.
 *
 * Dedupe is by sha256: the same bytes seen twice (an unchanged thumbnail on a re-sync,
 * a reel that reuses a frame) collapse to one row and one file. The unique index on
 * media_assets.sha256 is the enforcement; the SELECT here is just the fast path.
 */

export interface EnsureAssetDeps {
  client?: Pick<IgClient, "download">;
}

export type AssetKind = "thumbnail" | "video" | "avatar";

function sourceUrlHash(url: string): string {
  // sha1 of the signed URL, kept for correlation when debugging a bad download.
  // The URL itself is deliberately never persisted — it expires and must never be
  // renderable by a client.
  return createHash("sha1").update(url).digest("hex");
}

/**
 * Downloads `url` (if we don't already have those bytes) and returns the media_assets id.
 *
 * Throws `IgError` on failure — callers isolate per-asset failures themselves so that one
 * dead thumbnail never costs us the post's metadata.
 */
export async function ensureAsset(url: string, kind: AssetKind, deps: EnsureAssetDeps = {}): Promise<string> {
  const client = deps.client ?? igClient;
  const result = await client.download({ url, kind });

  if (!result || typeof result.sha256 !== "string" || result.sha256.length === 0) {
    throw new IgError("IG_ASSET_DOWNLOAD", "Sidecar returned no sha256 for a download", { detail: { kind } });
  }
  if (!Number.isFinite(result.bytes) || result.bytes <= 0) {
    // A zero-byte file is a failure wearing a success costume. Refuse it here so it can
    // never become a "downloaded" asset that renders as a broken image.
    throw new IgError("IG_ASSET_DOWNLOAD", `Download produced ${result.bytes} bytes`, { detail: { kind, path: result.path } });
  }

  const existing = await db
    .select({ id: tables.mediaAssets.id })
    .from(tables.mediaAssets)
    .where(eq(tables.mediaAssets.sha256, result.sha256))
    .limit(1);
  if (existing[0]) {
    log.debug("asset.dedupe.hit", { kind, sha256: result.sha256 });
    return existing[0].id;
  }

  const id = newId();
  try {
    await db.insert(tables.mediaAssets).values({
      id,
      sha256: result.sha256,
      kind,
      contentType: result.contentType,
      byteSize: result.bytes,
      width: result.width ?? null,
      height: result.height ?? null,
      durationSec: result.durationSec ?? null,
      storagePath: result.path,
      sourceUrlHash: sourceUrlHash(url),
      downloadedAt: nowIso(),
      lastVerifiedAt: nowIso(),
    });
  } catch (err) {
    // Lost a race against a concurrent download of identical bytes: the unique index
    // fired. Re-select rather than failing — the other writer's row is just as good.
    const raced = await db
      .select({ id: tables.mediaAssets.id })
      .from(tables.mediaAssets)
      .where(eq(tables.mediaAssets.sha256, result.sha256))
      .limit(1);
    if (raced[0]) {
      log.debug("asset.dedupe.race", { kind, sha256: result.sha256 });
      return raced[0].id;
    }
    throw err;
  }

  log.info("asset.downloaded", { kind, sha256: result.sha256, bytes: result.bytes, contentType: result.contentType });
  return id;
}

/**
 * Best-effort variant used inside the sync loop: returns null instead of throwing, but
 * ALWAYS logs and reports the failure through the returned flag so the caller can count
 * it. This is isolation, not suppression — the distinction the goal cares about.
 */
export async function tryEnsureAsset(
  url: string | null,
  kind: AssetKind,
  ctx: { videoExternalId?: string; channelHandle?: string },
  deps: EnsureAssetDeps = {}
): Promise<{ assetId: string | null; failed: boolean }> {
  if (!url) return { assetId: null, failed: false };
  try {
    return { assetId: await ensureAsset(url, kind, deps), failed: false };
  } catch (err) {
    const code = err instanceof IgError ? err.code : "IG_UNKNOWN";
    log.error("asset.download.failed", {
      kind,
      code,
      message: err instanceof Error ? err.message : String(err),
      videoExternalId: ctx.videoExternalId,
      channelHandle: ctx.channelHandle,
    });
    return { assetId: null, failed: true };
  }
}
