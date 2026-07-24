"use server";

import { eq, inArray } from "drizzle-orm";
import { db, tables } from "../db";
import { getLlm, NoApiKeyError, type LlmClient } from "../llm/client";
import { llmErrorMessage } from "../llm/error-message";

type SimpleResult = { ok: true } | { ok: false; error: string };

const NICHE_PROFILE_KEY = "niche_profile";
const NICHE_KEYWORDS_KEY = "niche_keywords";
// Matches services/remix.ts's getNicheProfile() fallback exactly, so the Settings
// page's Textarea placeholder-of-sorts and what generation actually uses never drift.
const DEFAULT_NICHE_PROFILE = "general short-form content";

export interface NicheSettings {
  niche: string;
  keywords: string[];
}

/**
 * Settings page's Niche Profile section (Task 2, phase 4): the same `app_settings.
 * niche_profile` key services/remix.ts's getNicheProfile() reads (kept in lockstep —
 * same key, same fallback), plus the keyword list stored alongside it.
 */
export async function getNicheSettings(): Promise<NicheSettings> {
  const rows = await db
    .select()
    .from(tables.appSettings)
    .where(inArray(tables.appSettings.key, [NICHE_PROFILE_KEY, NICHE_KEYWORDS_KEY]));

  const niche = rows.find((r) => r.key === NICHE_PROFILE_KEY)?.value ?? DEFAULT_NICHE_PROFILE;

  const keywordsRaw = rows.find((r) => r.key === NICHE_KEYWORDS_KEY)?.value;
  let keywords: string[] = [];
  if (keywordsRaw) {
    try {
      const parsed: unknown = JSON.parse(keywordsRaw);
      if (Array.isArray(parsed)) keywords = parsed.filter((k): k is string => typeof k === "string");
    } catch {
      keywords = []; // malformed/legacy data — treat as "no keywords yet" rather than crash
    }
  }

  return { niche, keywords };
}

async function upsertSetting(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, key)).limit(1);
  if (existing) {
    await db.update(tables.appSettings).set({ value }).where(eq(tables.appSettings.key, key));
  } else {
    await db.insert(tables.appSettings).values({ key, value });
  }
}

export async function saveNicheSettingsAction(niche: string, keywords: string[]): Promise<SimpleResult> {
  try {
    await upsertSetting(NICHE_PROFILE_KEY, niche);
    await upsertSetting(NICHE_KEYWORDS_KEY, JSON.stringify(keywords));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * API Keys section's "Test" button for Anthropic (the only one of the four keys with
 * a real client seam to test through) — a $0 `count_tokens` call via LlmClient.ping().
 * Apify/HikerAPI/Groq stay presence-only in this v1 (no client wrapper exists for
 * them yet); their status cards just show whether the env var is set.
 *
 * `llm` is an injectable seam purely for tests (mirrors remix.ts/analyze.ts's own
 * `{ llm? }` pattern) — the real "Test" button always calls this with no argument,
 * which resolves through the real `getLlm()` singleton.
 */
export async function testAnthropicKeyAction(llm?: LlmClient): Promise<SimpleResult> {
  try {
    const client = llm ?? getLlm();
    await client.ping();
    return { ok: true };
  } catch (err) {
    if (err instanceof NoApiKeyError) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
    return { ok: false, error: llmErrorMessage(err) };
  }
}
