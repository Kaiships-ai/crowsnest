"use server";

import { eq } from "drizzle-orm";
import { errorMessage } from "../lib/action-result";
import { db, tables } from "../db";
import { getPlansCarryingScript } from "../queries/planned-posts";
import {
  buildResearch,
  finishRemix,
  saveScript,
  updateStage,
  type RemixFinishResult,
  type ResearchNotes,
  type StagePatch,
} from "../services/remix";

type SimpleResult = { ok: true } | { ok: false; error: string };
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

export async function updateStageAction(id: string, patch: Partial<StagePatch>): Promise<SimpleResult> {
  try {
    await updateStage(id, patch);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function buildResearchAction(id: string): Promise<ActionResult<{ notes: ResearchNotes }>> {
  try {
    const notes = await buildResearch(id);
    return { ok: true, notes };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveScriptAction(
  id: string,
  content: string,
  title: string,
  variantIndex?: number
): Promise<ActionResult<{ scriptId: string }>> {
  try {
    const result = await saveScript(id, content, title, variantIndex);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The Finish stage's action: create (or reuse) a draft planned post for the session and
 * hand back its id so the view can link to the post detail at `/mine/<postId>`. Idempotent,
 * so the button can be clicked twice without dropping a duplicate on the calendar.
 */
export async function finishRemixAction(id: string): Promise<ActionResult<RemixFinishResult>> {
  try {
    return { ok: true, ...(await finishRemix(id)) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

type DeleteScriptResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code?: "SCRIPT_NOT_FOUND" | "SCRIPT_CARRIED_BY_PLAN" | "SCRIPT_UNKNOWN";
      /** Only set for SCRIPT_CARRIED_BY_PLAN, naming the plans and their dates so the
       *  caller can offer "detach from each plan first, or delete the plans too". */
      plans?: { id: string; title: string; plannedDate: string | null }[];
    };

/**
 * Deletes a script, refusing when a planned post still carries it (V1 data contracts,
 * contract 6). This is the delete-refusal half of the planner's "make the link real"
 * requirement: a plan whose scriptId silently went null via the FK's `set null`
 * default would degrade from "a finished cut, dated" to "a title on a calendar"
 * without telling anyone — the same rot the planned-post link exists to prevent. The
 * FK stays `set null` as a backstop for any path that bypasses this action, but this
 * is where the honesty lives, mirroring contract 3's refusal pattern for system
 * presets.
 */
export async function deleteScriptAction(id: string): Promise<DeleteScriptResult> {
  try {
    const [script] = await db.select({ id: tables.scripts.id }).from(tables.scripts).where(eq(tables.scripts.id, id)).limit(1);
    if (!script) return { ok: false, error: "That script no longer exists.", code: "SCRIPT_NOT_FOUND" };

    const carryingPlans = await getPlansCarryingScript(id);
    if (carryingPlans.length > 0) {
      const noun = carryingPlans.length === 1 ? "planned post" : "planned posts";
      return {
        ok: false,
        error: `This script is carried by ${carryingPlans.length} ${noun}. Detach it from each plan first, or delete the plans too.`,
        code: "SCRIPT_CARRIED_BY_PLAN",
        plans: carryingPlans,
      };
    }

    await db.delete(tables.scripts).where(eq(tables.scripts.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err), code: "SCRIPT_UNKNOWN" };
  }
}
