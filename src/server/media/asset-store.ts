import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetUrl, getAsset, recordAsset, resolveAssetPath, storagePathFor, type MediaKind } from "@/server/media/store";

/**
 * A local-file-in, media-asset-id-out seam over the content-addressed media store. This
 * is the only interface application code should depend on to ingest and serve rendered
 * media — a future `R2AssetStore` implements the same shape and swaps `publicUrl` for a
 * bucket URL, replacing the Vercel hosting step. Nothing outside this module (and
 * `store.ts`, which it wraps) should touch `resolveAssetPath` or `recordAsset` directly.
 */
export interface AssetStore {
  /** Ingests a local file into the store and returns its `media_assets` id. The same
   *  bytes ingested twice return the same id (dedup by sha256, enforced by `store.ts`). */
  put(file: { path: string }, kind: "video" | "thumbnail", contentType: string): Promise<string>;
  /** Resolves an id to a readable, on-disk path, or null if the id is unknown. */
  get(id: string): Promise<{ path: string } | null>;
  /** The stable public URL for an id — `/api/media/<id>` for the local backend. */
  publicUrl(id: string): string;
}

const KIND_ALLOWED: readonly MediaKind[] = ["video", "thumbnail"];

export class LocalAssetStore implements AssetStore {
  async put(file: { path: string }, kind: "video" | "thumbnail", contentType: string): Promise<string> {
    if (!KIND_ALLOWED.includes(kind)) {
      throw new Error(`LocalAssetStore.put: unsupported kind ${JSON.stringify(kind)}`);
    }

    const bytes = await readFile(file.path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = storagePathFor(sha256, contentType);
    const destination = resolveAssetPath(storagePath);

    if (!existsSync(destination)) {
      // Reuse the bytes already read for hashing rather than re-reading the source file.
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }

    const row = await recordAsset({
      sha256,
      kind,
      contentType,
      // The bytes already in memory from hashing are the ones on disk — no second stat.
      byteSize: bytes.length,
      storagePath,
    });
    return row.id;
  }

  async get(id: string): Promise<{ path: string } | null> {
    const row = await getAsset(id);
    if (!row) return null;
    return { path: resolveAssetPath(row.storagePath) };
  }

  publicUrl(id: string): string {
    // `assetUrl` returns null only for a null-ish id, which `id: string` already excludes.
    return assetUrl(id) as string;
  }
}

let singleton: LocalAssetStore | null = null;

/** The process-wide `LocalAssetStore`. A later `R2AssetStore` swap happens here, behind
 *  the same `AssetStore` interface, with no changes required at call sites. */
export function getAssetStore(): AssetStore {
  if (!singleton) singleton = new LocalAssetStore();
  return singleton;
}
