import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphMedia, GraphPostInsights } from "@/server/graph/client";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(),
  fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn(),
}));
vi.mock("@/server/graph/client", async (importOriginal) => ({ ...(await importOriginal<object>()), graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));
const invalidateTokenStatus = vi.hoisted(() => vi.fn());
const rememberTokenStatus = vi.hoisted(() => vi.fn());
vi.mock("@/server/graph/token-status", () => ({ invalidateTokenStatus, rememberTokenStatus }));

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
  delete (globalThis as { __crowsnestOwnMeasure?: unknown }).__crowsnestOwnMeasure;
  migrate();
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns, tables.appSettings]) await db.delete(t);
  vi.clearAllMocks();
  graphClient.fetchAccount.mockResolvedValue(ACCOUNT);
  graphClient.fetchMedia.mockResolvedValue([]);
  graphClient.fetchPostInsights.mockResolvedValue({ insights: insights(), callsUsed: 2 });
  graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows: [], audienceError: null, callsUsed: 4 });
  graphClient.fetchComments.mockResolvedValue({ comments: [], callsUsed: 1, stop: null });
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

  test("a successful run refreshes the cached token status to ok with the account", async () => {
    expect(await svc.measureOwnChannel({ scope: "all", now: NOW })).toMatchObject({ ok: true });
    expect(rememberTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ configured: true, state: "ok", username: "kallaway" }));
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

describe("one lock per process", () => {
  test("a second copy of the module (tsx scheduler vs the Next bundle) sees the in-flight run", async () => {
    let release!: () => void;
    graphClient.fetchAccount.mockImplementationOnce(() => new Promise((res) => { release = () => res(ACCOUNT); }));
    const first = svc.measureOwnChannel({ scope: "due" });
    vi.resetModules();
    const other = await import("./own-measure");
    expect(await other.measureOwnChannel({ scope: "due" })).toMatchObject({ ok: false, code: "MEASURE_BUSY" });
    release();
    expect(await first).toMatchObject({ ok: true });
  });
});

const H = 3_600_000;
const NOW = new Date("2026-09-29T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

async function seedCapture(externalId: string, postedAt: string, capturedAt: string) {
  const id = `own-${externalId}`;
  await db.insert(tables.ownPosts).values({ id, externalId, permalink: `https://i/${externalId}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", postedAt, firstSeenAt: postedAt });
  await db.insert(tables.ownPostInsights).values({ id: `ins-${externalId}-${capturedAt}`, ownPostId: id, capturedAt, views: 1 });
}
const measuredIds = () => graphClient.fetchPostInsights.mock.calls.map(([m]) => (m as GraphMedia).externalId);

describe("isDue", () => {
  test("hourly inside 72 hours, daily after, always when never captured", () => {
    expect(svc.isDue(ago(2 * H), ago(61 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(71 * H), ago(61 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(2 * H), ago(30 * 60_000), NOW)).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), ago(23 * H), NOW)).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), null, NOW)).toBe(true);
  });

  test("five minutes of slack, so an hourly tick that lands a little early still measures", () => {
    expect(svc.isDue(ago(2 * H), ago(56 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(2 * H), ago(54 * 60_000), NOW)).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), ago(24 * H - 4 * 60_000), NOW)).toBe(true);
    expect(svc.isDue(ago(2 * H), null, NOW, { at: ago(56 * 60_000), count: 1, permanent: false })).toBe(true);
  });

  test("never measured with failures: an hour after the first transient failure, a day after a repeat or a permanent one", () => {
    const fail = (at: string, count: number, permanent = false) => ({ at, count, permanent });
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(30 * 60_000), 1))).toBe(false);
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(61 * 60_000), 1))).toBe(true);
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(2 * H), 2))).toBe(false);
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(25 * H), 2))).toBe(true);
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(2 * H), 1, true))).toBe(false);
  });
});

describe("measureOwnChannel, scope due", () => {
  test("ACTION-26: new reels hourly, the 5 day old reel only after a day", async () => {
    await seedCapture("new2h", ago(2 * H), ago(61 * 60_000));
    await seedCapture("new71h", ago(71 * H), ago(61 * 60_000));
    await seedCapture("old5d", ago(5 * 24 * H), ago(23 * H));
    graphClient.fetchMedia.mockResolvedValue([media("new2h", { postedAt: ago(2 * H) }), media("new71h", { postedAt: ago(71 * H) }), media("old5d", { postedAt: ago(5 * 24 * H) })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds().sort()).toEqual(["new2h", "new71h"]);
    graphClient.fetchPostInsights.mockClear();
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(measuredIds()).toContain("old5d");
  });

  test("a failed capture does not count as measured: the post is retried next tick", async () => {
    await seedCapture("young", ago(2 * H), ago(2 * H));
    await db.insert(tables.ownPostInsights).values({ id: "ins-young-failed", ownPostId: "own-young", capturedAt: ago(10 * 60_000), fetchError: "HTTP 500" });
    graphClient.fetchMedia.mockResolvedValue([media("young", { postedAt: ago(2 * H) })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds()).toEqual(["young"]);
  });

  async function seedFailures(externalId: string, postedAt: string, failures: [string, string][]) {
    const id = `own-${externalId}`;
    await db.insert(tables.ownPosts).values({ id, externalId, permalink: `https://i/${externalId}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", postedAt, firstSeenAt: postedAt });
    for (const [capturedAt, fetchError] of failures) await db.insert(tables.ownPostInsights).values({ id: `ins-${externalId}-${capturedAt}`, ownPostId: id, capturedAt, fetchError });
  }

  test("a never-measured post backs off after a failure: once after an hour, then daily", async () => {
    await seedFailures("once", ago(5 * 24 * H), [[ago(61 * 60_000), "HTTP 500: {}"]]);
    await seedFailures("twice", ago(5 * 24 * H), [[ago(3 * H), "HTTP 500: {}"], [ago(2 * H), "HTTP 500: {}"]]);
    await seedFailures("twiceOld", ago(5 * 24 * H), [[ago(26 * H), "HTTP 500: {}"], [ago(25 * H), "HTTP 500: {}"]]);
    await seedFailures("recent", ago(5 * 24 * H), [[ago(20 * 60_000), "HTTP 500: {}"]]);
    graphClient.fetchMedia.mockResolvedValue(["once", "twice", "twiceOld", "recent"].map((id) => media(id, { postedAt: ago(5 * 24 * H) })));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds().sort()).toEqual(["once", "twiceOld"]);
  });

  test("a post refused as an invalid request (code 100, pre-business post) waits a day from its first failure", async () => {
    const refused = 'HTTP 400: {"error":{"code":100,"message":"media posted before business account conversion"}}';
    await seedFailures("pre", ago(400 * 24 * H), [[ago(2 * H), refused]]);
    await seedFailures("preOld", ago(400 * 24 * H), [[ago(25 * H), refused]]);
    graphClient.fetchMedia.mockResolvedValue(["pre", "preOld"].map((id) => media(id, { postedAt: ago(400 * 24 * H) })));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds()).toEqual(["preOld"]);
  });

  test("ACTION-29: 250 due reels stay within the 150-call budget; leftovers are still due next hour", async () => {
    const list = Array.from({ length: 250 }, (_, i) => media(`r${i}`, { postedAt: ago(10 * 24 * H) }));
    graphClient.fetchMedia.mockResolvedValue(list);
    const first = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(first).toMatchObject({ ok: true, stoppedEarly: "budget" });
    if (!first.ok) throw new Error("unreachable");
    expect(first.callsUsed).toBeLessThanOrEqual(150);
    const measuredFirst = new Set(measuredIds());
    graphClient.fetchPostInsights.mockClear();
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    const measuredSecond = measuredIds();
    expect(measuredSecond.length).toBeGreaterThan(0);
    expect(measuredSecond.some((id) => measuredFirst.has(id))).toBe(false);
  });

  test("ACTION-30: a rate limit stops the run at once; earlier rows stay", async () => {
    graphClient.fetchMedia.mockResolvedValue(["a", "b", "c", "d", "e", "f"].map((id) => media(id)));
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 }).mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 }).mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 4 });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(5);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(4);
  });

  test("a rate limit on a reel's last call keeps that reel's row and stops the run", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a"), media("b")]);
    graphClient.fetchPostInsights.mockResolvedValueOnce({ insights: insights({ bioLinkTaps: null }), callsUsed: 2, stop: new GraphApiError("GRAPH_RATE_LIMITED", "slow down") });
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 1, callsUsed: 4 });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
  });

  test("ACTION-31: one reel throwing does not stop the others", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a"), media("b"), media("c")]);
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    const rows = await db.select({ fetchError: tables.ownPostInsights.fetchError }).from(tables.ownPostInsights);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.fetchError === "boom")).toHaveLength(1);
  });

  test("a thrown post stores a failed row, so it backs off instead of retrying every tick", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a")]);
    graphClient.fetchPostInsights.mockRejectedValueOnce(new Error("boom"));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    const [post] = await db.select().from(tables.ownPosts);
    expect(post.lastMeasuredAt).toBeNull();
  });

  test("the token disappearing mid-run stops the run cleanly instead of failing every post", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a"), media("b"), media("c")]);
    graphClient.fetchPostInsights.mockRejectedValue(new GraphApiError("GRAPH_NOT_CONFIGURED", "no token"));
    expect(await svc.measureOwnChannel({ scope: "due", now: NOW })).toMatchObject({ ok: false, code: "GRAPH_NOT_CONFIGURED" });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(0);
  });

  test("a per-post insights error does not bump own_posts.last_measured_at", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a")]);
    graphClient.fetchPostInsights.mockResolvedValue({ insights: insights({ reach: null, error: "HTTP 400: nope" }), callsUsed: 2 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    const [post] = await db.select().from(tables.ownPosts);
    expect(post.lastMeasuredAt).toBeNull();
  });

  test("every listed post is stored even when the run stops early; a thrown post counts failed", async () => {
    graphClient.fetchMedia.mockResolvedValue(["a", "b", "c", "d"].map((id) => media(id)));
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 1, postsFailed: 1 });
    expect((await db.select().from(tables.ownPosts)).map((p) => p.externalId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(2);
  });

  test("an auth failure mid-run is a failure with its code; rows already written stay", async () => {
    graphClient.fetchMedia.mockResolvedValue(["a", "b", "c"].map((id) => media(id, { commentsCount: 1 })));
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockRejectedValueOnce(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(graphClient.fetchComments).not.toHaveBeenCalled();
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("a permission refusal on a post's core insights fails the run as GRAPH_PERMISSION_DENIED, keeps rows, and caches the permission state", async () => {
    graphClient.fetchMedia.mockResolvedValue(["a", "b", "c"].map((id) => media(id)));
    graphClient.fetchPostInsights
      .mockResolvedValueOnce({ insights: insights(), callsUsed: 2 })
      .mockResolvedValueOnce({ insights: null, callsUsed: 2, stop: new GraphApiError("GRAPH_PERMISSION_DENIED", "HTTP 403") });
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_PERMISSION_DENIED" });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(2);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(rememberTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ configured: true, state: "permission_denied" }));
  });

  test("ACTION-32: each run appends a snapshot row, never overwrites", async () => {
    await seedCapture("a", ago(2 * H), ago(2 * H));
    graphClient.fetchMedia.mockResolvedValue([media("a", { postedAt: ago(2 * H) })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.capturedAt)).size).toBe(3);
  });
});

describe("comments", () => {
  test("Measure now on 50 reels with comments still fetches comments and clears a stored skip", async () => {
    await db.insert(tables.appSettings).values({ key: "own_comments_fetch_error", value: "Comments skipped" });
    graphClient.fetchMedia.mockResolvedValue(Array.from({ length: 50 }, (_, i) => media(`r${i}`, { commentsCount: 1 })));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(graphClient.fetchComments).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, partial: false, stoppedEarly: null, postsMeasured: 50 });
    if (!r.ok) throw new Error("unreachable");
    expect(r.callsUsed).toBeLessThanOrEqual(190);
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_comments_fetch_error")).toBe(false);
  });

  test("comments reuse the run's media list and reserve only one call per post with comments", async () => {
    // 72 reels, 2 with comments: 2 + 72 * 2 + 2 = 148 fits the 150 scheduled budget
    // only when no extra media list call is reserved.
    const list = Array.from({ length: 72 }, (_, i) => media(`r${i}`, { commentsCount: i < 2 ? 1 : 0 }));
    graphClient.fetchMedia.mockResolvedValue(list);
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: null, postsMeasured: 72 });
    expect(graphClient.fetchComments).toHaveBeenCalledWith("kallaway", list);
  });

  test("scheduled runs refresh comments at most once a day", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a", { commentsCount: 2 })]);
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(graphClient.fetchComments).toHaveBeenCalledTimes(1);
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    expect(graphClient.fetchComments).toHaveBeenCalledTimes(1);
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(graphClient.fetchComments).toHaveBeenCalledTimes(2);
  });
});

describe("Measure now budget", () => {
  test("uses the 190-call manual budget, reserving only the calls a post actually needs", async () => {
    // 60 reels with comments: 2 + 60 * 2 + 60 = 182 calls, over the scheduled 150 but under 190.
    graphClient.fetchMedia.mockResolvedValue(Array.from({ length: 60 }, (_, i) => media(`r${i}`, { commentsCount: 1 })));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, postsMeasured: 60, stoppedEarly: null, partial: false });
    if (!r.ok) throw new Error("unreachable");
    expect(r.callsUsed).toBeLessThanOrEqual(svc.OWN_MEASURE_MANUAL_CALL_BUDGET);
    expect(svc.OWN_MEASURE_MANUAL_CALL_BUDGET).toBeLessThan(200);
  });
});

describe("shared hourly call ledger", () => {
  test("a run's budget shrinks by the Graph calls already spent this hour, and says so", async () => {
    graphClient.fetchMedia.mockResolvedValue(Array.from({ length: 90 }, (_, i) => media(`r${i}`)));
    const first = await svc.measureOwnChannel({ scope: "all", now: NOW });
    if (!first.ok) throw new Error("unreachable");
    graphClient.fetchMedia.mockResolvedValue(Array.from({ length: 10 }, (_, i) => media(`s${i}`)));
    const second = await svc.measureOwnChannel({ scope: "all", now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(second).toMatchObject({ ok: true, stoppedEarly: "budget", limitedByRecentCalls: true });
    if (!second.ok) throw new Error("unreachable");
    expect(first.callsUsed + second.callsUsed).toBeLessThanOrEqual(200 - 10);
    const third = await svc.measureOwnChannel({ scope: "all", now: new Date(NOW.getTime() + 71 * 60_000) });
    expect(third).toMatchObject({ ok: true, stoppedEarly: null, limitedByRecentCalls: false });
  });
});

describe("fatal failures after the post loop", () => {
  test("an auth failure while pulling comments fails the run with its code; rows stay", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a", { commentsCount: 1 })]);
    graphClient.fetchComments.mockResolvedValue({ comments: [], callsUsed: 2, stop: new GraphApiError("GRAPH_AUTH_FAILED", "bad token") });
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("a rate limit while pulling comments stops the run: rate_limited, no breakdown calls, calls counted", async () => {
    graphClient.fetchMedia.mockResolvedValue([media("a", { commentsCount: 1 }), media("b", { commentsCount: 1 })]);
    graphClient.fetchComments.mockResolvedValue({ comments: [], callsUsed: 2, stop: new GraphApiError("GRAPH_RATE_LIMITED", "slow down") });
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, partial: true, stoppedEarly: "rate_limited", callsUsed: 2 + 4 + 2 });
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("an auth failure on the breakdowns fails the run with its code and drops the cached token status", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows: [], audienceError: null, callsUsed: 1, stop: new GraphApiError("GRAPH_AUTH_FAILED", "bad token") });
    expect(await svc.measureOwnChannel({ scope: "due", now: NOW })).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(invalidateTokenStatus).toHaveBeenCalled();
  });

  test("a rate limit on the breakdowns is stoppedEarly rate_limited, rows fetched so far kept, calls counted", async () => {
    const split = { metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 30, timeframe: "day" };
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows: [split], audienceError: null, callsUsed: 2, stop: new GraphApiError("GRAPH_RATE_LIMITED", "slow down") });
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", callsUsed: 2 + 2 });
    expect(await db.select().from(tables.ownAccountBreakdowns)).toHaveLength(1);
  });
});

describe("account breakdowns", () => {
  const rows = [
    { metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 30, timeframe: "day" },
    { metric: "engaged_audience_demographics", dimension: "age", key: "25-34", value: 40, timeframe: "this_month" },
  ];
  test("writes a batch once a day and stores a refusal in app_settings", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows, audienceError: "HTTP 400: not enough users", callsUsed: 2 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(await db.select().from(tables.ownAccountBreakdowns)).toHaveLength(2);
    const settings = await db.select().from(tables.appSettings);
    expect(settings.find((s) => s.key === "own_audience_fetch_error")?.value).toContain("not enough users");
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(1);
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(2);
  });
  test("a follower split failure is stored, and cleared by the next good split", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValueOnce({ rows: [], audienceError: null, splitError: "HTTP 400: bad", callsUsed: 4 });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect((await db.select().from(tables.appSettings)).find((s) => s.key === "own_follower_split_fetch_error")?.value).toBe("HTTP 400: bad");
    graphClient.fetchAccountBreakdowns.mockResolvedValueOnce({ rows, audienceError: null, splitError: null, callsUsed: 4 });
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_follower_split_fetch_error")).toBe(false);
  });

  test("a successful fetch clears a stored refusal", async () => {
    graphClient.fetchAccountBreakdowns.mockResolvedValue({ rows, audienceError: null, callsUsed: 4 });
    await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "old" });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_audience_fetch_error")).toBe(false);
  });
});
