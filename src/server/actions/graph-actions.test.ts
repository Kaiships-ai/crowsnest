import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { GraphAccount, GraphComment, GraphPost, GraphTokenStatus } from "../graph/client";
import { GraphApiError } from "../graph/errors";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  fetchPosts: vi.fn(),
  fetchComments: vi.fn(),
  checkToken: vi.fn(),
}));

// CLASSIFIER_VERSION is imported by graph-actions.ts directly, so the mock must supply
// it too, not just graphClient — same shape the real module exports.
vi.mock("../graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let measureOwnChannelAction: typeof import("./graph-actions")["measureOwnChannelAction"];
let checkGraphTokenAction: typeof import("./graph-actions")["checkGraphTokenAction"];
let OWN_COMMENTS_FETCH_ERROR_KEY: typeof import("@/server/queries/own-channel")["OWN_COMMENTS_FETCH_ERROR_KEY"];

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ measureOwnChannelAction, checkGraphTokenAction } = await import("./graph-actions"));
  ({ OWN_COMMENTS_FETCH_ERROR_KEY } = await import("@/server/queries/own-channel"));
});

beforeEach(async () => {
  migrate();
  await db.delete(tables.ownComments);
  await db.delete(tables.ownPostInsights);
  await db.delete(tables.ownPosts);
  await db.delete(tables.ownAccountSnapshots);
  await db.delete(tables.appSettings);
  vi.clearAllMocks();
});

const ACCOUNT: GraphAccount = { id: "acct1", username: "kallaway", followersCount: 1000, followsCount: 50, mediaCount: 10 };

function post(externalId: string, overrides: Partial<GraphPost["insights"]> = {}): GraphPost {
  return {
    externalId,
    permalink: `https://www.instagram.com/p/${externalId}/`,
    mediaType: "VIDEO",
    productType: "REELS",
    format: "Reel",
    caption: "a caption",
    postedAt: new Date().toISOString(),
    likeCount: 10,
    commentsCount: 1,
    thumbnailUrl: null,
    insights: {
      reach: 500,
      saved: 5,
      shares: 2,
      totalInteractions: 20,
      comments: 1,
      likes: 10,
      views: 800,
      profileVisits: null,
      followsFromPost: null,
      watchTimeSec: null,
      reposts: null,
      skipRate: null,
      avgWatchTimeMs: null,
      totalWatchTimeMs: null,
      bioLinkTaps: null,
      error: null,
      ...overrides,
    },
  };
}

describe("measureOwnChannelAction", () => {
  test("fails with the client's code when the token isn't configured, and writes nothing", async () => {
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_NOT_CONFIGURED", "no token"));

    const result = await measureOwnChannelAction();

    expect(result).toMatchObject({ ok: false, code: "GRAPH_NOT_CONFIGURED" });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(0);
  });

  test("a full success writes an account snapshot, one post row and one insights row per post, and comments", async () => {
    graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
    graphClient.fetchPosts.mockResolvedValue([post("p1"), post("p2")]);
    const comment: GraphComment = {
      externalId: "c1",
      permalink: "https://www.instagram.com/p/p1/",
      author: "a_fan",
      text: "great post",
      postedAt: new Date().toISOString(),
      kind: "organic",
    };
    graphClient.fetchComments.mockResolvedValue([comment]);

    const result = await measureOwnChannelAction();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.postsSeen).toBe(2);
    expect(result.postsMeasured).toBe(2);
    expect(result.postsFailed).toBe(0);
    expect(result.commentsSeen).toBe(1);
    expect(result.partial).toBe(false);

    const snapshots = await db.select().from(tables.ownAccountSnapshots);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ username: "kallaway", followerCount: 1000 });

    const posts = await db.select().from(tables.ownPosts);
    expect(posts).toHaveLength(2);

    const insights = await db.select().from(tables.ownPostInsights);
    expect(insights).toHaveLength(2);
    expect(insights.every((i) => i.reach === 500)).toBe(true);

    const comments = await db.select().from(tables.ownComments);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ kind: "organic", classifierVersion: "test-classifier-v1" });
  });

  test("a post whose insights call failed is still stored, with its error and null metrics", async () => {
    graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
    graphClient.fetchPosts.mockResolvedValue([post("ok"), post("broken", { reach: null, saved: null, shares: null, views: null, error: "insights call failed" })]);
    graphClient.fetchComments.mockResolvedValue([]);

    const result = await measureOwnChannelAction();
    if (!result.ok) throw new Error("expected ok");
    expect(result.postsMeasured).toBe(1);
    expect(result.postsFailed).toBe(1);

    const insights = await db.select().from(tables.ownPostInsights);
    const broken = insights.find((i) => i.fetchError !== null);
    expect(broken?.reach).toBeNull();
    expect(broken?.fetchError).toBe("insights call failed");
  });

  test("posts succeeding while comments fail is a partial success, not a failure — and records the comment error", async () => {
    graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
    graphClient.fetchPosts.mockResolvedValue([post("p1")]);
    graphClient.fetchComments.mockRejectedValue(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));

    const result = await measureOwnChannelAction();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.partial).toBe(true);
    expect(result.postsMeasured).toBe(1);

    // Stores the client's user-facing message (redacted, code-mapped), not the raw
    // upstream string — same as every other failure path in this module.
    const [setting] = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY));
    expect(setting.value).toContain("rate-limiting");
  });

  test("a successful comments pull clears a previously stored comment-pull error", async () => {
    await db.insert(tables.appSettings).values({ key: OWN_COMMENTS_FETCH_ERROR_KEY, value: "stale error" });
    graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
    graphClient.fetchPosts.mockResolvedValue([post("p1")]);
    graphClient.fetchComments.mockResolvedValue([]);

    await measureOwnChannelAction();

    const rows = await db.select().from(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY));
    expect(rows).toHaveLength(0);
  });

  test("re-measuring the same post updates it in place rather than duplicating it", async () => {
    graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
    graphClient.fetchPosts.mockResolvedValue([post("p1")]);
    graphClient.fetchComments.mockResolvedValue([]);

    await measureOwnChannelAction();
    await measureOwnChannelAction();

    const posts = await db.select().from(tables.ownPosts);
    expect(posts).toHaveLength(1);
    // Two runs, two insights rows — history is never overwritten.
    const insights = await db.select().from(tables.ownPostInsights);
    expect(insights).toHaveLength(2);
  });
});

describe("checkGraphTokenAction", () => {
  test("passes through a not_configured status as ok: true", async () => {
    const status: GraphTokenStatus = { configured: false, username: null, state: "not_configured", message: null, checkedAt: new Date().toISOString() };
    graphClient.checkToken.mockResolvedValue(status);

    const result = await checkGraphTokenAction();
    expect(result).toEqual({ ok: true, status });
  });

  test("passes through an auth_failed status as ok: true — the check itself succeeded", async () => {
    const status: GraphTokenStatus = { configured: true, username: null, state: "auth_failed", message: "token rejected", checkedAt: new Date().toISOString() };
    graphClient.checkToken.mockResolvedValue(status);

    const result = await checkGraphTokenAction();
    expect(result).toEqual({ ok: true, status });
  });
});
