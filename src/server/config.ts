import { z } from "zod";

/**
 * The single place this app reads `process.env`. Everything else imports `config`.
 *
 * Validation runs once at module load and THROWS on a missing or malformed required
 * var, so a misconfigured process refuses to start instead of failing later on a user's
 * click with a confusing message. `IG_SERVICE_TOKEN` used to be one of those required
 * vars — an empty value was indistinguishable from a working one until the first 401
 * came back from the sidecar — but it is optional here now: the secrets store
 * (`src/server/secrets/store.ts`) guarantees a token exists via
 * `getOrCreateServiceToken()`, so the app always boots even with none configured.
 *
 * Note the previous provider layer did the opposite — `getProviderChain()` silently
 * dropped any provider whose env key was absent, so a typo'd key produced "no provider
 * configured" at sync time rather than at boot. That failure mode is gone.
 */

const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true" || v === "1"));

const intWithDefault = (fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  // --- Instagram sidecar ---
  IG_SERVICE_URL: z.string().url().default("http://127.0.0.1:8765"),
  /** Shared secret for the localhost-only Node -> Python hop. Optional here: the secrets
   *  store (`src/server/secrets/store.ts`) guarantees one exists via
   *  `getOrCreateServiceToken()`, generating and persisting it on first use instead of
   *  the process refusing to start when it is unset. */
  IG_SERVICE_TOKEN: z.string().optional(),
  IG_REQUEST_TIMEOUT_MS: intWithDefault(30_000, 1_000, 600_000),
  IG_DOWNLOAD_TIMEOUT_MS: intWithDefault(120_000, 1_000, 1_800_000),

  // --- sync window ---
  LOOKBACK_DAYS: intWithDefault(30, 1, 3650),
  MAX_ITEMS_PER_SYNC: intWithDefault(200, 1, 10_000),
  SYNC_INTERVAL_MINUTES: intWithDefault(0, 0, 10_080),
  /** How many channels a sync run pipelines at once. The env layer under the
   *  `syncConcurrency` setting, not the last word: a stored `app_settings` row beats it.
   *  Read the setting, never this, from application code. Default 1: the sidecar's one
   *  Instagram session sits behind a process-global lock with a 1-3s delay between calls,
   *  so overlapping channels barely helps (measured 1.02x) while doubling native
   *  transcription memory. Ceiling 16 matches the other concurrency knobs here. */
  SYNC_CONCURRENCY: intWithDefault(1, 1, 16),
  // Hours since a channel's last FULL walk within which an incremental sync may stop early
  // once it reaches already-known posts. Past this the next sync walks the whole window and
  // refreshes every in-window post's snapshot, so metrics never freeze (Goal 3 Round 1).
  SYNC_METRICS_FRESHNESS_HOURS: intWithDefault(12, 1, 168),

  // --- sync retry ---
  /** Extra attempts per retryable upstream call. `IgError.retryable` existed from the
   *  start but nothing acted on it, so a single network blip killed a whole channel and
   *  the user waited out the rest of the run for nothing. 0 restores that old behaviour. */
  SYNC_MAX_RETRIES: intWithDefault(3, 0, 10),
  /** First backoff step; doubles per attempt and is jittered. Overridden entirely when
   *  Instagram tells us how long to wait (IG_RATE_LIMITED's detail.retry_after_sec). */
  SYNC_RETRY_BASE_MS: intWithDefault(1_000, 100, 60_000),

  // --- media storage ---
  MEDIA_ROOT: z.string().min(1).default("data/media"),
  EAGER_VIDEO_DOWNLOAD: boolish(false),
  MEDIA_RETENTION_DAYS: intWithDefault(90, 1, 3650),
  /** How many of a channel's newest reels each sync asks Instagram about individually,
   *  to get the play count the listing endpoint withholds. 0 disables the pass.
   *
   *  This is the ENV layer under the `viewCountEnrichPerChannel` setting, not the last
   *  word: a stored `app_settings` row beats it, and the Settings page writes that row.
   *  Read the setting, never this, from application code.
   *
   *  Costly, so the ceiling stays at 200: one extra live request per reel per sync from a
   *  burner account, and instagrapi retries public requests up to three times internally,
   *  so the real HTTP count runs above the reel count. See
   *  docs/product/reel-view-count-spike.md.
   *
   *  The default is the scoring baseline window (`scoreBaselineWindow`, last 12 posts).
   *  It was 0 until M5, which meant the pass never ran unless someone edited .env and
   *  restarted, and 334 rows in the dev database still have no count. Below this figure
   *  the sample is smaller than the baseline scores against: under `scoreMinUsablePosts`
   *  (5) no outlier score appears at all, and under 12 the baseline quietly narrows, so a
   *  lower value fixes the number the feed prints without producing a score to go with it. */
  VIEW_COUNT_ENRICH_PER_CHANNEL: intWithDefault(0, 0, 200),

  // --- existing ---
  CROWSNEST_DB_PATH: z.string().min(1).default("data/crowsnest.db"),

  // --- Instagram Graph API (own-channel insights, contract 1) ---
  // Deliberately optional. This is a SEPARATE credential from IG_SERVICE_TOKEN above:
  // that one is the shared secret for the instagrapi burner sidecar, this one is a
  // long-lived Graph API token for Kai's own account. A machine with neither configured
  // still boots — every own-channel query degrades to a designed "not connected" state
  // instead of the process refusing to start. Making this required would stop every
  // existing dev machine from booting over a feature that is allowed to be unconfigured.
  IG_GRAPH_TOKEN: z.string().optional(),
  IG_GRAPH_USER_ID: z.string().optional(),
  IG_GRAPH_API_VERSION: z.string().min(1).optional().default("v21.0"),
  IG_GRAPH_HOST: z.url().optional().default("https://graph.instagram.com"),
  LEAD_STUDIO_CLOCK_START: z.iso.datetime({ offset: true, local: true }).optional(),
});

export type Config = z.infer<typeof schema>;

function load(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee docs/design/instagram-sync-brief.md §8 for the env schema.`);
  }
  return parsed.data;
}

/** Exported for tests — lets a spec assert the refuse-to-start behaviour without
 *  mutating the real process env. */
export const loadConfig = load;

export const config: Config = load(process.env);
