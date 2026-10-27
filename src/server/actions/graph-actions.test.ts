import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphTokenStatus } from "../graph/client";

const graphClient = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  fetchComments: vi.fn(),
  checkToken: vi.fn(),
}));

// CLASSIFIER_VERSION is imported by own-measure.ts directly, so the mock must supply
// it too, not just graphClient — same shape the real module exports.
vi.mock("../graph/client", () => ({ graphClient, CLASSIFIER_VERSION: "test-classifier-v1" }));
const measureOwnChannel = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/own-measure", async (orig) => ({ ...(await orig<typeof import("@/server/services/own-measure")>()), measureOwnChannel }));
// The in-memory DB is not migrated, so it has no connector_status table to record the pull in.
vi.mock("../services/connector-status", () => ({ recordPull: vi.fn() }));

process.env.CROWSNEST_DB_PATH = ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";

let measureOwnChannelAction: typeof import("./graph-actions")["measureOwnChannelAction"];
let checkGraphTokenAction: typeof import("./graph-actions")["checkGraphTokenAction"];

beforeAll(async () => {
  ({ measureOwnChannelAction, checkGraphTokenAction } = await import("./graph-actions"));
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
