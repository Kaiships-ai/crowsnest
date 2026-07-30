import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { LlmClient } from "../llm/client";

let db: typeof import("../db")["db"];
let tables: typeof import("../db")["tables"];
let newId: typeof import("../db")["newId"];
let nowIso: typeof import("../db")["nowIso"];
let migrate: typeof import("../db/test-migrate")["migrate"];
let getNicheSettings: typeof import("./settings-actions")["getNicheSettings"];
let saveNicheSettingsAction: typeof import("./settings-actions")["saveNicheSettingsAction"];
let testAnthropicKeyAction: typeof import("./settings-actions")["testAnthropicKeyAction"];
let getAppSettingsAction: typeof import("./settings-actions")["getAppSettingsAction"];
let updateAppSettingsAction: typeof import("./settings-actions")["updateAppSettingsAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  // config.ts refuses to boot without this — pulled in transitively via
  // ../settings -> ../config, and now also via ../services/sync-engine (the score
  // recompute path). Never actually contacted by these tests.
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables, newId, nowIso } = await import("../db"));
  ({ migrate } = await import("../db/test-migrate"));
  ({ getNicheSettings, saveNicheSettingsAction, testAnthropicKeyAction, getAppSettingsAction, updateAppSettingsAction } = await import(
    "./settings-actions"
  ));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.appSettings);
  await db.delete(tables.videos);
  await db.delete(tables.channels);
});

function fakeLlm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    generateText: vi.fn(),
    generateParsed: vi.fn(),
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("getNicheSettings", () => {
  test("returns the fallback niche and empty keywords when nothing has ever been saved", async () => {
    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "general short-form content", keywords: [] });
  });
});

describe("saveNicheSettingsAction", () => {
  test("round-trips niche + keywords through getNicheSettings", async () => {
    const result = await saveNicheSettingsAction("AI productivity tools for solo founders", ["ai", "productivity", "solo"]);
    expect(result).toEqual({ ok: true });

    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "AI productivity tools for solo founders", keywords: ["ai", "productivity", "solo"] });
  });

  test("a second save overwrites the first (update path, not a duplicate-key error)", async () => {
    await saveNicheSettingsAction("first niche", ["a"]);
    const second = await saveNicheSettingsAction("second niche", ["b", "c"]);

    expect(second).toEqual({ ok: true });
    const settings = await getNicheSettings();
    expect(settings).toEqual({ niche: "second niche", keywords: ["b", "c"] });
  });
});

describe("testAnthropicKeyAction", () => {
  test("ok:true when ping() succeeds", async () => {
    const result = await testAnthropicKeyAction(fakeLlm());
    expect(result).toEqual({ ok: true });
  });

  test("maps a ping() rejection through the shared llmErrorMessage helper", async () => {
    const llm = fakeLlm({ ping: vi.fn().mockRejectedValue(new Error("some transport failure")) });

    const result = await testAnthropicKeyAction(llm);

    expect(result).toEqual({ ok: false, error: "some transport failure" });
  });

  test("no key configured (no fake given, real getLlm() path): a friendly not-set message, no network call", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await testAnthropicKeyAction();

    expect(result).toEqual({ ok: false, error: "ANTHROPIC_API_KEY is not set." });
  });
});

describe("getAppSettingsAction", () => {
  test("returns every P0 key resolved through the settings module's precedence, with source metadata", async () => {
    const view = await getAppSettingsAction();

    expect(view.scoreBaselineMethod).toEqual({ value: "median", source: "default", wired: true });
    expect(view.scoreMinUsablePosts).toEqual({ value: 5, source: "default", wired: true });
    // syncLookbackDays has no DB row here, so it falls back to config.ts's LOOKBACK_DAYS.
    expect(view.syncLookbackDays.source).toBe("env");
  });
});

describe("updateAppSettingsAction", () => {
  test("writes a single key and getAppSettingsAction reflects it afterward, sourced from the DB", async () => {
    const result = await updateAppSettingsAction({ scoreBaselineMethod: "mean" });
    expect(result).toEqual({ ok: true });

    const view = await getAppSettingsAction();
    expect(view.scoreBaselineMethod).toEqual({ value: "mean", source: "db", wired: true });
  });

  test("writes several keys atomically", async () => {
    const result = await updateAppSettingsAction({ scoreMinUsablePosts: 8, scoreMinViewsFloor: 250 });
    expect(result).toEqual({ ok: true });

    const view = await getAppSettingsAction();
    expect(view.scoreMinUsablePosts.value).toBe(8);
    expect(view.scoreMinViewsFloor.value).toBe(250);
  });

  test("rejects an invalid value and writes nothing — not even the valid keys in the same call", async () => {
    const result = await updateAppSettingsAction({
      scoreMinUsablePosts: 6, // valid on its own
      scoreBaselineMethod: "average" as never, // not a real enum member
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("scoreBaselineMethod");

    // The valid key in the same patch must not have been written either — all-or-nothing.
    const view = await getAppSettingsAction();
    expect(view.scoreMinUsablePosts).toEqual({ value: 5, source: "default", wired: true });
  });

  test("an empty patch is a no-op success", async () => {
    expect(await updateAppSettingsAction({})).toEqual({ ok: true });
  });

  test("a second write overwrites the first (update path, not a duplicate-key error)", async () => {
    await updateAppSettingsAction({ scoreBaselineWindow: "last30Days" });
    const second = await updateAppSettingsAction({ scoreBaselineWindow: "allHistory" });

    expect(second).toEqual({ ok: true });
    const view = await getAppSettingsAction();
    expect(view.scoreBaselineWindow.value).toBe("allHistory");
  });
});

describe("updateAppSettingsAction — a score-meaning setting recomputes stored scores, not just future ones", () => {
  async function seedChannelWithVideos(views: number[]): Promise<{ channelId: string; videoIds: string[] }> {
    const channelId = newId();
    await db.insert(tables.channels).values({
      id: channelId,
      platform: "instagram",
      handle: `@settings-test-${channelId}`,
      trackedSince: nowIso(),
    });
    const videoIds: string[] = [];
    for (const [i, viewCount] of views.entries()) {
      const videoId = newId();
      await db.insert(tables.videos).values({
        id: videoId,
        channelId,
        platform: "instagram",
        externalId: `settings-test-${videoId}`,
        url: "https://example.com/v",
        postedAt: new Date(Date.now() - (views.length - i) * 86_400_000).toISOString(),
        viewCount,
        firstSeenAt: nowIso(),
      });
      videoIds.push(videoId);
    }
    return { channelId, videoIds };
  }

  test("changing scoreBaselineMethod rewrites videos.outlier_score immediately — no sync required", async () => {
    // Median and mean disagree for this set: median([100,200,300,400,5000]) = 300,
    // mean = 1200. Nothing has ever scored these videos (no sync has run), so they
    // start null — this proves the recompute runs from the settings action itself, not
    // from some score already sitting there from a previous test or a sync.
    const { videoIds } = await seedChannelWithVideos([100, 200, 300, 400, 5000]);
    const spikeId = videoIds[4];

    const before = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, spikeId));
    expect(before[0].outlierScore).toBeNull();

    const result = await updateAppSettingsAction({ scoreBaselineMethod: "mean" });
    expect(result).toEqual({ ok: true });

    // mean baseline 1200 → 5000 / 1200 = 4.1666.. → 4.2, one decimal, same rounding
    // scoreVideosAgainstBaseline always uses.
    const after = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, spikeId));
    expect(after[0].outlierScore).toBe(4.2);
  });

  test("a setting that doesn't change what a score means (feedDefaultMinScore) leaves stored scores untouched", async () => {
    const { videoIds } = await seedChannelWithVideos([100, 200, 300, 400, 500]);
    // Hand-set a score to a value recompute would never produce, so any accidental
    // recompute here is unmistakable.
    await db.update(tables.videos).set({ outlierScore: 42 }).where(eq(tables.videos.id, videoIds[0]));

    const result = await updateAppSettingsAction({ feedDefaultMinScore: 3 });
    expect(result).toEqual({ ok: true });

    const row = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, videoIds[0]));
    expect(row[0].outlierScore).toBe(42);
  });

  test("recomputes across every channel, not just one", async () => {
    const a = await seedChannelWithVideos([100, 100, 100, 100, 100]);
    const b = await seedChannelWithVideos([50, 50, 50, 50, 500]);

    await updateAppSettingsAction({ scoreMinViewsFloor: 0 }); // still a score-meaning key, even at its default value

    const aScore = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, a.videoIds[0]));
    const bScore = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, b.videoIds[4]));
    expect(aScore[0].outlierScore).toBe(1.0); // 100 / median(100) = 1.0
    expect(bScore[0].outlierScore).toBe(10.0); // 500 / median(50) = 10.0
  });
});

describe("db.transaction rollback — the mechanism updateAppSettingsAction's atomicity depends on", () => {
  test("a throw partway through a transaction rolls back every write already made in it, not just the one that failed", async () => {
    // Same shape of writes updateAppSettingsAction makes inside its transaction: an
    // app_settings upsert, then a videos update — then a throw simulating a mid-recompute
    // failure on some later channel. This is not testing updateAppSettingsAction's own
    // code (that's covered above); it is testing the exact primitive it relies on for
    // its atomicity claim, isolated from everything else that could go wrong.
    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@rollback-test-${channelId}`, trackedSince: nowIso() });
    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: `rollback-${videoId}`,
      url: "https://example.com/v",
      postedAt: nowIso(),
      viewCount: 100,
      outlierScore: 7,
      firstSeenAt: nowIso(),
    });

    expect(() => {
      db.transaction((tx) => {
        tx.insert(tables.appSettings).values({ key: "score_baseline_method", value: "mean" }).run();
        tx.update(tables.videos).set({ outlierScore: 99 }).where(eq(tables.videos.id, videoId)).run();
        throw new Error("simulated failure partway through recompute");
      });
    }).toThrow("simulated failure partway through recompute");

    // Neither write survived the rollback — the setting was never inserted, and the
    // score-update that ran just before the throw was undone along with it.
    const settingRows = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, "score_baseline_method"));
    expect(settingRows).toHaveLength(0);
    const videoRow = await db.select({ outlierScore: tables.videos.outlierScore }).from(tables.videos).where(eq(tables.videos.id, videoId));
    expect(videoRow[0].outlierScore).toBe(7);
  });
});
