"use server";

import type { Outline } from "../llm/schemas";
import { NoApiKeyError } from "../llm/client";
import {
  buildResearch,
  generateHooks,
  generateOutline,
  generateVariants,
  getOrCreateSession,
  quickRemix,
  saveScript,
  updateStage,
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
  return err instanceof Error ? err.message : String(err);
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

export async function generateHooksAction(id: string, vaultItemId?: string): Promise<ActionResult<{ hooks: string[] }>> {
  try {
    const hooks = await generateHooks(id, { vaultItemId });
    return { ok: true, hooks };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function generateOutlineAction(id: string): Promise<ActionResult<{ outline: Outline }>> {
  try {
    const outline = await generateOutline(id);
    return { ok: true, outline };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function generateVariantsAction(
  id: string,
  count?: number
): Promise<ActionResult<{ variants: (string | { error: string })[] }>> {
  try {
    const variants = await generateVariants(id, { count });
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function saveScriptAction(id: string, content: string, title: string): Promise<ActionResult<{ scriptId: string }>> {
  try {
    const result = await saveScript(id, content, title);
    return { ok: true, ...result };
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
