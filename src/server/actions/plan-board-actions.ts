"use server";

import { eq } from "drizzle-orm";
import { db, tables } from "../db";
import type { ActionResult } from "../lib/action-result";
import { planCardState, planLockReason } from "../queries/plan-board";
import { movePlannedPostAction, type MoveSnapshot } from "./planned-post-actions";

export async function movePlanCardAction(id: string, date: string): Promise<ActionResult<{ prior: MoveSnapshot }>> {
  const [row] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, id)).limit(1);
  if (!row) return { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" };
  const reason = planLockReason(planCardState(row, new Date().toLocaleDateString("sv-SE")));
  if (reason) return { ok: false, error: reason, code: "PLAN_LOCKED" };
  return movePlannedPostAction(id, { date });
}
