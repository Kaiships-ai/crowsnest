import { z } from "zod";

/**
 * The single place this app reads `process.env`. Everything else imports `config`.
 *
 * Validation runs once at module load and THROWS on a missing or malformed required
 * var, so a misconfigured process refuses to start instead of failing later on a user's
 * click with a confusing message. That is a deliberate requirement of the sync rebuild:
 * an empty `IG_SERVICE_TOKEN` used to be indistinguishable from a working one until the
 * first 401 came back from the sidecar.
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
  /** Shared secret for the localhost-only Node -> Python hop. Required: an unauthenticated
   *  sidecar would let any local process drive a logged-in Instagram session. */
  IG_SERVICE_TOKEN: z.string().min(1, "IG_SERVICE_TOKEN is required (shared secret for the Instagram sidecar)"),
  IG_REQUEST_TIMEOUT_MS: intWithDefault(30_000, 1_000, 600_000),
  IG_DOWNLOAD_TIMEOUT_MS: intWithDefault(120_000, 1_000, 1_800_000),

  // --- sync window ---
  LOOKBACK_DAYS: intWithDefault(30, 1, 3650),
  MAX_ITEMS_PER_SYNC: intWithDefault(200, 1, 10_000),
  SYNC_INTERVAL_MINUTES: intWithDefault(0, 0, 10_080),

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

  // --- existing ---
  CROWSNEST_DB_PATH: z.string().min(1).default("data/crowsnest.db"),
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
