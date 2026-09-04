import { beforeAll, beforeEach, describe, expect, test } from "vitest";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let settings: typeof import("./index");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // config.ts refuses to boot without this — never actually contacted by these tests.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  // Legacy env layer under test: LOOKBACK_DAYS/MAX_ITEMS_PER_SYNC/SYNC_INTERVAL_MINUTES/
  // MEDIA_RETENTION_DAYS are read once at config.ts's module load, so they're set here,
  // before any import.
  process.env.LOOKBACK_DAYS = "45";
  process.env.MAX_ITEMS_PER_SYNC = "350";
  process.env.SYNC_CONCURRENCY = "4";
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
  test("the legacy keys fall back to their validated env var when no DB row exists", async () => {
    const s = await settings.getSettings();
    expect(s.syncLookbackDays).toBe(45); // process.env.LOOKBACK_DAYS
    expect(s.maxItemsPerSync).toBe(350); // process.env.MAX_ITEMS_PER_SYNC
    expect(s.syncConcurrency).toBe(4); // process.env.SYNC_CONCURRENCY
    expect(s.syncCadenceMinutes).toBe(120); // process.env.SYNC_INTERVAL_MINUTES
    expect(s.mediaRetentionDays).toBe(14); // process.env.MEDIA_RETENTION_DAYS
  });
});

describe("viewCountEnrichPerChannel (M5-U1)", () => {
  // Enrichment is opt-in: the default is 0, so no sync scrapes a competitor's view counts
  // until the user sets this. The UI recommends at least 12 (the last12Posts baseline
  // window) once it is turned on, but the shipped default runs nothing, so a fresh install
  // never spends burner requests without being asked.
  test("defaults to 0, opt-in", async () => {
    const s = await settings.getSettings();
    expect(s.viewCountEnrichPerChannel).toBe(0);
  });

  test("a stored row wins, including 0 to turn the pass off", async () => {
    await writeRow("view_count_enrich_per_channel", "40");
    expect((await settings.getSettings()).viewCountEnrichPerChannel).toBe(40);

    await db.delete(tables.appSettings);
    await writeRow("view_count_enrich_per_channel", "0");
    expect((await settings.getSettings()).viewCountEnrichPerChannel).toBe(0);
  });

  test("a value past the 200 ceiling is treated as absent", async () => {
    // The ceiling is a ban-risk guard, not a formality: every unit here is one more live
    // request per channel per sync from a burner account.
    await writeRow("view_count_enrich_per_channel", "201");
    expect((await settings.getSettings()).viewCountEnrichPerChannel).toBe(0);
  });

  test("validateSetting accepts the range boundaries and rejects outside them", () => {
    expect(settings.validateSetting("viewCountEnrichPerChannel", 0).ok).toBe(true);
    expect(settings.validateSetting("viewCountEnrichPerChannel", 200).ok).toBe(true);
    expect(settings.validateSetting("viewCountEnrichPerChannel", 201).ok).toBe(false);
    expect(settings.validateSetting("viewCountEnrichPerChannel", -1).ok).toBe(false);
  });

  test("is reported as wired, because the sync engine reads it", async () => {
    const view = await settings.getSettingsWithSource();
    expect(view.viewCountEnrichPerChannel.wired).toBe(true);
    expect(view.viewCountEnrichPerChannel.value).toBe(0);
  });
});

describe("syncConcurrency (Goal 3 T1)", () => {
  // The built-in default of 2 lives in config.ts and is asserted in config.test.ts
  // ("applies documented defaults"); here the env layer is set to 4 in beforeAll, exactly
  // like maxItemsPerSync, so these prove env -> DB precedence and the clamp instead.
  test("falls back to its env var (SYNC_CONCURRENCY) when no DB row exists", async () => {
    const s = await settings.getSettings();
    expect(s.syncConcurrency).toBe(4);
  });

  test("a stored row wins over the env var", async () => {
    await writeRow("sync_concurrency", "8");
    expect((await settings.getSettings()).syncConcurrency).toBe(8);
  });

  test("an out-of-range stored value is treated as absent, falling back to env", async () => {
    await writeRow("sync_concurrency", "17");
    expect((await settings.getSettings()).syncConcurrency).toBe(4);
  });

  test("validateSetting clamps to 1..16", () => {
    expect(settings.validateSetting("syncConcurrency", 1).ok).toBe(true);
    expect(settings.validateSetting("syncConcurrency", 16).ok).toBe(true);
    expect(settings.validateSetting("syncConcurrency", 17).ok).toBe(false);
    expect(settings.validateSetting("syncConcurrency", 0).ok).toBe(false);
  });

  test("is reported as not-yet-wired (runSync reads it in T3)", async () => {
    const view = await settings.getSettingsWithSource();
    expect(view.syncConcurrency.wired).toBe(false);
  });
});

describe("getSettings — precedence: DB beats env", () => {
  test("a stored row wins over the env var for the same key", async () => {
    await writeRow("sync_lookback_days", "7");
    const s = await settings.getSettings();
    expect(s.syncLookbackDays).toBe(7);
  });

  // B3 (review-engineering-2026-07-31.md §3): MAX_ITEMS_PER_SYNC used to be read
  // straight from config, bypassing this precedence chain entirely, so a change required
  // an env var edit and a restart. This proves a DB row now wins over the env var here
  // too, exactly like its sibling syncLookbackDays already did.
  test("a stored row wins over the env var for max_items_per_sync too", async () => {
    await writeRow("max_items_per_sync", "75");
    const s = await settings.getSettings();
    expect(s.maxItemsPerSync).toBe(75);
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
    expect(view.maxItemsPerSync).toEqual({ value: 350, source: "env", wired: true });
    expect(view.scoreMinViewsFloor).toEqual({ value: 0, source: "default", wired: true });

    // These three are stored and readable, but nothing in the app consumes them yet —
    // the flag exists so a future Settings UI doesn't imply otherwise.
    expect(view.feedDefaultMinScore.wired).toBe(false);
    expect(view.syncCadenceMinutes.wired).toBe(false);
    expect(view.mediaRetentionDays.wired).toBe(false);
  });
});

describe("getSettings — firstRunCompleted", () => {
  test("defaults to false with no row", async () => {
    const s = await settings.getSettings();
    expect(s.firstRunCompleted).toBe(false);
  });

  test("a stored \"true\" row resolves to boolean true", async () => {
    await writeRow("first_run_completed", "true");
    const s = await settings.getSettings();
    expect(s.firstRunCompleted).toBe(true);
  });

  test("a stored \"false\" row resolves to boolean false, not truthy-string true", async () => {
    await writeRow("first_run_completed", "false");
    const s = await settings.getSettings();
    expect(s.firstRunCompleted).toBe(false);
  });

  test("validateSetting round-trips a boolean write to the same strings a read accepts", () => {
    const written = settings.validateSetting("firstRunCompleted", true);
    expect(written).toEqual({ ok: true, dbKey: "first_run_completed", dbValue: "true" });
    const writtenFalse = settings.validateSetting("firstRunCompleted", false);
    expect(writtenFalse).toEqual({ ok: true, dbKey: "first_run_completed", dbValue: "false" });
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
