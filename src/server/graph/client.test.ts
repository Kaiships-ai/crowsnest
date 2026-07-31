import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `./client` imports `../config`, which throws at module load if `IG_SERVICE_TOKEN` is
 * missing (unrelated to anything tested here, but it's the same process). Every test
 * below dynamically imports `./client` AFTER setting env vars for the case under test,
 * and `vi.resetModules()` in `beforeEach` forces `../config` to re-evaluate against the
 * current env each time — otherwise the Graph token state from one test would leak into
 * the next via Node's module cache.
 */

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.IG_SERVICE_TOKEN ??= "test-token-long-enough";
  delete process.env.IG_GRAPH_TOKEN;
  delete process.env.IG_GRAPH_USER_ID;
});

async function loadClient() {
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
      error: null,
    });
  });

  test("never carries a views figure for a non-reel, even if the API sent one", async () => {
    const { mapInsights } = await loadClient();
    expect(mapInsights(RAW, false).views).toBeNull();
  });

  test("unrequested metrics (profileVisits, followsFromPost, watchTimeSec) are always null", async () => {
    const { mapInsights } = await loadClient();
    const withExtra = { data: [...RAW.data, { name: "profile_visits", values: [{ value: 99 }] }] };
    // Even if a future API version started sending profile_visits, this port does not
    // read it — the contract's rule is that no tile ships until a metric name has been
    // verified against a live call, and this client has never made that call.
    expect(mapInsights(withExtra, true).profileVisits).toBeNull();
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

describe("graphClient.fetchPosts", () => {
  test("requests ,views only for a REELS post and isolates a per-post insights failure", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "post_reel",
            media_type: "VIDEO",
            media_product_type: "REELS",
            permalink: "https://www.instagram.com/reel/x/",
            timestamp: "2026-07-01T00:00:00+0000",
            like_count: 10,
            comments_count: 2,
            caption: "a reel",
          },
          {
            id: "post_carousel",
            media_type: "CAROUSEL_ALBUM",
            media_product_type: "FEED",
            permalink: "https://www.instagram.com/p/y/",
            timestamp: "2026-07-02T00:00:00+0000",
            like_count: 5,
            comments_count: 1,
            caption: "a carousel",
          },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { name: "reach", values: [{ value: 900 }] },
          { name: "views", values: [{ value: 1200 }] },
        ],
      }),
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: "internal error" } }) });
    vi.stubGlobal("fetch", fetchMock);

    const { graphClient } = await loadClient();
    const posts = await graphClient.fetchPosts();

    expect(posts).toHaveLength(2);
    const reel = posts.find((p) => p.externalId === "post_reel");
    expect(reel?.format).toBe("Reel");
    expect(reel?.insights.views).toBe(1200);
    expect(reel?.insights.reach).toBe(900);
    expect(reel?.insights.error).toBeNull();

    const carousel = posts.find((p) => p.externalId === "post_carousel");
    expect(carousel?.format).toBe("Carousel");
    // Rule 2: a per-post insights failure is a field on that post, never a thrown
    // error that would have taken the whole batch down with it.
    expect(carousel?.insights.error).not.toBeNull();
    expect(carousel?.insights.reach).toBeNull();

    const insightsCalls = fetchMock.mock.calls.slice(1);
    const reelUrl = new URL(insightsCalls[0][0] as string);
    expect(reelUrl.searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes,views");
    const carouselUrl = new URL(insightsCalls[1][0] as string);
    expect(carouselUrl.searchParams.get("metric")).toBe("reach,saved,shares,total_interactions,comments,likes");
  });

  test("the whole batch fails when the media list call itself fails", async () => {
    process.env.IG_GRAPH_TOKEN = "tok_secret";
    process.env.IG_GRAPH_USER_ID = "17841400000000000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { code: 190, type: "OAuthException" } }) }));
    const { graphClient } = await loadClient();
    await expect(graphClient.fetchPosts()).rejects.toMatchObject({ code: "GRAPH_AUTH_FAILED" });
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
