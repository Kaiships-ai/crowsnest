import { z } from "zod";
import { db, tables } from "../db";
import { config } from "../config";
import type { WindowSpec } from "../services/outlier-calc";

/**
 * The single place the rest of the app reads configuration from.
 *
 * PRECEDENCE, in order, per key:
 *
 *   1. A row in `app_settings` (the database). This is what a person changed on the
 *      Settings page. If the stored value fails validation (hand-edited, or written by
 *      an older version of this module with a different shape), it is treated as
 *      ABSENT — logged and skipped, never thrown, and never allowed to crash a read.
 *   2. An environment variable, ONLY for the handful of keys that predate app_settings
 *      and already have a validated env var in `src/server/config.ts`. See
 *      `ENV_BACKED_KEYS` below for the exact list. A key with no env var skips straight
 *      to step 3.
 *   3. A built-in default, hardcoded in this file.
 *
 * Database beats environment beats built-in default. Once a setting has a database row,
 * its env var (if it has one) is dead — exactly like `MEDIA_RETENTION_DAYS` and
 * `SYNC_INTERVAL_MINUTES` are validated at boot and then ignored today, except now there
 * is a way to actually change the value without a restart.
 *
 * This module never caches. Every call re-reads `app_settings`. That matches how the
 * rest of this codebase already works — no query layer here caches, pages that need
 * live state set `dynamic = "force-dynamic"` — and it is one table read, which is cheap
 * on a local single-user SQLite database.
 */

// ---------------------------------------------------------------------------
// The setting keys
// ---------------------------------------------------------------------------

export type ScoreBaselineMethod = "median" | "mean" | "trimmedMean";
export type ScoreBaselineWindow = "last12Posts" | "last30Days" | "allHistory";
export type FeedFollowerBand = "nano" | "micro" | "mid" | "macro" | "all";

export interface AppSettings {
  /** Which statistic defines "normal" for a channel. Consumed by the scoring engine. */
  scoreBaselineMethod: ScoreBaselineMethod;
  /** How far back the baseline looks. Consumed by the scoring engine. */
  scoreBaselineWindow: ScoreBaselineWindow;
  /** Fewer usable posts than this and a channel gets no score at all. Consumed by the
   *  scoring engine. */
  scoreMinUsablePosts: number;
  /** Posts below this many views are excluded from the baseline calculation entirely.
   *  0 means no floor. Consumed by the scoring engine. */
  scoreMinViewsFloor: number;
  /** The feed's default minimum score filter on first open. NOT YET CONSUMED — the feed
   *  screen (Wave 2) has to read this; today the feed has no server-side default. */
  feedDefaultMinScore: number;
  /** The feed's default follower-band filter on first open. NOT YET CONSUMED, same
   *  reason as feedDefaultMinScore. */
  feedDefaultFollowerBand: FeedFollowerBand;
  /** How many days back a sync looks by default when the caller doesn't specify one.
   *  Consumed by `runSync` (falls back to this exactly where it used to fall back to
   *  `config.LOOKBACK_DAYS`). */
  syncLookbackDays: number;
  /** Hard per-run safety cap on items fetched, across the whole sync. Consumed by
   *  `runSync` (falls back to this exactly where it used to fall back to
   *  `config.MAX_ITEMS_PER_SYNC`) and by the progress reporters in
   *  `src/server/actions/sync-actions.ts`. */
  maxItemsPerSync: number;
  /** How many channels a sync run pipelines at once. The sidecar serializes every
   *  Instagram call through one process-global lock, so this only overlaps a channel's
   *  local work (thumbnail download, DB writes, scoring) with the next channel's fetch,
   *  never concurrent IG traffic. NOT YET CONSUMED - `runSync` reads it in Goal 3 T3;
   *  stored and DB-overridable now like its `maxItemsPerSync` sibling. */
  syncConcurrency: number;
  /** Hours since a channel's last full walk within which an incremental sync may stop early
   *  at already-known posts. Past it, the next sync walks the whole window so no in-window
   *  post's metrics go stale. */
  syncMetricsFreshnessHours: number;
  /** How many of a channel's newest reels each sync asks Instagram about individually, to
   *  recover the play count the listing endpoint withholds. 0 turns the pass off.
   *  Consumed by `runSync` (falls back to this exactly where it used to read
   *  `config.VIEW_COUNT_ENRICH_PER_CHANNEL` directly) and by the view-count backfill. */
  viewCountEnrichPerChannel: number;
  /** Minutes between automatic syncs. NOT CONSUMED — there is no scheduler in this app;
   *  every sync starts from a click. Kept here, DB-overridable, for the day a scheduler
   *  exists, same honesty the Settings page's Sync section already applies to
   *  `SYNC_INTERVAL_MINUTES`: the value is real and stored, but nothing acts on it. */
  syncCadenceMinutes: number;
  /** Days of media to retain. NOT CONSUMED — there is no reaper; `MEDIA_RETENTION_DAYS`
   *  is validated at boot today and nothing reads it afterwards. Same treatment. */
  mediaRetentionDays: number;
  /** Wall clock minutes a library sync is allowed before it counts as over its SLA budget.
   *  Read by the finish path in sync-engine.ts to decide whether to raise an sla_breach
   *  notification. Never auto cancels. */
  syncSlaMinutes: number;
  /** Same budget for a remix stage run. Stored and validated; wired once remix runs raise
   *  their own notifications. */
  remixSlaMinutes: number;
  /** When true, a successful run raises a run_finished notification. Off by default:
   *  failures and SLA breaches always notify, success is opt in. */
  notifyOnSuccess: boolean;
  /** True once the first-run flow (`/first-run`) has been completed — set by the "Open
   *  Crowsnest" button at the end of the first sync screen. Read by the `(shell)` route
   *  guard: a fresh install (this false AND zero `channels` rows) redirects into
   *  `/first-run` instead of showing the shell. Settings carries a control that clears
   *  this back to false so the flow can be replayed; see docs/product/v1-scope.md §2
   *  "First run" AC 1 and AC 14. */
  firstRunCompleted: boolean;
  /** When true, the app is allowed to auto-start and auto-restart the local 9router
   *  LLM proxy when its status is read and it isn't reachable. Off by default to stay
   *  safe: with this off, the app only observes 9router's status and never spawns it.
   *  Consumed by `getRouterStatusAction` (router-actions.ts), guarded by a cooldown so
   *  a dead router can never trigger a restart loop. */
  routerAutoManage: boolean;
}

/** Rows in `app_settings` are `key`/`value`, both TEXT. This is the `key` for each
 *  field above — deliberately snake_case to match every other key already in the
 *  table (`niche_profile`, `niche_keywords`, `recently_viewed`, `first_run_completed`). */
const DB_KEY: { [K in keyof AppSettings]: string } = {
  scoreBaselineMethod: "score_baseline_method",
  scoreBaselineWindow: "score_baseline_window",
  scoreMinUsablePosts: "score_min_usable_posts",
  scoreMinViewsFloor: "score_min_views_floor",
  feedDefaultMinScore: "feed_default_min_score",
  feedDefaultFollowerBand: "feed_default_follower_band",
  syncLookbackDays: "sync_lookback_days",
  maxItemsPerSync: "max_items_per_sync",
  syncConcurrency: "sync_concurrency",
  syncMetricsFreshnessHours: "sync_metrics_freshness_hours",
  viewCountEnrichPerChannel: "view_count_enrich_per_channel",
  syncCadenceMinutes: "sync_cadence_minutes",
  mediaRetentionDays: "media_retention_days",
  syncSlaMinutes: "sync_sla_minutes",
  remixSlaMinutes: "remix_sla_minutes",
  notifyOnSuccess: "notify_on_success",
  firstRunCompleted: "first_run_completed",
  routerAutoManage: "router_auto_manage",
};

/** Every setting key's DB key, exported for tests and for the write action, which needs
 *  to reject an unrecognized key by name. */
export const APP_SETTING_KEYS = Object.keys(DB_KEY) as (keyof AppSettings)[];

// z.coerce.number() accepts both a DB string ("12") and an already-typed number (12),
// so the same schema validates a read (string in) and a write (typed value in).
const posInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

// Same read/write duality as posInt above, but for a boolean. z.coerce.boolean() is NOT
// used here on purpose — it coerces on JS truthiness, so the stored string "false" would
// coerce to true (a non-empty string), which is exactly backwards. This accepts the two
// literal strings a `String(boolean)` write can ever produce, plus an already-typed
// boolean for the write path itself, and rejects everything else.
const boolLike = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");

/** One zod schema per key. Used for both reading (validating a stored string) and
 *  writing (validating the caller's typed input) — see the module doc above. */
const SCHEMA: { [K in keyof AppSettings]: z.ZodType<AppSettings[K]> } = {
  scoreBaselineMethod: z.enum(["median", "mean", "trimmedMean"]),
  scoreBaselineWindow: z.enum(["last12Posts", "last30Days", "allHistory"]),
  scoreMinUsablePosts: posInt(1, 1000),
  scoreMinViewsFloor: posInt(0, 1_000_000_000),
  feedDefaultMinScore: z.coerce.number().min(0).max(1000),
  feedDefaultFollowerBand: z.enum(["nano", "micro", "mid", "macro", "all"]),
  syncLookbackDays: posInt(1, 3650),
  maxItemsPerSync: posInt(1, 10_000), // same bounds as config.ts's MAX_ITEMS_PER_SYNC schema
  syncConcurrency: posInt(1, 16), // same bounds as config.ts's SYNC_CONCURRENCY schema
  syncMetricsFreshnessHours: posInt(1, 168), // same bounds as config.ts's SYNC_METRICS_FRESHNESS_HOURS
  // 0 is a real value here (it turns the pass off), and 200 is the same ban-risk ceiling
  // config.ts's VIEW_COUNT_ENRICH_PER_CHANNEL schema enforces.
  viewCountEnrichPerChannel: posInt(0, 200),
  syncCadenceMinutes: posInt(0, 10_080),
  mediaRetentionDays: posInt(1, 3650),
  syncSlaMinutes: posInt(1, 240),
  remixSlaMinutes: posInt(1, 240),
  notifyOnSuccess: boolLike,
  firstRunCompleted: boolLike,
  routerAutoManage: boolLike,
};

/** Built-in defaults, used only when there is no DB row AND (for the three keys below)
 *  no env var either.
 *
 *  scoreBaselineWindow defaults to "last12Posts", not the historical hardcoded 20-post
 *  window. 12 is not a preserving choice — it is the closest of the three product-spec
 *  options (last 12 posts / last 30 days / all history) to the old behaviour, and
 *  scores will shift slightly on first deploy of this module as a result. That is a
 *  real, visible behaviour change and is called out here rather than silently reproduced. */
const DEFAULT: AppSettings = {
  scoreBaselineMethod: "median",
  scoreBaselineWindow: "last12Posts",
  scoreMinUsablePosts: 5, // matches the historical MIN_USABLE constant exactly — no change
  scoreMinViewsFloor: 0, // no floor — no change from today, which has never had one
  feedDefaultMinScore: 0, // no filter — no change from today, which has no server-side default
  feedDefaultFollowerBand: "all", // no filter — same reasoning
  syncLookbackDays: 30,
  maxItemsPerSync: 200, // matches config.ts's MAX_ITEMS_PER_SYNC default exactly, no change
  syncConcurrency: 2, // matches config.ts's SYNC_CONCURRENCY default exactly
  syncMetricsFreshnessHours: 12, // matches config.ts's SYNC_METRICS_FRESHNESS_HOURS default
  viewCountEnrichPerChannel: 0, // opt-in: off until set, so no sync scrapes without being asked. UI recommends 12 once on.
  syncCadenceMinutes: 0,
  mediaRetentionDays: 90,
  syncSlaMinutes: 10, // spec default: a library sync over 10 min flags as over budget
  remixSlaMinutes: 3,
  notifyOnSuccess: false, // success is opt in; failures and breaches always notify
  firstRunCompleted: false, // no row yet == first run has not happened
  routerAutoManage: false, // safe by default: observe 9router, never spawn it, until opted in
};

/** The only keys that predate `app_settings` and have a validated fallback in
 *  `config.ts`. Every other key has no env layer: DB row, or built-in default, that's
 *  the whole chain. */
const ENV_FALLBACK: Partial<{ [K in keyof AppSettings]: () => AppSettings[K] }> = {
  syncLookbackDays: () => config.LOOKBACK_DAYS,
  maxItemsPerSync: () => config.MAX_ITEMS_PER_SYNC,
  syncConcurrency: () => config.SYNC_CONCURRENCY,
  syncMetricsFreshnessHours: () => config.SYNC_METRICS_FRESHNESS_HOURS,
  viewCountEnrichPerChannel: () => config.VIEW_COUNT_ENRICH_PER_CHANNEL,
  syncCadenceMinutes: () => config.SYNC_INTERVAL_MINUTES,
  mediaRetentionDays: () => config.MEDIA_RETENTION_DAYS,
};

/** True once a real code path reads this key and behaves differently because of it.
 *  Exposed so a Settings UI can say "not wired yet" honestly instead of implying every
 *  visible control does something, which the brief calls a bug, not a missing feature. */
const WIRED: { [K in keyof AppSettings]: boolean } = {
  scoreBaselineMethod: true,
  scoreBaselineWindow: true,
  scoreMinUsablePosts: true,
  scoreMinViewsFloor: true,
  feedDefaultMinScore: false,
  feedDefaultFollowerBand: false,
  syncLookbackDays: true,
  maxItemsPerSync: true,
  syncConcurrency: false, // stored and DB-overridable now; runSync reads it in Goal 3 T3
  syncMetricsFreshnessHours: false, // stored and DB-overridable; syncOneChannel reads it (Round 1)
  viewCountEnrichPerChannel: true, // runSync reads it per channel, and the backfill reads it too
  syncCadenceMinutes: false,
  mediaRetentionDays: false,
  syncSlaMinutes: true, // sync-engine raises an sla_breach on an over-budget finish, and the run screens flag it live
  remixSlaMinutes: false, // stored now, wired once remix runs raise their own notifications
  notifyOnSuccess: true, // sync-engine gates the run_finished notification on this
  firstRunCompleted: true, // read by the (shell) route guard — see src/server/queries/first-run-gate.ts
  routerAutoManage: true, // getRouterStatusAction gates its auto-restart attempt on this
};

export type SettingSource = "db" | "env" | "default";

export interface SettingWithSource<T> {
  value: T;
  source: SettingSource;
  /** False means the value is stored and can be changed, but no code path reads it yet. */
  wired: boolean;
}

export type AppSettingsView = { [K in keyof AppSettings]: SettingWithSource<AppSettings[K]> };

async function readRows(): Promise<Map<string, string>> {
  const wanted = Object.values(DB_KEY);
  const rows = await db.select().from(tables.appSettings);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (wanted.includes(row.key)) map.set(row.key, row.value);
  }
  return map;
}

function resolve<K extends keyof AppSettings>(key: K, raw: string | undefined): SettingWithSource<AppSettings[K]> {
  if (raw !== undefined) {
    const parsed = SCHEMA[key].safeParse(raw);
    if (parsed.success) return { value: parsed.data, source: "db", wired: WIRED[key] };
    // Corrupt or hand-edited row. Never thrown — this module is read constantly and a
    // bad row must degrade to "as if absent", not take the app down.
    console.warn(`[settings] app_settings.${DB_KEY[key]} = ${JSON.stringify(raw)} failed validation, falling back:`, parsed.error.issues[0]?.message);
  }
  const envFallback = ENV_FALLBACK[key];
  if (envFallback) return { value: envFallback(), source: "env", wired: WIRED[key] };
  return { value: DEFAULT[key], source: "default", wired: WIRED[key] };
}

/** The typed, resolved settings the rest of the app reads. Never throws — a database
 *  read failure here would be a database problem everything else already has, and this
 *  function does not swallow that; it lets it propagate like every other query in
 *  `src/server/queries` does. */
/** Pure — no I/O. Takes already-fetched `app_settings` rows (in whatever shape a
 *  caller obtained them, sync or async) and applies the precedence rules. Split out
 *  from `getSettings` so a caller that needs the resolved settings from INSIDE a
 *  synchronous `db.transaction` callback (see `recomputeAllChannelScoresSync` and
 *  `updateAppSettingsAction`, which reads its own just-written rows this way to keep a
 *  settings write and the resulting score recompute in one atomic transaction) can call
 *  this directly instead of going through the async `getSettings`, which a
 *  better-sqlite3 transaction callback cannot `await` into. */
export function resolveAllSettings(rows: { key: string; value: string }[]): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as AppSettings;
  for (const key of APP_SETTING_KEYS) {
    out[key] = resolve(key, map.get(DB_KEY[key])).value as never;
  }
  return out;
}

export async function getSettings(): Promise<AppSettings> {
  return resolveAllSettings(await db.select().from(tables.appSettings));
}

/** Same as `getSettings`, plus where each value came from and whether anything reads
 *  it yet. This is what the future Settings page (Wave 4) is built against — it is the
 *  data behind the read-only marker the acceptance criteria ask for. */
export async function getSettingsWithSource(): Promise<AppSettingsView> {
  const rows = await readRows();
  const out = {} as AppSettingsView;
  for (const key of APP_SETTING_KEYS) {
    out[key] = resolve(key, rows.get(DB_KEY[key])) as never;
  }
  return out;
}

/** Convenience single-key read, built on `getSettings`. No separate code path, so it
 *  cannot drift from the bulk read's precedence rules. */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  return (await getSettings())[key];
}

/** Validates a caller-supplied value against the same schema a stored row is validated
 *  against, and returns the DB key plus the string to store. Exported so the write
 *  action (`src/server/actions/settings-actions.ts`) can validate-then-write without
 *  duplicating the schema table. Returns `null` for an unknown key. */
export function validateSetting<K extends keyof AppSettings>(
  key: K,
  value: unknown
): { ok: true; dbKey: string; dbValue: string } | { ok: false; error: string } {
  const schema = SCHEMA[key];
  if (!schema) return { ok: false, error: `Unknown setting: ${String(key)}` };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: `${String(key)}: ${parsed.error.issues[0]?.message ?? "invalid value"}` };
  return { ok: true, dbKey: DB_KEY[key], dbValue: String(parsed.data) };
}

/** Translates the product-facing `scoreBaselineWindow` enum into the generic
 *  `WindowSpec` the pure scoring functions in `outlier-calc.ts` understand. Kept here,
 *  not in outlier-calc.ts, so the calculator stays free of any knowledge of
 *  app_settings' naming. */
export function windowSpecFor(window: ScoreBaselineWindow): WindowSpec {
  if (window === "last12Posts") return { kind: "posts", count: 12 };
  if (window === "last30Days") return { kind: "days", count: 30 };
  return { kind: "all" };
}

/** The `BaselineOptions` the scoring engine should call `computeChannelBaseline` /
 *  `scoreVideosAgainstBaseline` with. */
export interface ScoringOptions {
  method: ScoreBaselineMethod;
  window: WindowSpec;
  minUsable: number;
  minViewsFloor: number;
}

/** Pure — no I/O. The sync-side twin of `getScoringOptions`, for the same reason
 *  `resolveAllSettings` exists: a caller inside a synchronous `db.transaction`
 *  callback has already resolved `AppSettings` via `resolveAllSettings` and just needs
 *  this shape out of it, with no further database access. */
export function scoringOptionsFromSettings(s: AppSettings): ScoringOptions {
  return {
    method: s.scoreBaselineMethod,
    window: windowSpecFor(s.scoreBaselineWindow),
    minUsable: s.scoreMinUsablePosts,
    minViewsFloor: s.scoreMinViewsFloor,
  };
}

/** The scoring options derived from the current settings. One place, so every caller
 *  (sync-engine.ts, channels.ts, ...) builds the same options the same way and cannot
 *  drift into passing a different window shape than another caller. */
export async function getScoringOptions(): Promise<ScoringOptions> {
  return scoringOptionsFromSettings(await getSettings());
}
