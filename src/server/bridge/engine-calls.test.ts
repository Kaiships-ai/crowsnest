import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let ENGINE_CALLS: typeof import("./engine-calls")["ENGINE_CALLS"];
let dispatchEngineCall: typeof import("./engine-calls")["dispatchEngineCall"];

const GRAPH_TOKEN = "sentinel-graph-token-5f1e";
const SESSION_ID = "sentinel-session-id-9a2c";

const failureStrip = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "return" }));
vi.mock("@/server/queries/failure-surface", async (orig) => {
  const real = await orig<typeof import("@/server/queries/failure-surface")>();
  return {
    ...real,
    getFailureStrip: async () => {
      if (failureStrip.mode === "throw") throw new Error(`Graph said no to access_token=${GRAPH_TOKEN}`);
      if (failureStrip.mode === "return") return { ok: false, error: `bad session ${SESSION_ID} for kai`, code: "X" };
      return real.getFailureStrip();
    },
  };
});

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  ({ db, tables } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ ENGINE_CALLS, dispatchEngineCall } = await import("./engine-calls"));
  vi.stubGlobal("fetch", async (url: unknown) => {
    throw new Error(`connect ECONNREFUSED ${String(url)}`);
  });
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(async () => {
  failureStrip.mode = "real";
  migrate();
  for (const t of [tables.ownPosts, tables.plannedPosts, tables.syncJobs, tables.videos, tables.channels, tables.secrets, tables.sealedSecrets]) await db.delete(t);
  const now = new Date().toISOString();
  await db.insert(tables.channels).values({ id: "ch-1", platform: "instagram", handle: "@bridge_fixture", trackedSince: now, isOwn: true });
  await db.insert(tables.videos).values({ id: "v-1", channelId: "ch-1", platform: "instagram", externalId: "x1", url: "https://instagram.com/p/x1", postedAt: now, firstSeenAt: now });
  await db.insert(tables.plannedPosts).values({ id: "p-1", title: "Bridge plan", plannedDate: now.slice(0, 10), createdAt: now, updatedAt: now });
  await db.insert(tables.syncJobs).values({ id: "job-1", startedAt: now, status: "success" });
  await db.insert(tables.ownPosts).values({ id: "op-1", externalId: "o1", permalink: "https://instagram.com/p/o1", mediaType: "VIDEO", format: "Reel", postedAt: now, firstSeenAt: now });
  for (const [name, value] of [["IG_GRAPH_TOKEN", GRAPH_TOKEN], ["IG_GRAPH_USER_ID", "17841400000000000"], ["IG_SESSIONID", SESSION_ID], ["IG_USERNAME", "kai"]]) {
    await db.insert(tables.secrets).values({ name, value, updatedAt: now });
  }
});

const READ_ARGS: Record<string, unknown[]> = {
  getDashboardStats: [],
  getStackHealth: [],
  getNewFeedOutliers: [],
  getFailureStrip: [],
  getFirstRunGate: [],
  getChannelsList: [],
  getKanbanBoard: [],
  getOwnChannel: [],
  getFleets: [],
  getChannelDetail: ["ch-1"],
  getChannelMedianHistory: ["ch-1"],
  getOutlierFeed: [{ sort: "score", limit: 24, offset: 0 }],
  getFeedBandCounts: [],
  getVideoDetail: ["v-1"],
  listCreatorSeeds: [],
  getOwnChannelOverview: [],
  getOwnPosts: [],
  getOwnPostInsightHistory: ["op-1"],
  getOwnComments: [],
  getOwnReels: [],
  getReelViewHistory: [],
  getFunnel: [],
  getMetricLedger: [],
  getFunnelBoard: [],
  getTodayBoard: [],
  getOwnBoard: [7],
  getOwnReelBoard: ["op-1"],
  getRivalsBoard: [],
  getPlanBoard: [new Date().toISOString().slice(0, 7)],
  getPlannedPosts: [],
  getPlannedPostById: ["p-1"],
  getCalendarMonth: [new Date().toISOString().slice(0, 7)],
  getScripts: [],
  listPlanVersions: [{ period: "month", periodKey: "2026-11" }],
  getSyncProgressAction: ["job-1"],
  getChannelSyncProgressAction: ["ch-1"],
  getLatestSyncJob: [],
  measureOwnChannelAction: [],
  checkGraphTokenAction: [],
  getIgStatusAction: [],
  listRuns: [],
  getRun: ["job-1"],
  getLastRunHealth: [],
  getSecretStatusAction: [],
  listConnectors: [],
  getVaultBoard: [],
  listNotificationsAction: [],
  listAgentActions: [10],
  listMcpTokens: [],
};

describe("dispatchEngineCall", () => {
  test("runs a query with parsed arguments and returns its rows", async () => {
    const res = await dispatchEngineCall("getChannelsList", []);
    expect(res.ok && (res.value as { handle: string }[]).map((c) => c.handle)).toEqual(["@bridge_fixture"]);
  });

  test("treats missing arguments as an empty tuple", async () => {
    const res = await dispatchEngineCall("getChannelsList", undefined);
    expect(res.ok).toBe(true);
  });

  test.each(["noSuchCall", "__proto__", "toString", "constructor", 42, null])("refuses the unknown name %s", async (name) => {
    const res = await dispatchEngineCall(name, []);
    expect(res).toMatchObject({ ok: false, error: { code: "unknown_call" } });
  });

  test.each([
    ["a wrong type", "getChannelDetail", [42]],
    ["an extra argument", "getChannelDetail", ["ch-1", "extra"]],
    ["a missing argument", "getChannelDetail", []],
    ["not a tuple", "getChannelDetail", { id: "ch-1" }],
    ["a plan ref with no period", "listPlanVersions", [{ a: 1 }]],
    ["a malformed period key", "listPlanVersions", [{ period: "month", periodKey: "2026-W44" }]],
  ])("refuses %s before the engine runs", async (_label, name, args) => {
    const res = await dispatchEngineCall(name, args);
    expect(res).toMatchObject({ ok: false, error: { code: "bad_args" } });
  });

  test("a thrown engine error crosses as failed with secret values scrubbed", async () => {
    failureStrip.mode = "throw";
    const res = await dispatchEngineCall("getFailureStrip", []);
    expect(res).toEqual({ ok: false, error: { code: "failed", message: "Graph said no to access_token=[redacted]" } });
  });

  test("an engine failure result has secret values scrubbed, short ones left alone", async () => {
    failureStrip.mode = "return";
    const res = await dispatchEngineCall("getFailureStrip", []);
    expect(res).toEqual({ ok: true, value: { ok: false, error: "bad session [redacted] for kai", code: "X" } });
  });

  test("exposes no call that writes outside the Mac, reads back or clears a secret, or skips the plan approver", () => {
    const gated = [
      "publishNowAction",
      "schedulePublishAction",
      "cancelScheduledPublishAction",
      "retryFailedPublishAction",
      "markPlanPublishedAction",
      "approvePlanVersionAction",
      "undoPlanVersionAction",
      "setSecretAction",
      "clearSecretAction",
      "regenerateServiceTokenAction",
      "igLoginAction",
      "igLoginWithCredentialsAction",
      "igLoginBySessionAction",
      "startSidecarAction",
      "stopSidecarAction",
    ];
    expect(gated.filter((n) => Object.hasOwn(ENGINE_CALLS, n))).toEqual([]);
  });

  test("every read has a fixture", () => {
    const reads = Object.keys(ENGINE_CALLS).filter((n) => /^(get|list)/.test(n));
    expect(reads.filter((n) => !Object.hasOwn(READ_ARGS, n))).toEqual([]);
  });

  test.each(Object.entries(READ_ARGS))("%s runs and returns no stored secret value", async (name, args) => {
    const res = await dispatchEngineCall(name, args);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain(GRAPH_TOKEN);
    expect(text).not.toContain(SESSION_ID);
  });

  describe("setConnectorSecret", () => {
    const VALUE = "sentinel-new-umami-password-77c1";

    test.each([
      ["an unknown connector", ["nope", "UMAMI_PASSWORD", VALUE], "no connector nope"],
      ["a field the manifest does not declare", ["umami", "IG_GRAPH_TOKEN", VALUE], "umami has no field IG_GRAPH_TOKEN"],
      ["a blank value", ["umami", "UMAMI_PASSWORD", "   "], "empty value"],
    ])("refuses %s and stores nothing", async (_label, args, error) => {
      const res = await dispatchEngineCall("setConnectorSecret", args);
      expect(res).toEqual({ ok: true, value: { ok: false, error } });
      expect(JSON.stringify(res)).not.toContain(VALUE);
      const umami = await dispatchEngineCall("getVaultBoard", []);
      expect(umami.ok && (umami.value as { id: string; secrets: { name: string; source: string }[] }[]).find((r) => r.id === "umami")?.secrets.find((s) => s.name === "UMAMI_PASSWORD")?.source).toBe("none");
    });

    test("an empty value never reaches the engine", async () => {
      expect(await dispatchEngineCall("setConnectorSecret", ["umami", "UMAMI_PASSWORD", ""])).toMatchObject({ ok: false, error: { code: "bad_args" } });
    });

    test("saves, flips the status to keychain, and no bridge result carries the value", async () => {
      const res = await dispatchEngineCall("setConnectorSecret", ["umami", "UMAMI_PASSWORD", VALUE]);
      expect(res).toEqual({ ok: true, value: { ok: true } });
      const board = await dispatchEngineCall("getVaultBoard", []);
      const umami = board.ok ? (board.value as { id: string; secrets: { name: string; source: string }[] }[]).find((r) => r.id === "umami") : undefined;
      expect(umami?.secrets.map((s) => [s.name, s.source])).toEqual([["UMAMI_URL", "none"], ["UMAMI_WEBSITE_ID", "none"], ["UMAMI_USERNAME", "none"], ["UMAMI_PASSWORD", "keychain"]]);
      for (const [name, args] of Object.entries(READ_ARGS)) {
        expect(JSON.stringify(await dispatchEngineCall(name, args)), name).not.toContain(VALUE);
      }
    });
  });

  test("secret status says configured without the value", async () => {
    const status = await dispatchEngineCall("getSecretStatusAction", []);
    expect(status.ok && status.value).toContainEqual({ name: "IG_GRAPH_TOKEN", configured: true, source: "db" });
  });
});
