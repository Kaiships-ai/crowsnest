"use server";

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import type { ActionResult, SimpleResult } from "../lib/action-result";

/** studio-reel's checkout; LEAD_STUDIO_COOK_ROOT points a lane at a temp copy. */
export const cookRoot = (): string => process.env.LEAD_STUDIO_COOK_ROOT ?? path.join(os.homedir(), "Desktop/kaiships/studio-reel");

export const reelSlug = (title: string, id: string): string =>
  title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || id;

/** Writes the reel's script where studio-reel's /make-reel reads it, in its workspace/README.md format. */
export async function cookPlanCardAction(id: string): Promise<ActionResult<{ root: string; scriptPath: string; title: string }>> {
  const [row] = await db
    .select({ title: tables.plannedPosts.title, keyword: tables.plannedPosts.keyword, seconds: tables.plannedPosts.targetLengthSec, script: tables.scripts.content })
    .from(tables.plannedPosts)
    .leftJoin(tables.scripts, eq(tables.scripts.id, tables.plannedPosts.scriptId))
    .where(eq(tables.plannedPosts.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
  if (!row.script?.trim()) return { ok: false, error: "This reel has no script to cook.", code: "COOK_NO_SCRIPT" };
  const root = cookRoot();
  if (!existsSync(root)) return { ok: false, error: `studio-reel is not at ${root}.`, code: "COOK_NO_STUDIO" };
  const slug = reelSlug(row.title, id);
  const scriptPath = `workspace/scripts/${slug}.md`;
  const front = [`slug: ${slug}`, row.seconds ? `target_seconds: ${row.seconds}` : null, row.keyword ? `cta_keyword: ${row.keyword}` : null, "status: draft"].filter(Boolean);
  await mkdir(path.join(root, "workspace/scripts"), { recursive: true });
  await writeFile(path.join(root, scriptPath), `---\n${front.join("\n")}\n---\n# ${row.title}\n\n## Script\n${row.script.trim()}\n`);
  return { ok: true, root, scriptPath, title: row.title };
}

export async function markPlanCookingAction(id: string, workspaceId: string): Promise<SimpleResult> {
  const updated = await db.update(tables.plannedPosts).set({ cookWorkspaceId: workspaceId, updatedAt: nowIso() }).where(eq(tables.plannedPosts.id, id)).returning({ id: tables.plannedPosts.id });
  return updated.length ? { ok: true } : { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
}
