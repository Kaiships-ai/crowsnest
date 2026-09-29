import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphMedia, GraphPostInsights } from "@/server/graph/client";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(),
  fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn(),
}));
vi.mock("@/server/graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let svc: typeof import("./own-measure");

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  svc = await import("./own-measure");
});

const ACCOUNT = { id: "acct1", username: "kallaway", followersCount: 1000, followsCount: 50, mediaCount: 10 };
function media(id: string, o: Partial<GraphMedia> = {}): GraphMedia {
  return { externalId: id, permalink: `https://i/${id}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: id, postedAt: "2026-09-01T00:00:00.000Z", likeCount: null, commentsCount: 0, thumbnailUrl: `https://cdn/${id}.jpg`, ...o };
}
function insights(o: Partial<GraphPostInsights> = {}): GraphPostInsights {
  return { reach: 100, saved: 1, shares: 2, totalInteractions: 3, comments: 1, likes: 5, views: 200, profileVisits: 4, followsFromPost: 1, watchTimeSec: null, reposts: 1, skipRate: 40, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, bioLinkTaps: 2, error: null, ...o };
}

beforeEach(async () => {
  migrate();
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns, tables.appSettings]) await db.delete(t);
  vi.clearAllMocks();
  graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
  graphClient.fetchMedia.mockResolvedValue([]);
  graphClient.fetchPostInsights.mockResolvedValue({ insights: insights(), callsUsed: 2 });
  graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows: [], audienceError: null, callsUsed: 4 });
  graphClient.fetchComments.mockResolvedValue([]);
});

describe("measureOwnChannel, scope all", () => {
  test("writes a snapshot, upserts posts with thumbnails, one insight row each with the new columns", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1"), media("c1", { productType: "FEED", format: "Carousel" })]);
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsSeen: 2, postsMeasured: 2, postsFailed: 0, partial: false });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(1);
    const posts = await db.select().from(tables.ownPosts);
    expect(posts.find((p) => p.externalId === "r1")?.thumbnailUrl).toBe("https://cdn/r1.jpg");
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reposts: 1, skipRate: 40, bioLinkTaps: 2, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, profileVisits: 4, followsFromPost: 1 });
  });

  test("ACTION-13: the account call failing is a hard failure with no rows", async () => {
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(0);
    expect(await db.select().from(tables.ownPosts)).toHaveLength(0);
  });

  test("ACTION-12: comments failing after posts succeed is ok with partial and a stored error", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1", { commentsCount: 2 })]);
    graphClient.fetchComments.mockRejectedValue(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, partial: true, postsMeasured: 1 });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    const [err] = await db.select().from(tables.appSettings);
    expect(err.key).toBe("own_comments_fetch_error");
  });

  test("a per-post insights error is stored on the row and counted failed", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("r1")]);
    graphClient.fetchPostInsights.mockResolvedValue({ insights: insights({ reach: null, error: "HTTP 500" }), callsUsed: 2 });
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsFailed: 1, postsMeasured: 0 });
    const [row] = await db.select().from(tables.ownPostInsights);
    expect(row.fetchError).toBe("HTTP 500");
  });
});

describe("single-flight lock", () => {
  test("ACTION-28: a due run while another run is in flight returns busy without calling Graph", async () => {
    let release!: () => void;
    graphClient.fetchAccount.mockImplementationOnce(() => new Promise((res) => { release = () => res(ACCOUNT); }));
    const first = svc.measureOwnChannel({ scope: "due" });
    const second = await svc.measureOwnChannel({ scope: "due" });
    expect(second).toMatchObject({ ok: false, code: "MEASURE_BUSY" });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(1);
  });

  test("a manual run waits for the in-flight run instead of doubling calls", async () => {
    let release!: () => void;
    graphClient.fetchAccount.mockImplementationOnce(() => new Promise((res) => { release = () => res(ACCOUNT); }));
    const scheduled = svc.measureOwnChannel({ scope: "due" });
    const manual = svc.measureOwnChannel({ scope: "all" });
    await Promise.resolve();
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(1);
    release();
    await scheduled;
    expect(await manual).toMatchObject({ ok: true });
    expect(graphClient.fetchAccount).toHaveBeenCalledTimes(2);
  });
});
