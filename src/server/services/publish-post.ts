import { stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { getAsset, resolveAssetPath } from "@/server/media/store";
import { getStorageProvider, type StorageProvider } from "@/server/publish/storage-provider";
import { createReelContainer, isGraphConfigured, pollReelContainer, publishReel } from "@/server/graph/client";
import { GraphApiError, type GraphErrorClass } from "@/server/graph/errors";

/**
 * The publish service (implementation plan Phase B, task B3): publishes ONE planned
 * post row — upload -> Reel container -> poll -> publish (skipped on dry-run) -> delete
 * the uploaded object -> write `published`/`failed` plus the error fields. No scheduler
 * and no UI live here; C1 (the scheduler) claims a row to "publishing" with a single
 * atomic `UPDATE ... WHERE state='scheduled'` and then calls this function, but this
 * function is also safe to call directly against any row.
 *
 * Idempotency lives in one place: a row already in a terminal state ("published" or
 * "failed") is a no-op. That is what makes a scheduler re-tick, or a hand re-call, safe
 * — it never re-runs a publish that already happened, and a genuine retry is a policy
 * decision the scheduler makes by first moving the row OFF "failed" before calling this
 * again. This function does not itself lock the row against concurrent callers; the
 * caller's atomic claim is what makes that safe.
 */

type PlannedPostSelect = typeof tables.plannedPosts.$inferSelect;

/** `no_video` / `no_bucket` / `storage` are precondition/upload failures this module
 *  invents; the rest pass straight through from `GraphApiError.errorClass`
 *  (graph/errors.ts). */
export type PublishErrorClass = "no_video" | "no_bucket" | "storage" | GraphErrorClass;

export interface PublishPostResult {
  ok: boolean;
  /** "published"/"failed" mirror the row's stored state. "noop" means the row was
   *  already terminal and nothing ran. "not_found" means no such row exists. */
  state: "published" | "failed" | "noop" | "not_found";
  mediaId?: string | null;
  dryRun?: boolean;
  errorClass?: PublishErrorClass;
  lastError?: string;
}

export interface PublishPostDeps {
  loadRow: (id: string) => Promise<PlannedPostSelect | null>;
  writeRow: (id: string, patch: Partial<PlannedPostSelect>) => Promise<void>;
  /** Resolves the plan's attached video to a real local path, or null if the asset row
   *  is missing or the file is not actually there. Defaults to media/store.ts's
   *  `getAsset` + `resolveAssetPath`, verified against disk with `fs.stat`. */
  resolveVideoPath: (assetId: string) => Promise<string | null>;
  getStorageProvider: () => StorageProvider | null;
  isGraphConfigured: () => boolean;
  createReelContainer: typeof createReelContainer;
  pollReelContainer: typeof pollReelContainer;
  publishReel: typeof publishReel;
  now: () => string;
}

async function defaultLoadRow(id: string): Promise<PlannedPostSelect | null> {
  const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  return row ?? null;
}

async function defaultWriteRow(id: string, patch: Partial<PlannedPostSelect>): Promise<void> {
  await db.update(tables.plannedPosts).set(patch).where(eq(tables.plannedPosts.id, id));
}

async function defaultResolveVideoPath(assetId: string): Promise<string | null> {
  const asset = await getAsset(assetId);
  if (!asset) return null;
  try {
    const localPath = resolveAssetPath(asset.storagePath);
    await stat(localPath);
    return localPath;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: PublishPostDeps = {
  loadRow: defaultLoadRow,
  writeRow: defaultWriteRow,
  resolveVideoPath: defaultResolveVideoPath,
  getStorageProvider,
  isGraphConfigured,
  createReelContainer,
  pollReelContainer,
  publishReel,
  now: nowIso,
};

/** Dry-run is the safe default outside production (plan locked decision 5): unset
 *  `PUBLISH_DRY_RUN` plus a non-production `NODE_ENV` means "run the whole path but
 *  skip the final publish POST", so a dev box never touches the live account by
 *  accident. */
function envDefaultsDryRun(): boolean {
  return process.env.PUBLISH_DRY_RUN === undefined && process.env.NODE_ENV !== "production";
}

function resolveDryRun(row: PlannedPostSelect): boolean {
  return row.dryRun === 1 || process.env.PUBLISH_DRY_RUN === "1" || envDefaultsDryRun();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function publishPlannedPost(postId: string, overrides: Partial<PublishPostDeps> = {}): Promise<PublishPostResult> {
  const deps: PublishPostDeps = { ...DEFAULT_DEPS, ...overrides };

  const row = await deps.loadRow(postId);
  if (!row) return { ok: false, state: "not_found" };
  if (row.state === "published" || row.state === "failed") return { ok: true, state: "noop" };

  const dryRun = resolveDryRun(row);

  const fail = async (errorClass: PublishErrorClass, lastError: string): Promise<PublishPostResult> => {
    await deps.writeRow(postId, {
      state: "failed",
      attemptCount: row.attemptCount + 1,
      errorClass,
      lastError,
      updatedAt: deps.now(),
    });
    return { ok: false, state: "failed", errorClass, lastError };
  };

  const succeed = async (mediaId: string | null): Promise<PublishPostResult> => {
    await deps.writeRow(postId, {
      state: "published",
      dryRun: dryRun ? 1 : 0,
      publishedOwnPostId: mediaId,
      publishedAt: deps.now(),
      lastError: null,
      errorClass: null,
      updatedAt: deps.now(),
    });
    return { ok: true, state: "published", mediaId, dryRun };
  };

  if (!row.videoAssetId) return fail("no_video", "No video attached to this plan.");
  const localPath = await deps.resolveVideoPath(row.videoAssetId);
  if (!localPath) return fail("no_video", "The attached video could not be found on disk.");

  const provider = deps.getStorageProvider();
  if (!provider) return fail("no_bucket", "No storage bucket configured. Set S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET, S3_PUBLIC_BASE.");

  if (!deps.isGraphConfigured()) return fail("auth", "No Instagram Graph API token configured. Set IG_GRAPH_TOKEN and IG_GRAPH_USER_ID.");

  let upload: { publicUrl: string; objectKey: string };
  try {
    upload = await provider.upload(localPath, "video/mp4");
  } catch (err) {
    return fail("storage", errorMessage(err));
  }

  try {
    let containerId: string;
    try {
      ({ containerId } = await deps.createReelContainer({ videoUrl: upload.publicUrl, caption: row.caption ?? "" }));
      await deps.pollReelContainer(containerId);
    } catch (err) {
      if (err instanceof GraphApiError) return await fail(err.errorClass, err.message);
      return await fail("unknown", errorMessage(err));
    }

    if (dryRun) return await succeed(null);

    try {
      const { mediaId } = await deps.publishReel(containerId);
      return await succeed(mediaId);
    } catch (err) {
      if (err instanceof GraphApiError) return await fail(err.errorClass, err.message);
      return await fail("unknown", errorMessage(err));
    }
  } finally {
    // Always cleaned up once the object exists, on every path below this point —
    // success, dry-run, or a container/publish failure. A delete failure is logged and
    // swallowed: it must never flip an otherwise-successful publish to failed, and the
    // logger itself never throws (see lib/logger.ts).
    try {
      await provider.delete(upload.objectKey);
    } catch (err) {
      log.warn("publish.cleanup.delete_failed", { postId, message: errorMessage(err) });
    }
  }
}
