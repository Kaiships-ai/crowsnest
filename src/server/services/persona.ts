import { eq } from "drizzle-orm";
import { db, nowIso, tables } from "../db";
import { getNicheProfile } from "./remix";

const PERSONA_ID = "default";

export interface Persona {
  audience: string;
  voice: string;
  do: string;
  dont: string;
}

/**
 * Reads the single persona row. On first read (no row yet), `audience` seeds itself
 * from the niche profile via `getNicheProfile()` — the same lookup the remix service
 * already uses to ground generation (`app_settings.niche_profile`, not one of the
 * typed `getSetting` keys in `../settings`) — so a fresh install starts with a
 * sensible audience instead of a blank field. That seed is never written back; it is
 * recomputed on every read until `upsertPersona` actually persists a row.
 */
export async function getPersona(): Promise<Persona> {
  const [row] = await db.select().from(tables.persona).where(eq(tables.persona.id, PERSONA_ID)).limit(1);
  if (row) return { audience: row.audience, voice: row.voice, do: row.doList, dont: row.dontList };

  const seededAudience = await getNicheProfile();
  return { audience: seededAudience, voice: "", do: "", dont: "" };
}

/** Merges `p` onto the current persona (seeded or stored) and upserts the single row. */
export async function upsertPersona(p: Partial<Persona>): Promise<Persona> {
  const current = await getPersona();
  const next = { ...current, ...p };
  await db
    .insert(tables.persona)
    .values({
      id: PERSONA_ID,
      audience: next.audience,
      voice: next.voice,
      doList: next.do,
      dontList: next.dont,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: tables.persona.id,
      set: { audience: next.audience, voice: next.voice, doList: next.do, dontList: next.dont, updatedAt: nowIso() },
    });
  return next;
}
