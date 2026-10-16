import { open, stat } from "node:fs/promises";
import { and, eq, notInArray } from "drizzle-orm";
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
  // QuickTime .mov also carries ftyp, under the "qt  " brand; it is not an mp4.
  if (info.size < 12 || head.toString("ascii", 4, 8) !== "ftyp" || head.toString("ascii", 8, 12) === "qt  ") {
    return { ok: false, error: "That file is not a valid mp4 video.", code: "PLAN_NOT_MP4" };
  }
  return { ok: true };
}

const LOCKED_STATES = ["publishing", "published"];
const LOCKED: SimpleResult = { ok: false, error: "This post is already publishing or published, so its video is locked.", code: "PLAN_LOCKED" };

/** Stores a local mp4 and points the plan's `videoAssetId` at it. Shared by the upload
 *  dialog and the MCP attach tool. Not in the "use server" actions module, where every
 *  export becomes a server action the browser can call with any path. */
export async function attachPlanVideo(planId: string, filePath: string): Promise<SimpleResult> {
  try {
    const [plan] = await db.select({ state: tables.plannedPosts.state }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, planId));
    if (!plan) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
    if (LOCKED_STATES.includes(plan.state)) return LOCKED;
    const check = await checkVideoFile(filePath);
    if (!check.ok) return check;
    const assetId = await getAssetStore().put({ path: filePath }, "video", "video/mp4");
    // The state guard repeats here because put can take seconds, long enough for the
    // scheduler to claim the plan.
    const updated = await db
      .update(tables.plannedPosts)
      .set({ videoAssetId: assetId, updatedAt: nowIso() })
      .where(and(eq(tables.plannedPosts.id, planId), notInArray(tables.plannedPosts.state, LOCKED_STATES)))
      .returning({ id: tables.plannedPosts.id });
    if (updated.length === 0) return LOCKED;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "PLAN_UNKNOWN" };
  }
}
