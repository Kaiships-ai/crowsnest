import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphTokenStatus } from "../graph/client";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  fetchComments: vi.fn(),
  checkToken: vi.fn(),
}));

// CLASSIFIER_VERSION is imported by own-measure.ts directly, so the mock must supply
// it too, not just graphClient — same shape the real module exports.
const tokenAccount = vi.hoisted(() => vi.fn());
vi.mock("../graph/client", () => ({ graphClient, tokenAccount, CLASSIFIER_VERSION: "test-classifier-v1" }));
const setConnectorSecret = vi.hoisted(() => vi.fn());
vi.mock("./secrets-actions", () => ({ setConnectorSecret }));
const measureOwnChannel = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/own-measure", async (orig) => ({ ...(await orig<typeof import("@/server/services/own-measure")>()), measureOwnChannel }));
// The in-memory DB is not migrated, so it has no connector_status table to record the pull in.
const recordSample = vi.hoisted(() => vi.fn());
const recordPullStart = vi.hoisted(() => vi.fn());
const recordPullEnd = vi.hoisted(() => vi.fn());
vi.mock("../services/connector-status", () => ({ recordPull: vi.fn(), recordSample, recordPullStart, recordPullEnd, recordPullProgress: vi.fn(), restFrom: vi.fn() }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let measureOwnChannelAction: typeof import("./graph-actions")["measureOwnChannelAction"];
let checkGraphTokenAction: typeof import("./graph-actions")["checkGraphTokenAction"];
let testGraphTokenAction: typeof import("./graph-actions")["testGraphTokenAction"];
let saveGraphTokenAction: typeof import("./graph-actions")["saveGraphTokenAction"];
let startGraphPullAction: typeof import("./graph-actions")["startGraphPullAction"];

beforeAll(async () => {
  ({ measureOwnChannelAction, checkGraphTokenAction, testGraphTokenAction, saveGraphTokenAction, startGraphPullAction } = await import("./graph-actions"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("measureOwnChannelAction", () => {
  test("ACTION-18: delegates with scope all on success", async () => {
    measureOwnChannel.mockResolvedValue({ ok: true, measuredAt: "t", postsSeen: 1, postsMeasured: 1, postsFailed: 0, commentsSeen: 0, partial: false, callsUsed: 4, stoppedEarly: null });
    const r = await measureOwnChannelAction();
    expect(measureOwnChannel).toHaveBeenCalledWith({ scope: "all" });
    expect(r).toMatchObject({ ok: true, postsMeasured: 1 });
  });
  test("a failure is returned", async () => {
    measureOwnChannel.mockResolvedValue({ ok: false, error: "bad token", code: "GRAPH_AUTH_FAILED" });
    expect(await measureOwnChannelAction()).toMatchObject({ ok: false, code: "GRAPH_AUTH_FAILED" });
  });
  test("a non-Graph throw (a DB error) is logged and returned as MEASURE_FAILED, never thrown", async () => {
    measureOwnChannel.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));
    const { log } = await import("../lib/logger");
    const error = vi.spyOn(log, "error");
    expect(await measureOwnChannelAction()).toEqual({ ok: false, code: "MEASURE_FAILED", error: "SQLITE_BUSY: database is locked" });
    expect(error.mock.calls.some(([event]) => event === "graph.measure.unexpected")).toBe(true);
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

  test("a permission refusal a measurement saw is not overwritten by an ok /me check", async () => {
    const { rememberTokenStatus, invalidateTokenStatus } = await import("../graph/token-status");
    rememberTokenStatus({ configured: true, username: null, state: "permission_denied", message: "no insights", checkedAt: "t" });
    graphClient.checkToken.mockResolvedValue({ configured: true, username: "me", state: "ok", message: null, checkedAt: "t2" });
    const result = await checkGraphTokenAction();
    expect(graphClient.checkToken).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, status: { state: "permission_denied", message: "no insights" } });
    invalidateTokenStatus();
  });
});

describe("the Graph token form", () => {
  test("Test connection answers with the account and stores nothing", async () => {
    tokenAccount.mockResolvedValue({ ok: true, id: "17841400000000001", username: "kaiships.ai" });
    expect(await testGraphTokenAction("  IGAAtoken \n")).toEqual({ ok: true, username: "kaiships.ai", userId: "17841400000000001" });
    expect(tokenAccount).toHaveBeenCalledWith("IGAAtoken");
    expect(setConnectorSecret).not.toHaveBeenCalled();
    expect(recordSample).not.toHaveBeenCalled();
  });

  test("Test connection with a refused token says so in the form's words", async () => {
    tokenAccount.mockResolvedValue({ ok: false, code: "GRAPH_AUTH_FAILED", message: "Invalid OAuth access token" });
    const { TOKEN_REJECTED_FORM } = await import("../connectors/instagram-graph");
    expect(await testGraphTokenAction("IGAAold")).toEqual({ ok: false, message: TOKEN_REJECTED_FORM });
  });

  test("Save stores the trimmed token and the user id, then records the sample", async () => {
    tokenAccount.mockResolvedValue({ ok: true, id: "17841400000000001", username: "kaiships.ai" });
    setConnectorSecret.mockResolvedValue({ ok: true });
    expect(await saveGraphTokenAction(" IGAAtoken\n")).toEqual({ ok: true });
    expect(setConnectorSecret.mock.calls).toEqual([
      ["instagram-graph", "IG_GRAPH_TOKEN", "IGAAtoken"],
      ["instagram-graph", "IG_GRAPH_USER_ID", "17841400000000001"],
    ]);
    expect(recordSample).toHaveBeenCalledWith("instagram-graph", { ok: true, line: "@kaiships.ai" });
  });

  test("Save with a refused token stores nothing", async () => {
    tokenAccount.mockResolvedValue({ ok: false, code: "GRAPH_AUTH_FAILED", message: "Invalid OAuth access token" });
    expect(await saveGraphTokenAction("IGAAold")).toMatchObject({ ok: false });
    expect(setConnectorSecret).not.toHaveBeenCalled();
    expect(recordSample).not.toHaveBeenCalled();
  });
});

describe("startGraphPullAction", () => {
  test("a pull whose start record throws ends as failed, and Pull my channel works again", async () => {
    recordPullStart.mockImplementationOnce(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    expect(await startGraphPullAction()).toEqual({ ok: true });
    await vi.waitFor(() => expect(recordPullEnd).toHaveBeenCalledTimes(1));
    expect(recordPullEnd.mock.calls[0][1]).toMatchObject({ kind: "failed" });
    measureOwnChannel.mockResolvedValue({ ok: true, measuredAt: "t", postsSeen: 0, postsMeasured: 0, postsFailed: 0, commentsSeen: 0, partial: false, callsUsed: 2, stoppedEarly: null, retryAfter: null });
    expect(await startGraphPullAction()).toEqual({ ok: true });
    await vi.waitFor(() => expect(recordPullEnd).toHaveBeenCalledTimes(2));
  });
});
