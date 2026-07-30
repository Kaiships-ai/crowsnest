import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let settings: typeof import("./index");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // config.ts refuses to boot without this — never actually contacted by these tests.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  // Legacy env layer under test: LOOKBACK_DAYS/SYNC_INTERVAL_MINUTES/MEDIA_RETENTION_DAYS
  // are read once at config.ts's module load, so they're set here, before any import.
  process.env.LOOKBACK_DAYS = "45";
  process.env.SYNC_INTERVAL_MINUTES = "120";
  process.env.MEDIA_RETENTION_DAYS = "14";

  ({ db, tables } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  settings = await import("./index");
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.appSettings);
});

async function writeRow(key: string, value: string) {
  await db.insert(tables.appSettings).values({ key, value });
}

describe("getSettings — precedence: default", () => {
  test("every key with no DB row and no env layer returns its built-in default", async () => {
    const s = await settings.getSettings();
    expect(s.scoreBaselineMethod).toBe("median");
    expect(s.scoreBaselineWindow).toBe("last12Posts");
    expect(s.scoreMinUsablePosts).toBe(5);
    expect(s.scoreMinViewsFloor).toBe(0);
    expect(s.feedDefaultMinScore).toBe(0);
    expect(s.feedDefaultFollowerBand).toBe("all");
  });
});

describe("getSettings — precedence: env beats default", () => {
  test("the three legacy keys fall back to their validated env var when no DB row exists", async () => {
    const s = await settings.getSettings();
    expect(s.syncLookbackDays).toBe(45); // process.env.LOOKBACK_DAYS
    expect(s.syncCadenceMinutes).toBe(120); // process.env.SYNC_INTERVAL_MINUTES
    expect(s.mediaRetentionDays).toBe(14); // process.env.MEDIA_RETENTION_DAYS
  });
});

describe("getSettings — precedence: DB beats env", () => {
  test("a stored row wins over the env var for the same key", async () => {
    await writeRow("sync_lookback_days", "7");
    const s = await settings.getSettings();
    expect(s.syncLookbackDays).toBe(7);
  });
});

describe("getSettings — precedence: DB beats default (no env layer)", () => {
  test("a stored row wins for a key that has no env fallback at all", async () => {
    await writeRow("score_baseline_method", "mean");
    await writeRow("score_min_usable_posts", "8");
    const s = await settings.getSettings();
    expect(s.scoreBaselineMethod).toBe("mean");
    expect(s.scoreMinUsablePosts).toBe(8);
  });
});

describe("getSettings — corrupt stored value", () => {
  test("an unparseable row is treated as absent, not thrown", async () => {
    await writeRow("score_baseline_method", "not-a-real-method");
    await writeRow("score_min_usable_posts", "not-a-number");
    const s = await settings.getSettings();
    expect(s.scoreBaselineMethod).toBe("median"); // falls through to default
    expect(s.scoreMinUsablePosts).toBe(5);
  });

  test("an out-of-range stored number is treated as absent", async () => {
    await writeRow("score_min_usable_posts", "-3");
    const s = await settings.getSettings();
    expect(s.scoreMinUsablePosts).toBe(5);
  });
});

describe("getSettingsWithSource", () => {
  test("reports source db/env/default correctly, and wired matches the module's static map", async () => {
    await writeRow("score_baseline_method", "trimmedMean");
    const view = await settings.getSettingsWithSource();

    expect(view.scoreBaselineMethod).toEqual({ value: "trimmedMean", source: "db", wired: true });
    expect(view.syncLookbackDays).toEqual({ value: 45, source: "env", wired: true });
    expect(view.scoreMinViewsFloor).toEqual({ value: 0, source: "default", wired: true });

    // These three are stored and readable, but nothing in the app consumes them yet —
    // the flag exists so a future Settings UI doesn't imply otherwise.
    expect(view.feedDefaultMinScore.wired).toBe(false);
    expect(view.syncCadenceMinutes.wired).toBe(false);
    expect(view.mediaRetentionDays.wired).toBe(false);
  });
});

describe("getSetting", () => {
  test("returns a single resolved value, matching what getSettings returns for the same key", async () => {
    await writeRow("score_min_views_floor", "2500");
    expect(await settings.getSetting("scoreMinViewsFloor")).toBe(2500);
  });
});

describe("validateSetting", () => {
  test("accepts a valid enum value", () => {
    const result = settings.validateSetting("scoreBaselineMethod", "mean");
    expect(result).toEqual({ ok: true, dbKey: "score_baseline_method", dbValue: "mean" });
  });

  test("accepts a valid number and serializes it as a string", () => {
    const result = settings.validateSetting("scoreMinUsablePosts", 10);
    expect(result).toEqual({ ok: true, dbKey: "score_min_usable_posts", dbValue: "10" });
  });

  test("rejects an out-of-enum value", () => {
    const result = settings.validateSetting("scoreBaselineMethod", "average");
    expect(result.ok).toBe(false);
  });

  test("rejects an out-of-range number", () => {
    const result = settings.validateSetting("scoreMinUsablePosts", 0);
    expect(result.ok).toBe(false);
  });

  test("rejects an unknown key", () => {
    // @ts-expect-error deliberately passing a key outside AppSettings for the runtime check
    const result = settings.validateSetting("notARealKey", "x");
    expect(result).toEqual({ ok: false, error: "Unknown setting: notARealKey" });
  });
});

describe("windowSpecFor", () => {
  test("maps every enum value to the WindowSpec outlier-calc.ts expects", () => {
    expect(settings.windowSpecFor("last12Posts")).toEqual({ kind: "posts", count: 12 });
    expect(settings.windowSpecFor("last30Days")).toEqual({ kind: "days", count: 30 });
    expect(settings.windowSpecFor("allHistory")).toEqual({ kind: "all" });
  });
});

describe("getScoringOptions", () => {
  test("assembles BaselineOptions straight from the resolved settings", async () => {
    await writeRow("score_baseline_method", "mean");
    await writeRow("score_baseline_window", "allHistory");
    await writeRow("score_min_usable_posts", "3");
    await writeRow("score_min_views_floor", "100");

    expect(await settings.getScoringOptions()).toEqual({
      method: "mean",
      window: { kind: "all" },
      minUsable: 3,
      minViewsFloor: 100,
    });
  });
});
