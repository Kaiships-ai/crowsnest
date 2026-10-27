import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `./client` imports `../config`, which throws at module load if `IG_SERVICE_TOKEN` is
 * missing (unrelated to anything tested here, but it's the same process). Every test
 * below dynamically imports `./client` AFTER setting env vars for the case under test,
 * and `vi.resetModules()` in `beforeEach` forces `../config` to re-evaluate against the
 * current env each time — otherwise the Graph token state from one test would leak into
 * the next via Node's module cache.
 *
 * `./client` also now imports `../secrets/store`, which imports `@/server/db`
 * unconditionally at module load and queries the `secrets` table for every
 * `getSecret` call. `loadClient()` below sets CROWSNEST_DB_PATH=":memory:" and runs
 * migrations before each dynamic import (`vi.resetModules()` means a brand new,
 * unmigrated in-memory db is created on every import) so `getSecret` has a table to
 * query against instead of throwing, and so the real on-disk db is never touched.
 */

/** Graph calls the transport counted since this test began (the ledger is on globalThis). */
const calls = () => (globalThis as { __crowsnestOwnMeasure?: { graphCalls?: { total: number } } }).__crowsnestOwnMeasure?.graphCalls?.total ?? 0;

beforeEach(() => {
  delete (globalThis as { __crowsnestOwnMeasure?: unknown }).__crowsnestOwnMeasure;
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  delete process.env.IG_GRAPH_TOKEN;
  delete process.env.IG_GRAPH_USER_ID;
});

async function loadClient() {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();
  return import("./client");
}

describe("mapAccount", () => {
  test("maps the Graph API's account fields", async () => {
    const { mapAccount } = await loadClient();
    const acct = mapAccount({
      id: "17841400000000000",
      username: "kallaway",
      followers_count: 442288,
      follows_count: 812,
      media_count: 1204,
    });
    expect(acct).toEqual({
      id: "17841400000000000",
      username: "kallaway",
      followersCount: 442288,
      followsCount: 812,
      mediaCount: 1204,
    });
  });

  test("a follower count of 0 is a real measurement, not dropped", async () => {
    const { mapAccount } = await loadClient();
    expect(mapAccount({ id: "1", username: "x", followers_count: 0 }).followersCount).toBe(0);
  });

  test("throws GraphApiError when a required field is missing, never returns undefined", async () => {
    const { mapAccount } = await loadClient();
    const { GraphApiError } = await import("./errors");
    expect(() => mapAccount({ id: "1" })).toThrow(GraphApiError);
    try {
      mapAccount({ username: "x" });
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as InstanceType<typeof GraphApiError>).code).toBe("GRAPH_UNKNOWN");
    }
  });
});

describe("mapInsights", () => {
  const RAW = {
    data: [
      { name: "reach", values: [{ value: 500 }] },
      { name: "saved", values: [{ value: 12 }] },
      { name: "shares", values: [{ value: 3 }] },
      { name: "total_interactions", values: [{ value: 40 }] },
      { name: "comments", values: [{ value: 5 }] },
      { name: "likes", values: [{ value: 30 }] },
      { name: "views", values: [{ value: 9000 }] },
    ],
  };

  test("maps every requested metric when the post is a reel", async () => {
    const { mapInsights } = await loadClient();
    expect(mapInsights(RAW, true)).toEqual({
      reach: 500,
      saved: 12,
      shares: 3,
      totalInteractions: 40,
      comments: 5,
      likes: 30,
      views: 9000,
      profileVisits: null,
      followsFromPost: null,
      watchTimeSec: null,
      reposts: null,
      skipRate: null,
      avgWatchTimeMs: null,
      totalWatchTimeMs: null,
      bioLinkTaps: null,
    });
  });

  test("never carries a views figure for a non-reel, even if the API sent one", async () => {
    const { mapInsights } = await loadClient();
    expect(mapInsights(RAW, false).views).toBeNull();
  });
});

describe("mapInsights, extended reel set", () => {
  test("maps follows, profile_visits and the new reel metrics; watchTimeSec stays null", async () => {
    const { mapInsights } = await loadClient();
    const raw = { data: [
      { name: "views", values: [{ value: 120000 }] },
      { name: "reach", values: [{ value: 80997 }] },
      { name: "follows", values: [{ value: 12 }] },
      { name: "profile_visits", values: [{ value: 40 }] },
      { name: "reposts", values: [{ value: 9 }] },
      { name: "reels_skip_rate", values: [{ value: 41.5 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 4500 }] },
      { name: "ig_reels_video_view_total_time", values: [{ value: 900000 }] },
    ] };
    expect(mapInsights(raw, true)).toMatchObject({
      views: 120000, reach: 80997, followsFromPost: 12, profileVisits: 40, reposts: 9,
      skipRate: 41.5, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000, watchTimeSec: null, bioLinkTaps: null,
    });
  });
});

describe("mapBioLinkTaps", () => {
  const withActions = (results: unknown[]) => ({ data: [{ name: "profile_activity", total_value: { value: 0, breakdowns: [{ dimension_keys: ["action_type"], results }] } }] });
  test("takes the bio link action value", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }, { dimension_values: ["BIO_LINK_CLICKED"], value: 7 }]))).toBe(7);
  });
  test("is 0 when the call succeeded without a bio link action (Graph omits zero-valued types)", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }]))).toBe(0);
  });
});

describe("graphClient.fetchMedia", () => {
  test("lists media with thumbnail_url and maps it", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [
      { id: "r1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://i/r1", timestamp: "2026-09-01T00:00:00+0000", like_count: 5, comments_count: 2, caption: "c", thumbnail_url: "https://cdn/r1.jpg" },
    ] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const media = await graphClient.fetchMedia();
    expect(media).toEqual([{ externalId: "r1", permalink: "https://i/r1", mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: "c", postedAt: "2026-09-01T00:00:00+0000", likeCount: 5, commentsCount: 2, thumbnailUrl: "https://cdn/r1.jpg" }]);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("fields")).toContain("thumbnail_url");
  });
});

describe("graphClient.fetchPostInsights", () => {
  const REEL = { externalId: "r1", permalink: "", mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: null, postedAt: "2026-09-01T00:00:00+0000", likeCount: null, commentsCount: null, thumbnailUrl: null };
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const metrics = (pairs: Record<string, number>) => ({ data: Object.entries(pairs).map(([name, value]) => ({ name, values: [{ value }] })) });
  const activity = (value: number | null) => ({ data: [{ name: "profile_activity", total_value: { breakdowns: [{ results: value === null ? [] : [{ dimension_values: ["BIO_LINK_CLICKED"], value }] }] } }] });

  beforeEach(() => { process.env.IG_GRAPH_TOKEN = "tok_secret"; process.env.IG_GRAPH_USER_ID = "17841400000000000"; });

  test("a non-fatal profile_activity failure makes the pull partial, missing bio link taps, without ending the run", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 })))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "(#100) profile_activity not supported" } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "partial", rows: { views: 10 }, missing: "bio link taps", reason: { error: { code: "GRAPH_INVALID_REQUEST" }, endsRun: false } });
    expect(calls()).toBe(2);
  });

  test("profile_activity refused for the media product type is a complete pull with no bio link taps", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 })))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "The Media Insights API does not support the profile_activity metric for this media product type." } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { views: 10, reach: 8, bioLinkTaps: null } });
  });

  test("ACTION-22: bio link taps from profile_activity by action_type, 0 when absent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(7)))
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { bioLinkTaps: 7 } });
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { bioLinkTaps: 0 } });
    const url = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url.searchParams.get("metric")).toBe("profile_activity");
    expect(url.searchParams.get("breakdown")).toBe("action_type");
  });

  test("ACTION-23: a refused extended metric falls back to the core set without zeroing it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "reels_skip_rate not supported" } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 120000, reach: 80997, shares: 1112, likes: 50 })))
      .mockResolvedValueOnce(ok(activity(3)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { views: 120000, reach: 80997, shares: 1112, likes: 50, skipRate: null, reposts: null, bioLinkTaps: 3 } });
    expect(calls()).toBe(3);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("metric")).toContain("reels_skip_rate");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes,views");
  });

  test("a reel's extended set skips follows and profile_visits (FEED and STORY only); a fallback logs the Graph error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "(#100) reels_skip_rate not supported" } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 9 })))
      .mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { log } = await import("../lib/logger");
    const warn = vi.spyOn(log, "warn");
    await graphClient.fetchPostInsights(REEL);
    const metric = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("metric") ?? "";
    expect(metric.split(",")).not.toContain("follows");
    expect(metric.split(",")).not.toContain("profile_visits");
    expect(metric).toContain("ig_reels_avg_watch_time");
    expect(metric.split(",")).not.toContain("reposts");
    const fallback = warn.mock.calls.find(([event]) => event === "graph.insights.extended_fallback");
    expect(JSON.stringify(fallback?.[1])).toContain("reels_skip_rate not supported");
  });

  test("a rate limit returns a stop so the run can end", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_RATE_LIMITED" }, endsRun: true } });
    expect(calls()).toBe(1);
  });

  test("a fatal on profile_activity is a partial pull that keeps the reel's insights and counts every call", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 })))
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "partial", rows: { views: 10, reach: 8, bioLinkTaps: null }, missing: "bio link taps", reason: { error: { code: "GRAPH_RATE_LIMITED" }, endsRun: true } });
    expect(calls()).toBe(2);
  });

  test("a fatal on the fallback call counts both calls", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100 } }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 190 } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_AUTH_FAILED" }, endsRun: true } });
    expect(calls()).toBe(2);
  });

  test("Meta's real envelope: a refused metric (code 100, type OAuthException) still falls back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, type: "OAuthException", message: "(#100) metric not supported" } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 9, reach: 7 })))
      .mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { views: 9, reach: 7 } });
    expect(calls()).toBe(3);
  });

  test("a permission refusal on one metric set is not fatal: the core-set fallback still runs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { code: 10 } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 9, reach: 7 })))
      .mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "complete", rows: { views: 9, reach: 7 } });
    expect(calls()).toBe(3);
  });

  test.each([
    { code: 200, message: "(#200) Requires instagram_manage_insights permission" },
    { code: 10, message: "(#10) Application does not have permission for this action" },
  ])("a scope refusal (code $code) on the core set too means the token lacks insights: the run stops with GRAPH_PERMISSION_DENIED", async (error) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { ...error, type: "OAuthException" } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { ...error, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_PERMISSION_DENIED" }, endsRun: true } });
    expect(calls()).toBe(2);
  });

  test("code 10 'Not enough viewers' on the core set is one post's failure, not a token-wide stop", async () => {
    const notEnough = { ok: false, status: 400, json: async () => ({ error: { code: 10, type: "OAuthException", message: "(#10) Not enough viewers for the media to show insights" } }) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(notEnough).mockResolvedValueOnce(notEnough));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchPostInsights(REEL);
    expect(out).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_PERMISSION_DENIED" }, endsRun: false } });
    expect(calls()).toBe(2);
    expect(out.kind === "failed" && out.reason.error.message).toContain("Not enough viewers");
  });

  test("Meta's real envelope: a rate limit (code 4, type OAuthException) is rate_limited, not auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 4, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_RATE_LIMITED" }, endsRun: true } });
  });

  test("an IG business use case throttle (HTTP 400, code 80002) stops the run as rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 80002, type: "OAuthException", is_transient: true } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_RATE_LIMITED" }, endsRun: true } });
    expect(calls()).toBe(1);
  });

  test("a dead token (code 190) still ends the run as auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 190, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    expect(await graphClient.fetchPostInsights(REEL)).toMatchObject({ kind: "failed", reason: { error: { code: "GRAPH_AUTH_FAILED" }, endsRun: true } });
  });

  test("a non-reel asks for follows and profile visits in one call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(metrics({ reach: 5, follows: 2, profile_visits: 9 })));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchPostInsights({ ...REEL, productType: "FEED", format: "Carousel" });
    expect(calls()).toBe(1);
    expect(out).toMatchObject({ kind: "complete", rows: { reach: 5, followsFromPost: 2, profileVisits: 9, views: null } });
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes,follows,profile_visits");
  });

  test("a non-reel whose extended set is refused falls back to the core set", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100 } }) })
      .mockResolvedValueOnce(ok(metrics({ reach: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchPostInsights({ ...REEL, productType: "FEED", format: "Carousel" });
    expect(calls()).toBe(2);
    expect(out).toMatchObject({ kind: "complete", rows: { reach: 5, profileVisits: null } });
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes");
  });
});

describe("graphClient.fetchAccountBreakdowns", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const results = (pairs: [string, number][]) => ({ data: [{ total_value: { breakdowns: [{ results: pairs.map(([k, value]) => ({ dimension_values: [k], value })) }] } }] });
  beforeEach(() => { process.env.IG_GRAPH_TOKEN = "tok_secret"; process.env.IG_GRAPH_USER_ID = "17841400000000000"; });

  test("follower split from views by follower_type, audience from engaged_audience_demographics", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 300], ["NON_FOLLOWER", 700]])))
      .mockResolvedValueOnce(ok(results([["25-34", 40], ["18-24", 30]])))
      .mockResolvedValueOnce(ok(results([["US", 50]])))
      .mockResolvedValueOnce(ok(results([["F", 60], ["M", 40]])));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { split, audience } = await graphClient.fetchAccountBreakdowns();
    expect(calls()).toBe(4);
    expect(split).toMatchObject({ kind: "complete", rows: [{ metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 300, timeframe: "day" }, { key: "NON_FOLLOWER", value: 700 }] });
    expect(audience.kind).toBe("complete");
    expect(audience.kind === "complete" && audience.rows).toContainEqual({ metric: "engaged_audience_demographics", dimension: "country", key: "US", value: 50, timeframe: "this_month" });
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.searchParams.get("breakdown")).toBe("follow_type");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("engaged_audience_demographics");
  });

  test("a non-fatal follower split failure is reported and logged, the audience calls still run", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, message: "(#100) bad breakdown" } }) })
      .mockResolvedValueOnce(ok(results([["25-34", 40]])))
      .mockResolvedValueOnce(ok(results([["US", 50]])))
      .mockResolvedValueOnce(ok(results([["F", 60]]))));
    const { graphClient } = await loadClient();
    const { log } = await import("../lib/logger");
    const warn = vi.spyOn(log, "warn");
    const { split, audience } = await graphClient.fetchAccountBreakdowns();
    expect(split.kind === "failed" && split.reason.message).toContain("bad breakdown");
    expect(audience).toMatchObject({ kind: "complete", rows: [{}, {}, {}] });
    expect(warn.mock.calls.some(([event]) => event === "graph.breakdowns.split_failed")).toBe(true);
  });

  test("a split call that is itself the run-ending rate limit fails both pulls with that stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out).toMatchObject({ split: { kind: "failed", reason: { code: "GRAPH_RATE_LIMITED" } }, audience: { kind: "failed", reason: { code: "GRAPH_RATE_LIMITED" } } });
    expect(calls()).toBe(1);
  });

  test("a lack-of-volume refusal returns a threshold state, not an empty audience", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 10, message: "Not enough users" } }) }));
    const { graphClient } = await loadClient();
    const { split, audience } = await graphClient.fetchAccountBreakdowns();
    expect(audience.kind === "failed" && audience.reason.message).toContain("Not enough users");
    expect(split.kind).toBe("complete");
    expect(calls()).toBe(2);
  });

  test("a failure on a later audience dimension makes the audience pull partial, with the error kept", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce(ok(results([["25-34", 40]])))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { code: 2, message: "Service temporarily unavailable" } }) }));
    const { graphClient } = await loadClient();
    const { audience } = await graphClient.fetchAccountBreakdowns();
    expect(audience).toMatchObject({ kind: "partial", rows: [{ dimension: "age" }], missing: "country, gender" });
    expect(audience.kind === "partial" && audience.reason.message).toContain("temporarily unavailable");
    expect(calls()).toBe(3);
  });

  test("the refusal in Meta's real envelope (code 10, type OAuthException) is a threshold, not a thrown auth failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 10, type: "OAuthException", message: "Not enough users" } }) }));
    const { graphClient } = await loadClient();
    const { split, audience } = await graphClient.fetchAccountBreakdowns();
    expect(audience.kind === "failed" && audience.reason.message).toContain("Not enough users");
    expect(split).toMatchObject({ kind: "complete", rows: [{}] });
  });
});

describe("classifyComment", () => {
  test("an ordinary stranger's comment is organic", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("love this!", "a_stranger", "kallaway")).toBe("organic");
  });

  test("a known self-test phrase from someone else's username is self-test", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("machine gun", "someone_else", "kallaway")).toBe("self-test");
  });

  test("known auto-reply copy from someone else's username is bot-reply", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("please check the dm", "someone_else", "kallaway")).toBe("bot-reply");
  });

  test("the account's own username commenting ordinary text is own-comment", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("thanks so much!", "kallaway", "kallaway")).toBe("own-comment");
  });

  test("the account's own username posting the auto-reply copy is bot-or-self-reply", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("please check the dm", "kallaway", "kallaway")).toBe("bot-or-self-reply");
  });

  test("matching is case- and whitespace-insensitive, like ig_stats.py's classify_comment", async () => {
    const { classifyComment } = await loadClient();
    expect(classifyComment("  MACHINE GUN  ", "someone_else", "kallaway")).toBe("self-test");
  });
});

describe("redactToken", () => {
  test("strips every occurrence of the token from a string", async () => {
    const { redactToken } = await loadClient();
    expect(redactToken("HTTP 401: token=SECRET123 and again SECRET123", "SECRET123")).toBe("HTTP 401: token=<redacted> and again <redacted>");
  });

  test("a message with no token in it is left alone", async () => {
    const { redactToken } = await loadClient();
    expect(redactToken("network error: timeout", "SECRET123")).toBe("network error: timeout");
  });
});

describe("isGraphConfigured", () => {
  test("false with neither env var set", async () => {
    const { isGraphConfigured } = await loadClient();
    expect(isGraphConfigured()).toBe(false);
  });

  test("false with only one of the two set", async () => {
    process.env.IG_GRAPH_TOKEN = "tok";
    const { isGraphConfigured } = await loadClient();
    expect(isGraphConfigured()).toBe(false);
  });

  test("true with both set", async () => {
    process.env.IG_GRAPH_TOKEN = "tok";
    process.env.IG_GRAPH_USER_ID = "123";
    const { isGraphConfigured } = await loadClient();
    expect(isGraphConfigured()).toBe(true);
  });
});

describe("graphClient.fetchAccount", () => {
  test("throws GRAPH_NOT_CONFIGURED with no token, and never touches the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { GraphApiError } = await import("./errors");

    await expect(graphClient.fetchAccount()).rejects.toBeInstanceOf(GraphApiError);
    await expect(graphClient.fetchAccount()).rejects.toMatchObject({ code: "GRAPH_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("maps a successful response", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "17841400000000000", username: "kallaway", followers_count: 100, follows_count: 10, media_count: 5 }),
      })
    );
    const { graphClient } = await loadClient();
    const acct = await graphClient.fetchAccount();
    expect(acct.username).toBe("kallaway");
    expect(acct.followersCount).toBe(100);
  });

  test("an expired/revoked token surfaces as GRAPH_AUTH_FAILED with the token redacted", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid OAuth access token tok_secret", type: "OAuthException", code: 190 } }),
      })
    );
    const { graphClient } = await loadClient();
    const { GraphApiError } = await import("./errors");

    try {
      await graphClient.fetchAccount();
      throw new Error("expected fetchAccount to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphApiError);
      expect((err as InstanceType<typeof GraphApiError>).code).toBe("GRAPH_AUTH_FAILED");
      expect((err as Error).message).not.toContain("tok_secret");
    }
  });

  test("a network failure surfaces as GRAPH_NETWORK with the token redacted from the message", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: tok_secret leaked in a hypothetical message"))
    );
    const { graphClient } = await loadClient();

    try {
      await graphClient.fetchAccount();
      throw new Error("expected fetchAccount to throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("GRAPH_NETWORK");
      expect((err as Error).message).not.toContain("tok_secret");
    }
  });
});

describe("graphClient.fetchComments", () => {
  const MEDIA = (id: string, commentsCount: number) => ({ externalId: id, permalink: `https://www.instagram.com/p/${id}/`, commentsCount });

  test("uses the media list it is given (no second media call), classifies comments, and a media whose comments call fails makes the pull partial", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "c1", text: "so good", username: "a_fan", timestamp: "2026-07-01T01:00:00+0000" }] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const { graphClient } = await loadClient();
    const out = await graphClient.fetchComments("kallaway", [MEDIA("post_a", 1), MEDIA("post_b", 1), MEDIA("post_c", 0)]);

    expect(out).toMatchObject({ kind: "partial", missing: "post_b", reason: { code: "GRAPH_UNKNOWN" } });
    expect(calls()).toBe(2);
    const comments = out.kind === "partial" ? out.rows : [];
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ externalId: "c1", kind: "organic", author: "a_fan", permalink: "https://www.instagram.com/p/post_a/" });
    // post_c had commentsCount 0 and was never queried; no media list call was made.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0] as string).pathname).toMatch(/\/post_a\/comments$/);
  });
});

describe("graphClient.fetchComments, fatal per-media failure", () => {
  test("a rate limit on one media's comments stops the pull, returns what it had and counts every call", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "c1", text: "hi", username: "fan" }] }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) });
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const media = ["a", "b", "c"].map((id) => ({ externalId: `post_${id}`, permalink: `https://i/${id}`, commentsCount: 1 }));
    const out = await graphClient.fetchComments("kallaway", media);
    expect(out).toMatchObject({ kind: "partial", rows: [{ externalId: "c1" }], reason: { code: "GRAPH_RATE_LIMITED" } });
    expect(calls()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("graphClient.fetchAccountBreakdowns, fatal", () => {
  test("a rate limit on an audience call fails the audience pull with that stop and keeps the split, not a throw", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 3 }] }] } }] }) })
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out).toMatchObject({ split: { kind: "complete", rows: [{ key: "FOLLOWER" }] }, audience: { kind: "failed", reason: { code: "GRAPH_RATE_LIMITED" } } });
    expect(calls()).toBe(2);
  });
});

describe("graphClient.checkToken", () => {
  test("reports not_configured without making a network call, and never throws", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const status = await graphClient.checkToken();
    expect(status).toMatchObject({ configured: false, state: "not_configured", username: null, message: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reports ok with the resolved username on a working token", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1", username: "kallaway" }) }));
    const { graphClient } = await loadClient();
    const status = await graphClient.checkToken();
    expect(status).toMatchObject({ configured: true, state: "ok", username: "kallaway" });
  });

  test("reports auth_failed with the token redacted from the message, and never throws", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: "bad token tok_secret", type: "OAuthException" } }) })
    );
    const { graphClient } = await loadClient();
    const status = await graphClient.checkToken();
    expect(status.configured).toBe(true);
    expect(status.state).toBe("auth_failed");
    expect(status.message).not.toContain("tok_secret");
  });

  test("a permission refusal (code 10 or 200-299) reports permission_denied, never unknown", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    for (const code of [10, 200, 299]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code, type: "OAuthException" } }) }));
      const { graphClient } = await loadClient();
      expect((await graphClient.checkToken()).state).toBe("permission_denied");
    }
  });

  test("fetchAccount surfaces a permission refusal as GRAPH_PERMISSION_DENIED", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: 200 } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchAccount()).rejects.toMatchObject({ code: "GRAPH_PERMISSION_DENIED", errorClass: "auth" });
  });

  test("reports rate_limited on HTTP 429", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: "slow down" } }) }));
    const { graphClient } = await loadClient();
    const status = await graphClient.checkToken();
    expect(status.state).toBe("rate_limited");
  });

  test("reports network on a fetch rejection", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    const { graphClient } = await loadClient();
    const status = await graphClient.checkToken();
    expect(status.state).toBe("network");
  });
});

describe("SEC-05: the Settings token wins over .env.local", () => {
  test("fetchAccount and checkToken send the db secret, not the env value", async () => {
    process.env.IG_GRAPH_TOKEN = "env_token_A";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "1", username: "me" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { setSecret } = await import("@/server/secrets/store");
    setSecret("IG_GRAPH_TOKEN", "settings_token_B");
    await graphClient.fetchAccount();
    await graphClient.checkToken();
    for (const [url] of fetchMock.mock.calls) expect(new URL(url as string).searchParams.get("access_token")).toBe("settings_token_B");
  });
});

describe("shared Graph call ledger", () => {
  test("every HTTP call to Graph lands in one globalThis ledger: token check, account, publish poll, failures too", async () => {
    delete (globalThis as { __crowsnestOwnMeasure?: unknown }).__crowsnestOwnMeasure;
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "1", username: "k" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status_code: "FINISHED" }) }));
    const { graphClient, graphCallLedger, graphCallsInLastHour, pollReelContainer } = await loadClient();
    await graphClient.checkToken();
    await expect(graphClient.fetchAccount()).rejects.toThrow();
    await pollReelContainer("c1", { sleep: async () => {} });
    expect(graphCallLedger().total).toBe(3);
    expect(graphCallsInLastHour()).toBe(3);
    expect(graphCallsInLastHour(new Date(Date.now() + 3_600_001))).toBe(0);
    // A second copy of the module (tsx scheduler vs the Next bundle) reads the same ledger.
    vi.resetModules();
    expect((await import("./client")).graphCallLedger().total).toBe(3);
  });

  test("a restart mid-hour keeps the hour's count: 199 calls before, the 200th goes out, the 201st is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graph-budget-"));
    process.env.CROWSNEST_DB_PATH = join(dir, "crowsnest.db");
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "1", username: "k" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const boot = async () => {
      vi.resetModules();
      delete (globalThis as { __crowsnestOwnMeasure?: unknown }).__crowsnestOwnMeasure;
      (await import("@/server/db/test-migrate")).migrate();
      return import("./client");
    };
    try {
      const before = await boot();
      for (let i = 0; i < 199; i++) await before.graphClient.checkToken();
      const after = await boot();
      expect(after.graphCallsInLastHour()).toBe(199);
      expect((await after.graphClient.checkToken()).state).toBe("ok");
      expect(await after.graphClient.checkToken()).toMatchObject({ state: "rate_limited" });
      expect(fetchMock).toHaveBeenCalledTimes(200);
      expect(after.graphCallsInLastHour()).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
