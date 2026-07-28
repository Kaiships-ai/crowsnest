import path from "node:path";
import { eq } from "drizzle-orm";
import { config } from "@/server/config";
import { db, newId, nowIso, tables } from "@/server/db";

/**
 * The media store: the only module that turns a `media_assets` row into a real path on
 * disk, and the only module that writes rows into that table.
 *
 * Two invariants live here and nowhere else:
 *
 *  1. **Nothing outside `MEDIA_ROOT` is ever served.** `resolveAssetPath` is a security
 *     boundary, not a convenience: `storage_path` comes out of the database, and a
 *     database row is not a trusted input (a bad sync, a hand-edited row, a future
 *     import path). It throws rather than returning a "safe fallback" so a caller can
 *     never accidentally proceed with an escaped path.
 *  2. **Assets are content-addressed.** The same bytes fetched twice — the same
 *     thumbnail reused across a carousel, the same avatar across syncs — is one file
 *     and one row, enforced by the `media_assets_sha256` unique index.
 */

export type MediaAsset = typeof tables.mediaAssets.$inferSelect;
export type MediaKind = "thumbnail" | "video" | "avatar";

/** Thrown when a `storage_path` would resolve outside `MEDIA_ROOT`, or is otherwise
 *  unusable as a path. Never caught inside this module — callers must 404, not guess. */
export class MediaPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaPathError";
  }
}

/** Absolute, symlink-free-of-`..` media root. Read from config on every call so a test
 *  (or a future runtime reconfiguration) is not defeated by module-load caching. */
export function mediaRoot(): string {
  return path.resolve(config.MEDIA_ROOT);
}

function assertInsideRoot(candidate: string, root: string, storagePath: string): void {
  // Separator-aware containment. A plain `startsWith(root)` would accept
  // `/media/rootEVIL/x.jpg` for a root of `/media/root` — a real escape.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new MediaPathError(`storage_path escapes MEDIA_ROOT: ${JSON.stringify(storagePath)}`);
  }
}

/**
 * Resolve a row's `storage_path` (always relative to the media root) to an absolute
 * path, refusing anything that escapes the root.
 *
 * Rejects: absolute paths, `..` traversal, NUL bytes, empty strings, and — belt and
 * braces — percent-encoded traversal, in case any caller ever decodes the value before
 * handing it to `fs` (`%2e%2e/` is not traversal to `path.resolve`, but it is to a
 * decoder). The equal-to-root case is rejected too: the root directory is not an asset.
 */
export function resolveAssetPath(storagePath: string): string {
  if (typeof storagePath !== "string" || storagePath.trim() === "") {
    throw new MediaPathError("storage_path is empty");
  }
  if (storagePath.includes("\0")) {
    throw new MediaPathError("storage_path contains a NUL byte");
  }
  if (path.isAbsolute(storagePath)) {
    throw new MediaPathError(`storage_path must be relative to MEDIA_ROOT: ${JSON.stringify(storagePath)}`);
  }

  const root = mediaRoot();
  const resolved = path.resolve(root, storagePath);
  assertInsideRoot(resolved, root, storagePath);
  if (resolved === root) {
    throw new MediaPathError("storage_path resolves to MEDIA_ROOT itself");
  }

  let decoded: string | null = null;
  try {
    decoded = decodeURIComponent(storagePath);
  } catch {
    // A malformed percent-sequence is not decodable by anyone downstream either; the
    // raw form already passed the containment check, so there is nothing more to prove.
    decoded = null;
  }
  if (decoded !== null && decoded !== storagePath) {
    if (path.isAbsolute(decoded)) {
      throw new MediaPathError(`storage_path decodes to an absolute path: ${JSON.stringify(storagePath)}`);
    }
    assertInsideRoot(path.resolve(root, decoded), root, storagePath);
  }

  return resolved;
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** File extension for a content type. Unknown types get `bin` — a wrong-but-honest
 *  extension beats guessing a codec we did not verify. The extension is cosmetic:
 *  serving reads `content_type` from the row, never from the filename. */
export function extensionForContentType(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXT_BY_CONTENT_TYPE[base] ?? "bin";
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Content-addressed layout: `<sha256[0:2]>/<sha256>.<ext>`, relative to `MEDIA_ROOT`.
 * The two-character fan-out keeps any single directory to ~1/256th of the library.
 *
 * The digest is validated as 64 lowercase hex chars because it becomes a path segment;
 * an unvalidated digest is a path-traversal primitive.
 */
export function storagePathFor(sha256: string, contentType: string): string {
  const digest = sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new MediaPathError(`sha256 must be 64 hex characters, got ${JSON.stringify(sha256)}`);
  }
  return `${digest.slice(0, 2)}/${digest}.${extensionForContentType(contentType)}`;
}

/** `/api/media/<id>` — the single source of truth for media URLs. Components must import
 *  this rather than building the string, so the route can move without a repo-wide grep. */
export function assetUrl(assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  return `/api/media/${encodeURIComponent(assetId)}`;
}

export interface RecordAssetInput {
  sha256: string;
  kind: MediaKind;
  contentType: string;
  byteSize: number;
  /** Relative to `MEDIA_ROOT`. Defaults to `storagePathFor(sha256, contentType)`. */
  storagePath?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  /** sha1 of the (expiring) source CDN URL. The URL itself is never stored. */
  sourceUrlHash?: string | null;
  downloadedAt?: string;
}

export async function getAsset(id: string | null | undefined): Promise<MediaAsset | null> {
  if (typeof id !== "string" || id === "") return null;
  const rows = await db.select().from(tables.mediaAssets).where(eq(tables.mediaAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getAssetBySha256(sha256: string): Promise<MediaAsset | null> {
  const digest = sha256.trim().toLowerCase();
  const rows = await db.select().from(tables.mediaAssets).where(eq(tables.mediaAssets.sha256, digest)).limit(1);
  return rows[0] ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) return true;
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

/**
 * Insert a `media_assets` row, or return the existing row for the same sha256.
 *
 * The pre-check is an optimisation, not the guarantee: two downloads of the same bytes
 * can both see "not present" and both insert. The unique index is what actually enforces
 * dedupe, so the constraint violation is caught and the winner re-selected. Any other
 * error propagates — a failed insert must never look like a successful dedupe.
 */
export async function recordAsset(input: RecordAssetInput): Promise<MediaAsset> {
  const digest = input.sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(digest)) {
    throw new MediaPathError(`sha256 must be 64 hex characters, got ${JSON.stringify(input.sha256)}`);
  }
  if (!Number.isInteger(input.byteSize) || input.byteSize < 0) {
    throw new Error(`recordAsset: byteSize must be a non-negative integer, got ${input.byteSize}`);
  }

  const existing = await getAssetBySha256(digest);
  if (existing) return existing;

  const storagePath = input.storagePath ?? storagePathFor(digest, input.contentType);
  // Validate before writing: a row whose path cannot be resolved is a 404 forever.
  resolveAssetPath(storagePath);

  const row = {
    id: newId(),
    sha256: digest,
    kind: input.kind,
    contentType: input.contentType,
    byteSize: input.byteSize,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSec: input.durationSec ?? null,
    storagePath,
    sourceUrlHash: input.sourceUrlHash ?? null,
    downloadedAt: input.downloadedAt ?? nowIso(),
    lastVerifiedAt: null,
  };

  try {
    const inserted = await db.insert(tables.mediaAssets).values(row).returning();
    return inserted[0];
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await getAssetBySha256(digest);
    if (!winner) throw err; // constraint fired for some other reason — do not swallow it.
    return winner;
  }
}
