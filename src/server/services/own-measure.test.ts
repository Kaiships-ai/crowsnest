import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { GraphMedia, GraphPostInsights } from "@/server/graph/client";
import { GraphApiError } from "@/server/graph/errors";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(), fetchMedia: vi.fn(), fetchPostInsights: vi.fn(),
  fetchAccountBreakdowns: vi.fn(), fetchComments: vi.fn(), checkToken: vi.fn(),
}));
vi.mock("@/server/graph/client", async (importOriginal) => ({ ...(await importOriginal<object>()), graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));
const rememberTokenStatus = vi.hoisted(() => vi.fn());
vi.mock("@/server/graph/token-status", () => ({ rememberTokenStatus }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let svc: typeof import("./own-measure");
// Captured once: a later test resets modules, and a fresh import would be a different logger.
let log: typeof import("@/server/lib/logger")["log"];
let trySpendCall: typeof import("@/server/lib/call-budget")["trySpendCall"];
let hourFreesAt: typeof import("@/server/lib/call-budget")["hourFreesAt"];
let graphActions: typeof import("@/server/actions/graph-actions");
let status: typeof import("./connector-status");

beforeAll(async () => {
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  svc = await import("./own-measure");
  ({ log } = await import("@/server/lib/logger"));
  ({ trySpendCall, hourFreesAt } = await import("@/server/lib/call-budget"));
  graphActions = await import("@/server/actions/graph-actions");
  status = await import("./connector-status");
});

const ACCOUNT = { id: "acct1", username: "kallaway", followersCount: 1000, followsCount: 50, mediaCount: 10 };
function media(id: string, o: Partial<GraphMedia> = {}): GraphMedia {
  return { externalId: id, permalink: `https://i/${id}`, mediaType: "VIDEO", productType: "REELS", format: "Reel", caption: id, postedAt: "2026-09-01T00:00:00.000Z", likeCount: null, commentsCount: 0, thumbnailUrl: `https://cdn/${id}.jpg`, ...o };
}
function insights(o: Partial<GraphPostInsights> = {}): GraphPostInsights {
  return { reach: 100, saved: 1, shares: 2, totalInteractions: 3, comments: 1, likes: 5, views: 200, profileVisits: 4, followsFromPost: 1, watchTimeSec: null, reposts: 1, skipRate: 40, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, bioLinkTaps: 2, ...o };
}

const complete = <T>(rows: T) => ({ kind: "complete" as const, rows });
const failed = (reason: GraphApiError) => ({ kind: "failed" as const, reason });
const refused = (message: string) => failed(new GraphApiError("GRAPH_UNKNOWN", message));
const insightsFailed = (error: GraphApiError, endsRun: boolean) => ({ kind: "failed" as const, reason: { error, endsRun } });

/** A mocked client call that spends n Graph calls, as the real transport would count them. */
function spend<T>(n: number, value: T) {
  return async () => {
    (await import("@/server/graph/client")).graphCallLedger().total += n;
    for (let i = 0; i < n; i++) trySpendCall("instagram-graph", Infinity, new Date());
    return value;
  };
}

afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  // The ledger stamps Date.now(); pin it to the tests' NOW so each run's own now lines up.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete (globalThis as { __crowsnestOwnMeasure?: unknown }).__crowsnestOwnMeasure;
  migrate();
  for (const t of [tables.ownComments, tables.ownPostInsights, tables.ownPosts, tables.ownAccountSnapshots, tables.ownAccountBreakdowns, tables.appSettings, tables.sourceCalls]) await db.delete(t);
  vi.clearAllMocks();
  graphClient.fetchAccount.mockImplementation(spend(1, ACCOUNT));
  graphClient.fetchMedia.mockImplementation(spend(1, []));
  graphClient.fetchPostInsights.mockImplementation(spend(2, complete(insights())));
  graphClient.fetchAccountBreakdowns.mockImplementation(spend(4, { split: complete([]), audience: complete([]) }));
  graphClient.fetchComments.mockImplementation(spend(1, complete([])));
});

describe("measureOwnChannel, scope all", () => {
  test("writes a snapshot, upserts posts with thumbnails, one insight row each with the new columns", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1"), media("c1", { productType: "FEED", format: "Carousel" })]));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsSeen: 2, postsMeasured: 2, postsFailed: 0, partial: false });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(1);
    const posts = await db.select().from(tables.ownPosts);
    expect(posts.find((p) => p.externalId === "r1")?.thumbnailUrl).toBe("https://cdn/r1.jpg");
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reposts: 1, skipRate: 40, bioLinkTaps: 2, avgWatchTimeMs: 4500, totalWatchTimeMs: 90000, profileVisits: 4, followsFromPost: 1 });
  });

  test("a run that measured a post's insights refreshes the cached token status to ok with the account", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1")]));
    expect(await svc.measureOwnChannel({ scope: "all", now: NOW })).toMatchObject({ ok: true });
    expect(rememberTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ configured: true, state: "ok", username: "kallaway" }));
  });

  test("a run with no successful insights call keeps a remembered permission refusal", async () => {
    expect(await svc.measureOwnChannel({ scope: "all", now: NOW })).toMatchObject({ ok: true, postsMeasured: 0 });
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1")]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, insightsFailed(new GraphApiError("GRAPH_UNKNOWN", "HTTP 400: nope"), false)));
    expect(await svc.measureOwnChannel({ scope: "all", now: NOW })).toMatchObject({ ok: true, postsMeasured: 0 });
    expect(rememberTokenStatus).not.toHaveBeenCalled();
  });

  test("ACTION-13: the account call failing is a hard failure with no rows", async () => {
    graphClient.fetchAccount.mockRejectedValue(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(0);
    expect(await db.select().from(tables.ownPosts)).toHaveLength(0);
  });

  test("ACTION-12: comments failing after posts succeed is ok with partial and a stored error", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1", { commentsCount: 2 })]));
    graphClient.fetchComments.mockRejectedValue(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, partial: true, postsMeasured: 1 });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    const [err] = await db.select().from(tables.appSettings);
    expect(err.key).toBe("own_comments_fetch_error");
  });

  test("a per-post insights error is stored on the row and counted failed", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1")]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, insightsFailed(new GraphApiError("GRAPH_UNKNOWN", "HTTP 500"), false)));
    const r = await svc.measureOwnChannel({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsFailed: 1, postsMeasured: 0 });
    const [row] = await db.select().from(tables.ownPostInsights);
    expect(row.fetchError).toBe("HTTP 500");
  });
});

describe("a partial capture never reaches the posts table", () => {
  test("a new reel whose first capture is partial shows its error and no numbers", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1")]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, { kind: "partial", rows: insights(), missing: "bio link taps", reason: { error: new GraphApiError("GRAPH_INVALID_REQUEST", "HTTP 400: refused"), endsRun: false } }));
    expect(await svc.measureOwnChannel({ scope: "all", now: NOW })).toMatchObject({ ok: true, postsMeasured: 0, postsFailed: 1 });
    const { getPostsWithLatestInsights } = await import("@/server/queries/own-channel");
    const [post] = await getPostsWithLatestInsights();
    expect(post).toMatchObject({ externalId: "r1", latestOk: null, reach: null, views: null, likes: null, saved: null, measuredAt: NOW.toISOString() });
    expect(post.insightsError).toContain("partial, missing bio link taps");
  });

  test("a failed row with numbers in it (written before this rule) still shows no numbers", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("r1")]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, insightsFailed(new GraphApiError("GRAPH_UNKNOWN", "HTTP 500"), false)));
    await svc.measureOwnChannel({ scope: "all", now: NOW });
    await db.update(tables.ownPostInsights).set({ reach: 999, views: 999 });
    const { getPostsWithLatestInsights } = await import("@/server/queries/own-channel");
    const [post] = await getPostsWithLatestInsights();
    expect(post).toMatchObject({ reach: null, views: null, insightsError: "HTTP 500" });
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
    expect(svc.isDue(ago(5 * 24 * H), null, NOW, fail(ago(2 * H), 2))).toBe(false);
    expect(svc.isDue(ago(5 * 24 * H), null, NOW, fail(ago(25 * H), 2))).toBe(true);
    expect(svc.isDue(ago(2 * H), null, NOW, fail(ago(2 * H), 1, true))).toBe(false);
  });

  test("a reel inside 72 hours never backs off below hourly on transient failures, only on a permanent one", () => {
    const fail = (at: string, count: number, permanent = false) => ({ at, count, permanent });
    expect(svc.isDue(ago(10 * H), null, NOW, fail(ago(61 * 60_000), 5))).toBe(true);
    expect(svc.isDue(ago(10 * H), ago(5 * H), NOW, fail(ago(61 * 60_000), 3))).toBe(true);
    expect(svc.isDue(ago(10 * H), ago(5 * H), NOW, fail(ago(30 * 60_000), 3))).toBe(false);
    expect(svc.isDue(ago(10 * H), null, NOW, fail(ago(2 * H), 1, true))).toBe(false);
  });

  test("a post with an old successful capture that now fails backs off from its failures since then", () => {
    const fail = (at: string, count: number) => ({ at, count, permanent: false });
    expect(svc.isDue(ago(10 * 24 * H), ago(3 * 24 * H), NOW, fail(ago(2 * H), 2))).toBe(false);
    expect(svc.isDue(ago(10 * 24 * H), ago(3 * 24 * H), NOW, fail(ago(25 * H), 2))).toBe(true);
    expect(svc.isDue(ago(10 * 24 * H), ago(3 * 24 * H), NOW, fail(ago(61 * 60_000), 1))).toBe(true);
  });
});

describe("measureOwnChannel, scope due", () => {
  test("ACTION-26: new reels hourly, the 5 day old reel only after a day", async () => {
    await seedCapture("new2h", ago(2 * H), ago(61 * 60_000));
    await seedCapture("new71h", ago(71 * H), ago(61 * 60_000));
    await seedCapture("old5d", ago(5 * 24 * H), ago(23 * H));
    graphClient.fetchMedia.mockImplementation(spend(1, [media("new2h", { postedAt: ago(2 * H) }), media("new71h", { postedAt: ago(71 * H) }), media("old5d", { postedAt: ago(5 * 24 * H) })]));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds().sort()).toEqual(["new2h", "new71h"]);
    graphClient.fetchPostInsights.mockClear();
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(measuredIds()).toContain("old5d");
  });

  test("a failed capture does not count as measured: the post is retried next tick", async () => {
    await seedCapture("young", ago(2 * H), ago(2 * H));
    await db.insert(tables.ownPostInsights).values({ id: "ins-young-failed", ownPostId: "own-young", capturedAt: ago(61 * 60_000), fetchError: "HTTP 500" });
    graphClient.fetchMedia.mockImplementation(spend(1, [media("young", { postedAt: ago(2 * H) })]));
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
    graphClient.fetchMedia.mockImplementation(spend(1, ["once", "twice", "twiceOld", "recent"].map((id) => media(id, { postedAt: ago(5 * 24 * H) }))));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds().sort()).toEqual(["once", "twiceOld"]);
  });

  test("failures after a success back an old post off daily; a new reel failing on code 10 stays hourly", async () => {
    const tooFew = 'HTTP 400: {"error":{"code":10,"message":"Not enough viewers for the media to show insights"}}';
    await seedCapture("oldOk", ago(10 * 24 * H), ago(3 * 24 * H));
    await db.insert(tables.ownPostInsights).values([
      { id: "f1", ownPostId: "own-oldOk", capturedAt: ago(3 * H), fetchError: "HTTP 500: {}" },
      { id: "f2", ownPostId: "own-oldOk", capturedAt: ago(2 * H), fetchError: "HTTP 500: {}" },
    ]);
    await seedFailures("fresh", ago(10 * H), [[ago(3 * H), tooFew], [ago(2 * H), tooFew], [ago(61 * 60_000), tooFew]]);
    graphClient.fetchMedia.mockImplementation(spend(1, [media("oldOk", { postedAt: ago(10 * 24 * H) }), media("fresh", { postedAt: ago(10 * H) })]));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds()).toEqual(["fresh"]);
  });

  test("a post refused as an invalid request (code 100, pre-business post) waits a day from its first failure", async () => {
    const refused = 'HTTP 400: {"error":{"code":100,"message":"media posted before business account conversion"}}';
    await seedFailures("pre", ago(400 * 24 * H), [[ago(2 * H), refused]]);
    await seedFailures("preOld", ago(400 * 24 * H), [[ago(25 * H), refused]]);
    graphClient.fetchMedia.mockImplementation(spend(1, ["pre", "preOld"].map((id) => media(id, { postedAt: ago(400 * 24 * H) }))));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(measuredIds()).toEqual(["preOld"]);
  });

  test("ACTION-29: 250 due reels stay within the 150-call budget; leftovers are still due next hour", async () => {
    const list = Array.from({ length: 250 }, (_, i) => media(`r${i}`, { postedAt: ago(10 * 24 * H) }));
    graphClient.fetchMedia.mockImplementation(spend(1, list));
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
    graphClient.fetchMedia.mockImplementation(spend(1, ["a", "b", "c", "d", "e", "f"].map((id) => media(id))));
    graphClient.fetchPostInsights
      .mockImplementationOnce(spend(2, complete(insights()))).mockImplementationOnce(spend(2, complete(insights())))
      .mockImplementationOnce(spend(2, complete(insights()))).mockImplementationOnce(spend(2, complete(insights())))
      .mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 4 });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(5);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(4);
  });

  test("a rate limit on a reel's last call stores that partial capture as failed, with no numbers, and stops the run", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a"), media("b")]));
    graphClient.fetchPostInsights.mockImplementationOnce(spend(2, { kind: "partial", rows: insights({ bioLinkTaps: null }), missing: "bio link taps", reason: { error: new GraphApiError("GRAPH_RATE_LIMITED", "slow down"), endsRun: true } }));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 0, postsFailed: 1, callsUsed: 4 });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(tables.ownPostInsights);
    expect(rows).toEqual([expect.objectContaining({ reach: null, views: null, fetchError: "partial, missing bio link taps: slow down" })]);
    const [post] = await db.select().from(tables.ownPosts).where(eq(tables.ownPosts.externalId, "a"));
    expect(post.lastMeasuredAt).toBeNull();
  });

  test("ACTION-31: one reel throwing does not stop the others", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a"), media("b"), media("c")]));
    graphClient.fetchPostInsights
      .mockImplementationOnce(spend(2, complete(insights())))
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce(spend(2, complete(insights())));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    const rows = await db.select({ fetchError: tables.ownPostInsights.fetchError }).from(tables.ownPostInsights);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.fetchError === "boom")).toHaveLength(1);
  });

  test("a thrown post stores a failed row, so it backs off instead of retrying every tick", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a")]));
    graphClient.fetchPostInsights.mockRejectedValueOnce(new Error("boom"));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    const [post] = await db.select().from(tables.ownPosts);
    expect(post.lastMeasuredAt).toBeNull();
  });

  test("the token disappearing mid-run stops the run cleanly instead of failing every post", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a"), media("b"), media("c")]));
    graphClient.fetchPostInsights.mockRejectedValue(new GraphApiError("GRAPH_NOT_CONFIGURED", "no token"));
    expect(await svc.measureOwnChannel({ scope: "due", now: NOW })).toMatchObject({ ok: false, code: "GRAPH_NOT_CONFIGURED" });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(1);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(0);
  });

  test("a per-post insights error does not bump own_posts.last_measured_at", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a")]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, insightsFailed(new GraphApiError("GRAPH_UNKNOWN", "HTTP 400: nope"), false)));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    const [post] = await db.select().from(tables.ownPosts);
    expect(post.lastMeasuredAt).toBeNull();
  });

  test("every listed post is stored even when the run stops early; a thrown post counts failed", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, ["a", "b", "c", "d"].map((id) => media(id))));
    graphClient.fetchPostInsights
      .mockImplementationOnce(spend(2, complete(insights())))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 1, postsFailed: 1 });
    expect((await db.select().from(tables.ownPosts)).map((p) => p.externalId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(2);
  });

  test("an auth failure mid-run is a failure with its code; rows already written stay", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, ["a", "b", "c"].map((id) => media(id, { commentsCount: 1 }))));
    graphClient.fetchPostInsights
      .mockImplementationOnce(spend(2, complete(insights())))
      .mockRejectedValueOnce(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(graphClient.fetchComments).not.toHaveBeenCalled();
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("a permission refusal on a post's core insights fails the run as GRAPH_PERMISSION_DENIED, keeps rows, and caches the permission state", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, ["a", "b", "c"].map((id) => media(id))));
    graphClient.fetchPostInsights
      .mockImplementationOnce(spend(2, complete(insights())))
      .mockImplementationOnce(spend(2, insightsFailed(new GraphApiError("GRAPH_PERMISSION_DENIED", "HTTP 403"), true)));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_PERMISSION_DENIED" });
    expect(graphClient.fetchPostInsights).toHaveBeenCalledTimes(2);
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(rememberTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ configured: true, state: "permission_denied" }));
  });

  test("ACTION-32: each run appends a snapshot row, never overwrites", async () => {
    await seedCapture("a", ago(2 * H), ago(2 * H));
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { postedAt: ago(2 * H) })]));
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
    graphClient.fetchMedia.mockImplementation(spend(1, Array.from({ length: 50 }, (_, i) => media(`r${i}`, { commentsCount: 1 }))));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(graphClient.fetchComments).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, partial: false, stoppedEarly: null, postsMeasured: 50 });
    if (!r.ok) throw new Error("unreachable");
    expect(r.callsUsed).toBeLessThanOrEqual(190);
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_comments_fetch_error")).toBe(false);
  });

  test("comments skipped by a rate limit say so, not that the budget was spent", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { commentsCount: 1 })]));
    graphClient.fetchPostInsights.mockImplementation(spend(2, { kind: "partial", rows: insights(), missing: "bio link taps", reason: { error: new GraphApiError("GRAPH_RATE_LIMITED", "slow down"), endsRun: true } }));
    await svc.measureOwnChannel({ scope: "all", now: NOW });
    const skip = (await db.select().from(tables.appSettings)).find((s) => s.key === "own_comments_fetch_error")?.value;
    expect(skip).toMatch(/rate limit/i);
    expect(skip).not.toMatch(/budget/i);
  });

  test("comments skipped by earlier runs' calls this hour name that cause", async () => {
    // 2 + 90 * 2 + 1 + 4 = 187 calls leaves 200 - 187 - 10 = 3: account, media and one feed post.
    graphClient.fetchMedia.mockImplementation(spend(1, [...Array.from({ length: 90 }, (_, i) => media(`r${i}`)), media("f", { productType: "FEED" })]));
    graphClient.fetchPostInsights.mockImplementation(async (m: GraphMedia) => spend(m.productType === "REELS" ? 2 : 1, complete(insights()))());
    await svc.measureOwnChannel({ scope: "all", now: NOW });
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { commentsCount: 1 }), media("b", { commentsCount: 1 })]));
    await svc.measureOwnChannel({ scope: "all", now: new Date(NOW.getTime() + 10 * 60_000) });
    const skip = (await db.select().from(tables.appSettings)).find((s) => s.key === "own_comments_fetch_error")?.value;
    expect(skip).toMatch(/last hour/i);
  });

  test("comments that cannot fit the budget reserve nothing: posts are measured first, comments skipped with the cause", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, Array.from({ length: 12 }, (_, i) => media(`r${i}`, { commentsCount: 1 }))));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW, budget: 10 });
    expect(r).toMatchObject({ ok: true, postsMeasured: 4, partial: true, stoppedEarly: "budget", callsUsed: 10 });
    expect(graphClient.fetchComments).not.toHaveBeenCalled();
    const skip = (await db.select().from(tables.appSettings)).find((s) => s.key === "own_comments_fetch_error")?.value;
    expect(skip).toMatch(/budget was spent/);
  });

  test("comments reuse the run's media list and reserve only one call per post with comments", async () => {
    // 72 reels, 2 with comments: 2 + 72 * 2 + 2 = 148 fits the 150 scheduled budget
    // only when no extra media list call is reserved.
    const list = Array.from({ length: 72 }, (_, i) => media(`r${i}`, { commentsCount: i < 2 ? 1 : 0 }));
    graphClient.fetchMedia.mockImplementation(spend(1, list));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: null, postsMeasured: 72 });
    expect(graphClient.fetchComments).toHaveBeenCalledWith("kallaway", list);
  });

  test("scheduled runs refresh comments at most once a day", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { commentsCount: 2 })]));
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
    graphClient.fetchMedia.mockImplementation(spend(1, Array.from({ length: 60 }, (_, i) => media(`r${i}`, { commentsCount: 1 }))));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, postsMeasured: 60, stoppedEarly: null, partial: false });
    if (!r.ok) throw new Error("unreachable");
    expect(r.callsUsed).toBeLessThanOrEqual(svc.OWN_MEASURE_MANUAL_CALL_BUDGET);
    expect(svc.OWN_MEASURE_MANUAL_CALL_BUDGET).toBeLessThan(200);
  });
});

describe("shared hourly call ledger", () => {
  test("a run's budget shrinks by the Graph calls already spent this hour, and says so", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, Array.from({ length: 90 }, (_, i) => media(`r${i}`))));
    const first = await svc.measureOwnChannel({ scope: "all", now: NOW });
    if (!first.ok) throw new Error("unreachable");
    graphClient.fetchMedia.mockImplementation(spend(1, Array.from({ length: 10 }, (_, i) => media(`s${i}`))));
    const second = await svc.measureOwnChannel({ scope: "all", now: new Date(NOW.getTime() + 10 * 60_000) });
    expect(second).toMatchObject({ ok: true, stoppedEarly: "budget", limitedByRecentCalls: true });
    if (!second.ok) throw new Error("unreachable");
    expect(first.callsUsed + second.callsUsed).toBeLessThanOrEqual(200 - 10);
    const third = await svc.measureOwnChannel({ scope: "all", now: new Date(NOW.getTime() + 71 * 60_000) });
    expect(third).toMatchObject({ ok: true, stoppedEarly: null, limitedByRecentCalls: false });
  });
});

describe("calls outside a measurement", () => {
  test("Graph calls a publish or token check made this hour shrink the run's budget, and never count as the run's own", async () => {
    await spend(187, null)();
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a")]));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "budget", limitedByRecentCalls: true, postsMeasured: 0, callsUsed: 2 });
  });
});

describe("a spent hour", () => {
  test("a budget that cannot cover account, media and one post makes no Graph call and writes no snapshot", async () => {
    const info = vi.spyOn(log, "info");
    await spend(188, null)();
    for (const scope of ["all", "due"] as const) {
      const r = await svc.measureOwnChannel({ scope, now: NOW });
      expect(r).toMatchObject({ ok: true, stoppedEarly: "budget", limitedByRecentCalls: true, postsSeen: 0, callsUsed: 0 });
    }
    expect(graphClient.fetchAccount).not.toHaveBeenCalled();
    expect(await db.select().from(tables.ownAccountSnapshots)).toHaveLength(0);
    expect(info.mock.calls.filter(([event]) => event === "graph.measure.skipped_budget")).toHaveLength(2);
  });
});

describe("fatal failures after the post loop", () => {
  test("an auth failure while pulling comments fails the run with its code; rows stay", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { commentsCount: 1 })]));
    graphClient.fetchComments.mockImplementation(spend(2, failed(new GraphApiError("GRAPH_AUTH_FAILED", "bad token"))));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(await db.select().from(tables.ownPostInsights)).toHaveLength(1);
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("a rate limit while pulling comments stops the run: rate_limited, no breakdown calls, calls counted", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, [media("a", { commentsCount: 1 }), media("b", { commentsCount: 1 })]));
    graphClient.fetchComments.mockImplementation(spend(2, failed(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"))));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, partial: true, stoppedEarly: "rate_limited", callsUsed: 2 + 4 + 2 });
    expect(graphClient.fetchAccountBreakdowns).not.toHaveBeenCalled();
  });

  test("an auth failure on the breakdowns fails the run with its code and records the token as refused", async () => {
    graphClient.fetchAccountBreakdowns.mockImplementation(spend(1, { split: failed(new GraphApiError("GRAPH_AUTH_FAILED", "bad token")), audience: failed(new GraphApiError("GRAPH_AUTH_FAILED", "bad token")) }));
    expect(await svc.measureOwnChannel({ scope: "due", now: NOW })).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
    expect(rememberTokenStatus).toHaveBeenCalledWith(expect.objectContaining({ state: "auth_failed" }));
  });

  test("a rate limit on the breakdowns is stoppedEarly rate_limited, calls counted, and only the finished split is stored", async () => {
    const split = { metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 30, timeframe: "day" };
    const age = { metric: "engaged_audience_demographics", dimension: "age", key: "18-24", value: 5, timeframe: "this_month" };
    graphClient.fetchAccountBreakdowns.mockImplementation(spend(3, { split: complete([split]), audience: { kind: "partial", rows: [age], missing: "country, gender", reason: new GraphApiError("GRAPH_RATE_LIMITED", "slow down") } }));
    const r = await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", callsUsed: 2 + 3 });
    expect((await db.select().from(tables.ownAccountBreakdowns)).map((row) => row.metric)).toEqual(["views"]);
  });

  test("a batch cut short keeps the previous full batch as the newest one", async () => {
    const full = ["age", "country", "gender"].map((dimension) => ({ metric: "engaged_audience_demographics", dimension, key: "k", value: 1, timeframe: "this_month" }));
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(4, { split: complete([]), audience: complete(full) }));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(2, { split: complete([]), audience: { kind: "partial", rows: [full[0]], missing: "country, gender", reason: new GraphApiError("GRAPH_RATE_LIMITED", "slow down") } }));
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    const stored = await db.select().from(tables.ownAccountBreakdowns);
    expect(stored).toHaveLength(3);
    expect(new Set(stored.map((r) => r.capturedAt))).toEqual(new Set([NOW.toISOString()]));
  });
});

describe("account breakdowns", () => {
  const rows = [
    { metric: "views", dimension: "follower_type", key: "FOLLOWER", value: 30, timeframe: "day" },
    { metric: "engaged_audience_demographics", dimension: "age", key: "25-34", value: 40, timeframe: "this_month" },
  ];
  test("writes a batch once a day and stores a refusal in app_settings", async () => {
    graphClient.fetchAccountBreakdowns.mockImplementation(spend(2, { split: complete(rows.slice(0, 1)), audience: refused("HTTP 400: not enough users") }));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect(await db.select().from(tables.ownAccountBreakdowns)).toHaveLength(1);
    const settings = await db.select().from(tables.appSettings);
    expect(settings.find((s) => s.key === "own_audience_fetch_error")?.value).toContain("not enough users");
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(1);
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect(graphClient.fetchAccountBreakdowns).toHaveBeenCalledTimes(2);
  });
  test("a follower split failure is stored, and cleared by the next good split", async () => {
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(4, { split: refused("HTTP 400: bad"), audience: complete([]) }));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect((await db.select().from(tables.appSettings)).find((s) => s.key === "own_follower_split_fetch_error")?.value).toBe("HTTP 400: bad");
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(4, { split: complete(rows.slice(0, 1)), audience: complete(rows.slice(1)) }));
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_follower_split_fetch_error")).toBe(false);
  });

  test("a partial audience batch (a later dimension failed) is not stored, and its error is recorded", async () => {
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(4, { split: complete(rows.slice(0, 1)), audience: complete(rows.slice(1)) }));
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    graphClient.fetchAccountBreakdowns.mockImplementationOnce(spend(3, { split: complete(rows.slice(0, 1)), audience: { kind: "partial", rows: rows.slice(1), missing: "country, gender", reason: new GraphApiError("GRAPH_UNKNOWN", "HTTP 500: down") } }));
    await svc.measureOwnChannel({ scope: "due", now: new Date(NOW.getTime() + 25 * H) });
    const stored = await db.select().from(tables.ownAccountBreakdowns);
    const later = new Date(NOW.getTime() + 25 * H).toISOString();
    // The split call finished, so it refreshes; the half-done demographics batch does not.
    expect(stored.filter((r) => r.capturedAt === later).every((r) => r.metric === "views")).toBe(true);
    expect(stored.some((r) => r.capturedAt === later)).toBe(rows.some((r) => r.metric === "views"));
    expect(stored.filter((r) => r.metric !== "views").every((r) => r.capturedAt === NOW.toISOString())).toBe(true);
    expect((await db.select().from(tables.appSettings)).find((s) => s.key === "own_audience_fetch_error")?.value).toBe("HTTP 500: down");
  });

  test("a successful fetch clears a stored refusal", async () => {
    graphClient.fetchAccountBreakdowns.mockImplementation(spend(4, { split: complete(rows.slice(0, 1)), audience: complete(rows.slice(1)) }));
    await db.insert(tables.appSettings).values({ key: "own_audience_fetch_error", value: "old" });
    await svc.measureOwnChannel({ scope: "due", now: NOW });
    expect((await db.select().from(tables.appSettings)).some((s) => s.key === "own_audience_fetch_error")).toBe(false);
  });
});

describe("the Graph card's pull", () => {
  const fifty = () => Array.from({ length: 50 }, (_, i) => media(`r${i}`, { caption: `post ${i}` }));

  test("the hour's budget ends the pull at post 31: Partial, retry one hour after the hour's oldest call", async () => {
    // 126 calls already spent this hour, the oldest at 11:20: 200 - 126 - 10 headroom leaves 64, so account + media + 31 reels.
    trySpendCall("instagram-graph", Infinity, new Date("2026-09-29T11:20:00.000Z"));
    for (let i = 1; i < 126; i++) trySpendCall("instagram-graph", Infinity, new Date("2026-09-29T11:50:00.000Z"));
    graphClient.fetchMedia.mockImplementation(spend(1, fifty()));
    const progress: { done: number; total: number; label: string | null }[] = [];
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW, onProgress: (p) => progress.push(p) });
    expect(r).toMatchObject({ ok: true, postsMeasured: 31, stoppedEarly: "budget", retryAfter: "2026-09-29T12:20:00.000Z" });
    expect(progress[0]).toEqual({ done: 0, total: 50, label: "post 0" });
    expect(progress.at(-1)).toEqual({ done: 31, total: 50, label: null });
    const { measurePull } = await import("@/server/connectors/instagram-graph");
    expect(measurePull(r).kind).toBe("partial");
  });

  test("Stop between posts ends the pull at the done count, with no retry time", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, fifty()));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW, shouldStop: () => graphClient.fetchPostInsights.mock.calls.length >= 12 });
    expect(r).toMatchObject({ ok: true, postsMeasured: 12, stoppedEarly: "stopped", retryAfter: null });
  });

  test("Graph's rate limit ends the pull with a retry one hour after the hour's oldest call", async () => {
    trySpendCall("instagram-graph", Infinity, new Date("2026-09-29T11:20:00.000Z"));
    graphClient.fetchMedia.mockImplementation(spend(1, fifty().slice(0, 3)));
    graphClient.fetchPostInsights.mockImplementationOnce(spend(2, complete(insights()))).mockRejectedValueOnce(new GraphApiError("GRAPH_RATE_LIMITED", "slow down"));
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW });
    expect(r).toMatchObject({ ok: true, stoppedEarly: "rate_limited", postsMeasured: 1, retryAfter: "2026-09-29T12:20:00.000Z" });
  });

  test("the hour frees no call when it holds none", async () => {
    expect(hourFreesAt("instagram-graph", NOW)).toBeNull();
    trySpendCall("instagram-graph", Infinity, new Date("2026-09-29T10:59:00.000Z"));
    expect(hourFreesAt("instagram-graph", NOW)).toBeNull();
  });

  test("Pull the rest twice: the third pull measures only posts the chain never measured, the failed post is retried, and the counts cover the channel", async () => {
    const { startGraphPullAction, stopGraphPullAction } = graphActions;
    const { parseSummary, readStatuses } = status;
    await db.delete(tables.connectorStatus);
    graphClient.fetchMedia.mockImplementation(spend(1, fifty().slice(0, 5)));
    const pullAt = async (at: string, rest: boolean, stopAfter: number | null, failing: string[] = []) => {
      vi.setSystemTime(new Date(at));
      const seen: string[] = [];
      graphClient.fetchPostInsights.mockImplementation(async (m: GraphMedia) => {
        seen.push(m.externalId);
        if (seen.length === stopAfter) await stopGraphPullAction();
        return failing.includes(m.externalId) ? insightsFailed(new GraphApiError("GRAPH_UNKNOWN", "post gone"), false) : spend(2, complete(insights()))();
      });
      expect(await startGraphPullAction(rest ? { rest: true } : {})).toEqual({ ok: true });
      await vi.waitFor(() => expect(readStatuses().get("instagram-graph")?.pullState).not.toBe("pulling"));
      return { seen, pull: parseSummary(readStatuses().get("instagram-graph")?.summary ?? null).pull };
    };

    const first = await pullAt("2026-09-29T10:00:00.000Z", false, 2, ["r1"]);
    expect(first.seen).toEqual(["r0", "r1"]);
    expect(first.pull).toMatchObject({ total: 5, done: 2, updated: 1, failed: 1, stop: "stopped" });
    const second = await pullAt("2026-09-29T10:05:00.000Z", true, 2);
    expect(second.seen).toEqual(["r1", "r2"]);
    expect(second.pull).toMatchObject({ total: 5, done: 3, updated: 3, failed: 0, stop: "stopped" });
    const third = await pullAt("2026-09-29T10:10:00.000Z", true, null);
    expect(third.seen).toEqual(["r3", "r4"]);
    expect(third.pull).toMatchObject({ total: 5, done: 5, updated: 5, failed: 0, stop: null, chainFrom: "2026-09-29T10:00:00.000Z" });
  });

  test("Pull the rest skips posts measured since the last pull started", async () => {
    graphClient.fetchMedia.mockImplementation(spend(1, fifty().slice(0, 3)));
    await svc.measureOwnChannel({ scope: "all", now: NOW, shouldStop: () => graphClient.fetchPostInsights.mock.calls.length >= 1 });
    graphClient.fetchPostInsights.mockClear();
    const r = await svc.measureOwnChannel({ scope: "all", now: NOW, skipMeasuredSince: NOW.toISOString() });
    expect(r).toMatchObject({ ok: true, postsMeasured: 2 });
    expect(graphClient.fetchPostInsights.mock.calls.map(([m]) => m.externalId)).toEqual(["r1", "r2"]);
  });
});
