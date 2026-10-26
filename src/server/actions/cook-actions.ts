"use server";

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import type { ActionResult, SimpleResult } from "../lib/action-result";
import { clockNow } from "../lib/clock";
import { planCardState, type PlanCardState } from "../queries/plan-board";

/** studio-reel's checkout. A verify lane (ORCA_E2E_USER_DATA_DIR) must name its temp copy in
 *  LEAD_STUDIO_COOK_ROOT and never falls back to the real one. */
export function cookRoot(): string | null {
  if (process.env.LEAD_STUDIO_COOK_ROOT) return process.env.LEAD_STUDIO_COOK_ROOT;
  return process.env.ORCA_E2E_USER_DATA_DIR ? null : path.join(os.homedir(), "Desktop/kaiships/studio-reel");
}

/** The title in ASCII with dashes, plus the end of the id, so two reels never share a script file. */
export const reelSlug = (title: string, id: string): string =>
  `${title} ${id.slice(-6)}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-60)
    .replace(/^-+/, "");

const COOKABLE: PlanCardState[] = ["draft", "plan", "missed"];
const GONE = { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" } as const;
const ALREADY = { ok: false, error: "This reel is already cooking.", code: "COOK_ALREADY" } as const;

/** Writes the reel's script where studio-reel's /make-reel reads it, in its workspace/README.md format. */
export async function cookPlanCardAction(id: string): Promise<ActionResult<{ root: string; scriptPath: string; title: string }>> {
  const [row] = await db
    .select({ plan: tables.plannedPosts, script: tables.scripts.content })
    .from(tables.plannedPosts)
    .leftJoin(tables.scripts, eq(tables.scripts.id, tables.plannedPosts.scriptId))
    .where(eq(tables.plannedPosts.id, id))
    .limit(1);
  if (!row) return GONE;
  const { plan } = row;
  if (plan.cookWorkspaceId) return ALREADY;
  if (!COOKABLE.includes(planCardState(plan, clockNow().toLocaleDateString("sv-SE")))) return { ok: false, error: "Only a draft or planned reel can be cooked.", code: "COOK_LOCKED" };
  if (!row.script?.trim()) return { ok: false, error: "This reel has no script to cook.", code: "COOK_NO_SCRIPT" };
  const root = cookRoot();
  if (!root || !existsSync(root)) return { ok: false, error: root ? `studio-reel is not at ${root}.` : "This verify lane names no studio-reel copy (LEAD_STUDIO_COOK_ROOT).", code: "COOK_NO_STUDIO" };
  const slug = reelSlug(plan.title, id);
  const scriptPath = `workspace/scripts/${slug}.md`;
  const front = [`slug: ${slug}`, plan.targetLengthSec ? `target_seconds: ${plan.targetLengthSec}` : null, plan.keyword ? `cta_keyword: ${plan.keyword}` : null, "status: draft"].filter(Boolean);
  await mkdir(path.join(root, "workspace/scripts"), { recursive: true });
  await writeFile(path.join(root, scriptPath), `---\n${front.join("\n")}\n---\n# ${plan.title}\n\n## Script\n${row.script.trim()}\n`);
  return { ok: true, root, scriptPath, title: plan.title };
}

/** Marks the reel Cooking once its workspace exists; a reel already cooking is refused. */
export async function markPlanCookingAction(id: string, workspaceId: string): Promise<SimpleResult> {
  const updated = await db
    .update(tables.plannedPosts)
    .set({ cookWorkspaceId: workspaceId, updatedAt: nowIso() })
    .where(and(eq(tables.plannedPosts.id, id), isNull(tables.plannedPosts.cookWorkspaceId)))
    .returning({ id: tables.plannedPosts.id });
  if (updated.length) return { ok: true };
  const [exists] = await db.select({ id: tables.plannedPosts.id }).from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  return exists ? ALREADY : GONE;
}

/** Rolls Cooking back when Claude did not start in that workspace, so Cook can be retried. */
export async function clearPlanCookingAction(id: string, workspaceId: string): Promise<SimpleResult> {
  await db
    .update(tables.plannedPosts)
    .set({ cookWorkspaceId: null, updatedAt: nowIso() })
    .where(and(eq(tables.plannedPosts.id, id), eq(tables.plannedPosts.cookWorkspaceId, workspaceId)));
  return { ok: true };
}
