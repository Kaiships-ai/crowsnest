"use server";

import { upsertPersona, type Persona } from "@/server/services/persona";

// Same shape as the other settings save actions (`channel-actions.ts`'s
// `SimpleResult`, `settings-actions.ts`'s `SimpleResult`): a payload-bearing success so
// the client component can adopt whatever actually got persisted (the merge-onto-current
// behavior in `upsertPersona`, not just an echo of what was sent), plus the standard
// `{ error, code }` failure.
type PersonaResult = { ok: true; persona: Persona } | { ok: false; error: string; code: "PERSONA_SAVE_FAILED" };

/**
 * Persona section's "Save persona" action. Wraps `upsertPersona` (Task 5) in the
 * standard try/catch action-result union rather than letting a db error throw across
 * the server-action boundary uncaught.
 */
export async function savePersonaAction(p: Partial<Persona>): Promise<PersonaResult> {
  try {
    const persona = await upsertPersona(p);
    return { ok: true, persona };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save persona.", code: "PERSONA_SAVE_FAILED" };
  }
}
