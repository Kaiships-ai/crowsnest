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

beforeEach(() => {
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
      error: null,
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
      skipRate: 41.5, avgWatchTimeMs: 4500, totalWatchTimeMs: 900000, watchTimeSec: null, bioLinkTaps: null, error: null,
    });
  });
});

describe("mapBioLinkTaps", () => {
  const withActions = (results: unknown[]) => ({ data: [{ name: "profile_activity", total_value: { value: 0, breakdowns: [{ dimension_keys: ["action_type"], results }] } }] });
  test("takes the bio link action value", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }, { dimension_values: ["BIO_LINK_CLICKED"], value: 7 }]))).toBe(7);
  });
  test("is null when the bio link action is absent", async () => {
    const { mapBioLinkTaps } = await loadClient();
    expect(mapBioLinkTaps(withActions([{ dimension_values: ["CALL"], value: 2 }]))).toBeNull();
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

  test("ACTION-22: bio link taps from profile_activity by action_type, null when absent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(7)))
      .mockResolvedValueOnce(ok(metrics({ views: 10, reach: 8 }))).mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    expect((await graphClient.fetchPostInsights(REEL)).insights.bioLinkTaps).toBe(7);
    expect((await graphClient.fetchPostInsights(REEL)).insights.bioLinkTaps).toBeNull();
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
    const { insights, callsUsed } = await graphClient.fetchPostInsights(REEL);
    expect(insights).toMatchObject({ views: 120000, reach: 80997, shares: 1112, likes: 50, skipRate: null, reposts: null, bioLinkTaps: 3, error: null });
    expect(callsUsed).toBe(3);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("metric")).toContain("reels_skip_rate");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes,views");
  });

  test("a rate limit throws so the run can stop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { code: 4 } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchPostInsights(REEL)).rejects.toMatchObject({ code: "GRAPH_RATE_LIMITED" });
  });

  test("Meta's real envelope: a refused metric (code 100, type OAuthException) still falls back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 100, type: "OAuthException", message: "(#100) metric not supported" } }) })
      .mockResolvedValueOnce(ok(metrics({ views: 9, reach: 7 })))
      .mockResolvedValueOnce(ok(activity(null)));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { insights, callsUsed } = await graphClient.fetchPostInsights(REEL);
    expect(insights).toMatchObject({ views: 9, reach: 7, error: null });
    expect(callsUsed).toBe(3);
  });

  test("Meta's real envelope: a rate limit (code 4, type OAuthException) is rate_limited, not auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 4, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchPostInsights(REEL)).rejects.toMatchObject({ code: "GRAPH_RATE_LIMITED" });
  });

  test("a dead token (code 190) still ends the run as auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 190, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchPostInsights(REEL)).rejects.toMatchObject({ code: "GRAPH_AUTH_FAILED" });
  });

  test("a non-reel makes one core call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(metrics({ reach: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    const { graphClient } = await loadClient();
    const { insights, callsUsed } = await graphClient.fetchPostInsights({ ...REEL, productType: "FEED", format: "Carousel" });
    expect(callsUsed).toBe(1);
    expect(insights.reach).toBe(5);
    expect(insights.views).toBeNull();
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
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out.audienceError).toBeNull();
    expect(out.callsUsed).toBe(4);
    expect(out.rows).toContainEqual({ metric: "views", dimension: "follower_type", key: "NON_FOLLOWER", value: 700, timeframe: "day" });
    expect(out.rows).toContainEqual({ metric: "engaged_audience_demographics", dimension: "country", key: "US", value: 50, timeframe: "this_month" });
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    expect(first.searchParams.get("breakdown")).toBe("follower_type");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("metric")).toBe("engaged_audience_demographics");
  });

  test("a lack-of-volume refusal returns a threshold state, not an empty audience", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 10, message: "Not enough users" } }) }));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out.audienceError).toContain("Not enough users");
    expect(out.rows.every((r) => r.metric === "views")).toBe(true);
    expect(out.callsUsed).toBe(2);
  });

  test("the refusal in Meta's real envelope (code 10, type OAuthException) is a threshold, not a thrown auth failure", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(ok(results([["FOLLOWER", 3]])))
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { code: 10, type: "OAuthException", message: "Not enough users" } }) }));
    const { graphClient } = await loadClient();
    const out = await graphClient.fetchAccountBreakdowns();
    expect(out.audienceError).toContain("Not enough users");
    expect(out.rows).toHaveLength(1);
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
  test("classifies organic comments and skips a media whose own comments call fails", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "post_a", permalink: "https://www.instagram.com/p/a/", timestamp: "2026-07-01T00:00:00+0000", comments_count: 1 },
          { id: "post_b", permalink: "https://www.instagram.com/p/b/", timestamp: "2026-07-02T00:00:00+0000", comments_count: 1 },
          { id: "post_c", permalink: "https://www.instagram.com/p/c/", timestamp: "2026-07-03T00:00:00+0000", comments_count: 0 },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "c1", text: "so good", username: "a_fan", timestamp: "2026-07-01T01:00:00+0000" }] }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const { graphClient } = await loadClient();
    const comments = await graphClient.fetchComments("kallaway");

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ externalId: "c1", kind: "organic", author: "a_fan" });
    // post_c had comments_count: 0 and was never queried at all.
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
