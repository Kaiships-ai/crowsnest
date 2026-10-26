import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, notInArray } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { errorMessage, type SimpleResult } from "../lib/action-result";
import { getAssetStore } from "./asset-store";

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export function checkVideoSize(size: number): SimpleResult {
  if (size === 0) return { ok: false, error: "That video file is empty.", code: "PLAN_EMPTY_FILE" };
  if (size > MAX_VIDEO_BYTES) return { ok: false, error: "That video is too large. The limit is 200 MB.", code: "PLAN_FILE_TOO_LARGE" };
  return { ok: true };
}

export async function checkVideoFile(filePath: string): Promise<SimpleResult> {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return { ok: false, error: `No video file at ${filePath}.`, code: "PLAN_FILE_MISSING" };
  const size = checkVideoSize(info.size);
  if (!size.ok) return size;
  const head = Buffer.alloc(12);
  const fh = await open(filePath, "r");
  try {
    await fh.read(head, 0, 12, 0);
  } finally {
    await fh.close();
  }
  // QuickTime .mov also carries ftyp, under the "qt  " brand; it is not an mp4.
  if (info.size < 12 || head.toString("ascii", 4, 8) !== "ftyp" || head.toString("ascii", 8, 12) === "qt  ") {
    return { ok: false, error: "That file is not a valid mp4 video.", code: "PLAN_NOT_MP4" };
  }
  return { ok: true };
}

const LOCKED_STATES = ["publishing", "published"];
const LOCKED: SimpleResult = { ok: false, error: "This post is already publishing or published, so its video is locked.", code: "PLAN_LOCKED" };
const NOT_DRAFT: SimpleResult = {
  ok: false,
  error: "An agent can attach a video only to a draft. A scheduled or failed post can still go out on its own, so only Kai can change its video in Lead Studio.",
  code: "PLAN_NOT_DRAFT",
};

interface VideoLock {
  draftOnly?: boolean;
}

export async function checkPlanTakesVideo(planId: string, { draftOnly = false }: VideoLock = {}): Promise<SimpleResult> {
  const [plan] = await db.select({ state: tables.plannedPosts.state }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, planId));
  if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
  if (LOCKED_STATES.includes(plan.state)) return LOCKED;
  if (draftOnly && plan.state !== "draft") return NOT_DRAFT;
  return { ok: true };
}

/** studio-reel renders `<name>-cover.png` next to `<name>.mp4`; a video without one has no cover. */
async function putSiblingCover(videoPath: string): Promise<string | null> {
  const coverPath = path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}-cover.png`);
  return existsSync(coverPath) ? getAssetStore().put({ path: coverPath }, "thumbnail", "image/png") : null;
}

// Kept out of the "use server" actions module: every export there becomes a browser-callable server action.
export async function attachPlanVideo(planId: string, filePath: string, lock: VideoLock = {}): Promise<SimpleResult> {
  try {
    const takes = await checkPlanTakesVideo(planId, lock);
    if (!takes.ok) return takes;
    const check = await checkVideoFile(filePath);
    if (!check.ok) return check;
    const assetId = await getAssetStore().put({ path: filePath }, "video", "video/mp4");
    const coverAssetId = await putSiblingCover(filePath);
    const updated = await db
      .update(tables.plannedPosts)
      .set({ videoAssetId: assetId, coverAssetId, updatedAt: nowIso() })
      .where(and(eq(tables.plannedPosts.id, planId), lock.draftOnly ? eq(tables.plannedPosts.state, "draft") : notInArray(tables.plannedPosts.state, LOCKED_STATES)))
      .returning({ id: tables.plannedPosts.id });
    if (updated.length === 0) return lock.draftOnly ? NOT_DRAFT : LOCKED;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}
