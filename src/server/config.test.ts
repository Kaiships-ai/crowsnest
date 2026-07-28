import { beforeAll, describe, expect, test } from "vitest";
import type { loadConfig as LoadConfig } from "./config";

/**
 * The point of these specs is the goal's "config validated at boot (refuse to start on
 * missing env)" requirement. A misconfigured process must die at load with a message
 * naming the variable — not limp along and fail later on a user's click.
 *
 * `./config` is imported DYNAMICALLY, after the env var is set. A static top-level import
 * runs `config.ts`'s module-level `load(process.env)` at import time, so on a machine
 * without IG_SERVICE_TOKEN in the environment this whole file failed to LOAD — one broken
 * suite, zero failing assertions, and a misleading red run. The validation is the
 * load-bearing behaviour here (an empty token was indistinguishable from a working one
 * until the sidecar returned its first 401), so the test bends, not the module.
 */

const MINIMAL = { IG_SERVICE_TOKEN: "secret" } as unknown as NodeJS.ProcessEnv;

let loadConfig: typeof LoadConfig;

beforeAll(async () => {
  // Falsy, not `??=`: an empty IG_SERVICE_TOKEN is exactly the case config.ts rejects, so
  // `IG_SERVICE_TOKEN=` in the shell would otherwise break the load all over again.
  if (!process.env.IG_SERVICE_TOKEN) process.env.IG_SERVICE_TOKEN = "test-token";
  ({ loadConfig } = await import("./config"));
});

describe("config", () => {
  test("refuses to load without IG_SERVICE_TOKEN", () => {
    expect(() => loadConfig({} as unknown as NodeJS.ProcessEnv)).toThrow(/IG_SERVICE_TOKEN/);
  });

  test("names the offending variable in the error", () => {
    expect(() => loadConfig({ IG_SERVICE_TOKEN: "" } as unknown as NodeJS.ProcessEnv)).toThrow(/IG_SERVICE_TOKEN/);
  });

  test("applies documented defaults", () => {
    const c = loadConfig(MINIMAL);
    expect(c.LOOKBACK_DAYS).toBe(30);
    expect(c.MAX_ITEMS_PER_SYNC).toBe(200);
    expect(c.MEDIA_ROOT).toBe("data/media");
    expect(c.EAGER_VIDEO_DOWNLOAD).toBe(false);
    expect(c.IG_SERVICE_URL).toBe("http://127.0.0.1:8765");
    expect(c.MEDIA_RETENTION_DAYS).toBe(90);
    expect(c.SYNC_INTERVAL_MINUTES).toBe(0);
    expect(c.SYNC_MAX_RETRIES).toBe(3);
    expect(c.SYNC_RETRY_BASE_MS).toBe(1_000);
  });

  test("allows retries to be disabled, but not set to nonsense", () => {
    expect(loadConfig({ ...MINIMAL, SYNC_MAX_RETRIES: "0" }).SYNC_MAX_RETRIES).toBe(0);
    expect(loadConfig({ ...MINIMAL, SYNC_RETRY_BASE_MS: "250" }).SYNC_RETRY_BASE_MS).toBe(250);
    expect(() => loadConfig({ ...MINIMAL, SYNC_MAX_RETRIES: "11" })).toThrow(/SYNC_MAX_RETRIES/);
    expect(() => loadConfig({ ...MINIMAL, SYNC_RETRY_BASE_MS: "10" })).toThrow(/SYNC_RETRY_BASE_MS/);
  });

  test("parses numeric overrides", () => {
    const c = loadConfig({ ...MINIMAL, LOOKBACK_DAYS: "7", MAX_ITEMS_PER_SYNC: "50" });
    expect(c.LOOKBACK_DAYS).toBe(7);
    expect(c.MAX_ITEMS_PER_SYNC).toBe(50);
  });

  test("rejects a non-numeric LOOKBACK_DAYS rather than silently using NaN", () => {
    expect(() => loadConfig({ ...MINIMAL, LOOKBACK_DAYS: "thirty" })).toThrow(/LOOKBACK_DAYS/);
  });

  test("rejects an out-of-range LOOKBACK_DAYS", () => {
    expect(() => loadConfig({ ...MINIMAL, LOOKBACK_DAYS: "0" })).toThrow(/LOOKBACK_DAYS/);
  });

  test("rejects a malformed service URL", () => {
    expect(() => loadConfig({ ...MINIMAL, IG_SERVICE_URL: "not-a-url" })).toThrow(/IG_SERVICE_URL/);
  });

  test("treats both 'true' and '1' as true for boolean flags", () => {
    expect(loadConfig({ ...MINIMAL, EAGER_VIDEO_DOWNLOAD: "true" }).EAGER_VIDEO_DOWNLOAD).toBe(true);
    expect(loadConfig({ ...MINIMAL, EAGER_VIDEO_DOWNLOAD: "1" }).EAGER_VIDEO_DOWNLOAD).toBe(true);
    expect(loadConfig({ ...MINIMAL, EAGER_VIDEO_DOWNLOAD: "false" }).EAGER_VIDEO_DOWNLOAD).toBe(false);
  });
});
