import { open, stat } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { errorMessage, type SimpleResult } from "../lib/action-result";
import { getAssetStore } from "./asset-store";

/** Upper bound on a plan video, kept in step with serverActions.bodySizeLimit in next.config.ts. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Checks that a local file is an mp4 a plan can publish: present, non-empty, at most
 *  200 MB, and carrying the ISO base media `ftyp` box at offset 4, so bytes renamed to
 *  .mp4 fail here and not later as an opaque Graph container error. */
export async function checkVideoFile(filePath: string): Promise<SimpleResult> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return { ok: false, error: `No video file at ${filePath}.`, code: "PLAN_FILE_MISSING" };
  if (info.size === 0) return { ok: false, error: "That video file is empty.", code: "PLAN_EMPTY_FILE" };
  if (info.size > MAX_VIDEO_BYTES) return { ok: false, error: "That video is too large. The limit is 200 MB.", code: "PLAN_FILE_TOO_LARGE" };
  const head = Buffer.alloc(12);
  const fh = await open(filePath, "r");
  try {
    await fh.read(head, 0, 12, 0);
  } finally {
    await fh.close();
  }
  if (info.size < 12 || head.toString("ascii", 4, 8) !== "ftyp") {
    return { ok: false, error: "That file is not a valid mp4 video.", code: "PLAN_NOT_MP4" };
  }
  return { ok: true };
}

/** Stores a local mp4 and points the plan's `videoAssetId` at it. Shared by the upload
 *  dialog and the MCP attach tool. Lives outside the "use server" actions module so a
 *  browser can never call it with an arbitrary server path. */
export async function attachPlanVideo(planId: string, filePath: string): Promise<SimpleResult> {
  try {
    const [plan] = await db.select({ state: tables.plannedPosts.state }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, planId));
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (plan.state === "publishing" || plan.state === "published") {
      return { ok: false, error: "This post is already publishing or published, so its video is locked.", code: "PLAN_LOCKED" };
    }
    const check = await checkVideoFile(filePath);
    if (!check.ok) return check;
    const assetId = await getAssetStore().put({ path: filePath }, "video", "video/mp4");
    await db.update(tables.plannedPosts).set({ videoAssetId: assetId, updatedAt: nowIso() }).where(eq(tables.plannedPosts.id, planId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}
