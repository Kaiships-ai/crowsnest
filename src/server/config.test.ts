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
 * suite, zero failing assertions, and a misleading red run. IG_SERVICE_TOKEN is optional
 * now (the secrets store guarantees one via `getOrCreateServiceToken()`), so this dynamic
 * import is no longer load-bearing for that variable specifically, but the pattern stays
 * for the other required vars in this schema, which still throw on load.
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
  test("a missing IG_SERVICE_TOKEN does not throw", () => {
    const env = { ...process.env };
    delete env.IG_SERVICE_TOKEN;
    expect(() => loadConfig(env)).not.toThrow();
  });

  test("boots with an empty IG_SERVICE_TOKEN too", () => {
    expect(() => loadConfig({ IG_SERVICE_TOKEN: "" } as unknown as NodeJS.ProcessEnv)).not.toThrow();
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

  /**
   * The Instagram Graph API vars (own-channel insights, V1 data contracts §1) are the
   * one place this file must NEVER throw on absence. Making them required would stop
   * every existing dev machine — including Kai's — from booting over a feature that is
   * allowed to be unconfigured.
   */
  describe("Graph API vars (own-channel insights)", () => {
    test("boots with none of the three set, same as any other machine", () => {
      const c = loadConfig(MINIMAL);
      expect(c.IG_GRAPH_TOKEN).toBeUndefined();
      expect(c.IG_GRAPH_USER_ID).toBeUndefined();
    });

    test("applies the documented default API version when unset", () => {
      expect(loadConfig(MINIMAL).IG_GRAPH_API_VERSION).toBe("v21.0");
    });

    test("passes through a configured token, user id and API version", () => {
      const c = loadConfig({ ...MINIMAL, IG_GRAPH_TOKEN: "tok_abc", IG_GRAPH_USER_ID: "17841400000000000", IG_GRAPH_API_VERSION: "v23.0" });
      expect(c.IG_GRAPH_TOKEN).toBe("tok_abc");
      expect(c.IG_GRAPH_USER_ID).toBe("17841400000000000");
      expect(c.IG_GRAPH_API_VERSION).toBe("v23.0");
    });

    test("rejects an explicit empty string API version rather than silently defaulting", () => {
      expect(() => loadConfig({ ...MINIMAL, IG_GRAPH_API_VERSION: "" })).toThrow(/IG_GRAPH_API_VERSION/);
    });
  });
});
