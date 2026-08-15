"use server";

import { eq } from "drizzle-orm";
import type { Outline } from "../llm/schemas";
import { NoApiKeyError } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";
import { db, tables } from "../db";
import { getPlansCarryingScript } from "../queries/planned-posts";
import { getRemixRunLog, type RemixRunRow } from "../queries/remix-runs";
import {
  buildResearch,
  finishRemix,
  generateHooks,
  generateOutline,
  generateVariants,
  getOrCreateSession,
  quickRemix,
  saveScript,
  updateStage,
  type RemixFinishResult,
  type RemixSessionRow,
  type ResearchNotes,
  type StagePatch,
} from "../services/remix";

type SimpleResult = { ok: true } | { ok: false; error: string };
type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Thin "use server" wrappers around remix.ts (Task 5): all real logic — session
 * reuse, research assembly, the three Claude calls, variant isolation — lives in the
 * service, which is already fully covered by its own tests. One action per stage,
 * plus quickRemixAction for the end-to-end shortcut.
 */
function errorMessage(err: unknown): string {
  if (err instanceof NoApiKeyError) return "Add ANTHROPIC_API_KEY in Settings to enable remix generation.";
  return llmErrorMessage(err);
}

export async function getOrCreateSessionAction(videoId: string): Promise<ActionResult<{ session: RemixSessionRow }>> {
  try {
    const session = await getOrCreateSession(videoId);
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

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

export async function generateHooksAction(id: string, vaultItemId?: string, steer?: string): Promise<ActionResult<{ hooks: string[] }>> {
  try {
    const hooks = await generateHooks(id, { vaultItemId, steer });
    return { ok: true, hooks };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function generateOutlineAction(id: string, steer?: string): Promise<ActionResult<{ outline: Outline }>> {
  try {
    const outline = await generateOutline(id, { steer });
    return { ok: true, outline };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function generateVariantsAction(
  id: string,
  count?: number,
  index?: number,
  steer?: string
): Promise<ActionResult<{ variants: (string | { error: string })[] }>> {
  try {
    const variants = await generateVariants(id, { count, index, steer });
    return { ok: true, variants };
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
 * The Finish stage's action: ensure the session has a planned post to cook and hand
 * back its id so the view can link to `/mine/<postId>/studio`. Idempotent, so the
 * button can be clicked twice without dropping a duplicate on the calendar.
 */
export async function finishRemixAction(id: string): Promise<ActionResult<RemixFinishResult>> {
  try {
    return { ok: true, ...(await finishRemix(id)) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function quickRemixAction(id: string): Promise<SimpleResult> {
  try {
    await quickRemix(id);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * The run log a remix session has accumulated so far (v1-scope.md, Remix studio P0).
 * Read only — every row is written by `generateHooks`/`generateOutline`/
 * `generateVariants` themselves, on both success and failure, never by a user action.
 * Restarting a session (`updateStageAction(id, { stage: "prompt" })`) clears the stage,
 * not this history: the run log survives a restart and a page reload by construction,
 * since it lives in its own table rather than a column on the session row.
 */
export async function getRemixRunLogAction(sessionId: string): Promise<ActionResult<{ runs: RemixRunRow[] }>> {
  try {
    const runs = await getRemixRunLog(sessionId);
    return { ok: true, runs };
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
