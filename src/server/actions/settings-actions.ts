"use server";

import { eq, inArray } from "drizzle-orm";
import { db, tables } from "../db";
import { getSettingsWithSource, resolveAllSettings, scoringOptionsFromSettings, validateSetting, type AppSettings, type AppSettingsView } from "../settings";
import { recomputeAllChannelScoresSync } from "../services/sync-engine";

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

/** The transaction handle `db.transaction`'s callback receives. Same type as
 *  sync-engine.ts's private `Tx` — not shared across modules because it's derived
 *  structurally from `db.transaction`'s own signature, not a type either module owns. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Synchronous twin of `upsertSetting`, for use inside a `db.transaction` callback
 *  (better-sqlite3 requires that callback to be synchronous — see `updateAppSettingsAction`). */
function upsertSettingSync(tx: Tx, key: string, value: string): void {
  const existing = tx.select().from(tables.appSettings).where(eq(tables.appSettings.key, key)).limit(1).all();
  if (existing[0]) {
    tx.update(tables.appSettings).set({ value }).where(eq(tables.appSettings.key, key)).run();
  } else {
    tx.insert(tables.appSettings).values({ key, value }).run();
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
 * The Settings page's read path for every P0 `app_settings` key (Wave 1 item 1 in
 * `docs/product/v1-scope.md`'s build order). Thin wrapper over
 * `src/server/settings`'s `getSettingsWithSource` — this file stays the single "use
 * server" boundary the rest of the app calls through, while `src/server/settings` stays
 * a plain module so services (the scoring engine, the sync engine) can read it directly
 * without going through the server-action RPC layer.
 *
 * Not wrapped in `{ok, error}`: like `getNicheSettings` above, this is a straight read
 * with no meaningful failure mode short of the database itself being broken, and a
 * broken database is not a state this action can render around — it propagates, same as
 * every query in `src/server/queries`.
 */
export async function getAppSettingsAction(): Promise<AppSettingsView> {
  return getSettingsWithSource();
}

/**
 * The four keys that change what a score MEANS, not just how it's filtered or
 * displayed. Deliberately a short, explicit list rather than "everything prefixed
 * score" as a string check — a key gets added here by a person reading this comment,
 * not by a naming convention someone could violate by accident.
 */
const SCORE_MEANING_KEYS: (keyof AppSettings)[] = [
  "scoreBaselineMethod",
  "scoreBaselineWindow",
  "scoreMinUsablePosts",
  "scoreMinViewsFloor",
];

/**
 * The Settings page's write path for every P0 `app_settings` key. One generic action
 * instead of one setter per key: every writable row in the Settings page (Wave 4) calls
 * this with the single key it owns, and a future group-save calls it with several at
 * once.
 *
 * All-or-nothing: every key in `patch` is validated against `src/server/settings`'s
 * schema for that key before anything is written, so a bad value in one field can never
 * leave a settings save half applied.
 *
 * RECOMPUTE, not invalidate or stamp, for the four keys in `SCORE_MEANING_KEYS`: a score
 * on screen must always mean what the current settings say it means, full stop, so
 * saving a scoring setting recomputes `videos.outlier_score` for every channel under
 * the new settings before this action returns. There is never a window where a stale
 * score is displayed as current.
 *
 * Invalidating (nulling every score until the next sync) was rejected: a null score
 * already means "not enough usable posts" everywhere else in this app, so a null caused
 * by a settings change would be indistinguishable from a null caused by a thin channel —
 * exactly the kind of ambiguity this product's "no fabricated numbers" rule exists to
 * prevent.
 *
 * Stamping (recording which settings produced each stored score, so the UI could show a
 * score as stale instead of recomputing it away) was also considered and rejected for
 * now: it needs a schema column with no reader yet, since no screen in this wave shows a
 * "stale" marker, and this codebase's own rule is that a setting with no consumer says so
 * rather than getting built speculatively. If a future wave needs per-score provenance —
 * for example, an audit trail distinct from "the current live number" — that is an
 * additive column and a revisit of this decision, not a reason to leave today's numbers
 * silently stale in the meantime.
 *
 * ATOMIC, not best-effort: the settings row writes and the score recompute both happen
 * inside one `db.transaction`. If anything in that transaction throws — a bad row, a
 * mid-loop database error on channel 40 of 80, anything — better-sqlite3 rolls the whole
 * transaction back. Nothing is left half done: not the settings (even the keys that
 * validated fine), not the scores (even the channels already recomputed before the
 * failure). The caller always gets one of two truths: `{ ok: true }` and every affected
 * score already matches the new settings, or `{ ok: false, error }` and NOTHING changed,
 * including rows that appeared to succeed earlier in the same call. A half-recomputed
 * database — some channels under the old settings, some under the new, while the
 * settings page reports the new ones as saved — is exactly the silent-wrongness bug this
 * whole action exists to prevent, so it is not an acceptable failure mode here even as
 * an edge case.
 */
export async function updateAppSettingsAction(patch: Partial<AppSettings>): Promise<SimpleResult> {
  const entries = Object.entries(patch) as [keyof AppSettings, AppSettings[keyof AppSettings]][];
  if (entries.length === 0) return { ok: true };

  const toWrite: { key: string; value: string }[] = [];
  for (const [key, value] of entries) {
    const validated = validateSetting(key, value);
    if (!validated.ok) return { ok: false, error: validated.error };
    toWrite.push({ key: validated.dbKey, value: validated.dbValue });
  }

  const changesScoreMeaning = entries.some(([key]) => SCORE_MEANING_KEYS.includes(key));

  try {
    db.transaction((tx) => {
      for (const { key, value } of toWrite) {
        upsertSettingSync(tx, key, value);
      }
      if (changesScoreMeaning) {
        // Read back what was just written, in the same transaction, rather than the
        // caller's own `patch` — a patch can touch one scoring key while three others
        // stay at whatever they already were, and the recompute has to run against the
        // full resolved set, not just the fields that changed this call.
        const rows = tx.select().from(tables.appSettings).all();
        const scoringOptions = scoringOptionsFromSettings(resolveAllSettings(rows));
        recomputeAllChannelScoresSync(tx, scoringOptions);
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
