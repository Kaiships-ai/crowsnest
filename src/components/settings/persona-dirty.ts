import type { Persona } from "@/server/services/persona";

const KEYS: (keyof Persona)[] = ["audience", "voice", "do", "dont"];

/** True when any persona field differs between the last-saved snapshot and the
 *  current edits — drives the unsaved-changes guard in persona-section.tsx. Kept in
 *  a plain (non-"use client") module so it is unit-testable without rendering. */
export function personaIsDirty(saved: Persona, current: Persona): boolean {
  return KEYS.some((k) => saved[k] !== current[k]);
}
