import { afterEach, describe, expect, test, vi } from "vitest";

// No real process spawns, HTTP probes, or LLM calls in this file: router-control.ts's
// own spawn/pid-file/reachability behavior is covered by router-control.test.ts, and
// generation-probe.ts's classification is covered by generation-probe.test.ts. This
// file is only about the decisions router-actions.ts itself makes: when to report
// ok:true, and the auto-restart cooldown.
vi.mock("@/server/llm/router-control", () => ({
  startRouter: vi.fn(),
  stopRouter: vi.fn(),
  routerPidAlive: vi.fn(() => false),
  routerReachable: vi.fn(),
  waitForRouterHealthy: vi.fn(),
}));
vi.mock("@/server/llm/generation-probe", () => ({ probeLlmGeneration: vi.fn() }));
vi.mock("@/server/settings", () => ({ getSetting: vi.fn() }));
vi.mock("@/server/lib/logger", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("startRouterAction", () => {
  test("is a no-op success when startRouter reports it was already up", async () => {
    const { startRouter, waitForRouterHealthy } = await import("@/server/llm/router-control");
    vi.mocked(startRouter).mockResolvedValue({ ok: true, alreadyUp: true });
    const { startRouterAction } = await import("./router-actions");

    const result = await startRouterAction();

    expect(result).toEqual({ ok: true });
    expect(waitForRouterHealthy).not.toHaveBeenCalled();
  });

  test("reports ok once waitForRouterHealthy resolves true after a spawn", async () => {
    const { startRouter, waitForRouterHealthy } = await import("@/server/llm/router-control");
    vi.mocked(startRouter).mockResolvedValue({ ok: true, alreadyUp: false });
    vi.mocked(waitForRouterHealthy).mockResolvedValue(true);
    const { startRouterAction } = await import("./router-actions");

    // Short interval/timeout: the poll window is a parameter precisely so tests never
    // wait out the real ~5s default.
    const result = await startRouterAction(5, 200);

    expect(result).toEqual({ ok: true });
  });

  test("reports a clear failure when 9router never comes up healthy within the window", async () => {
    const { startRouter, waitForRouterHealthy } = await import("@/server/llm/router-control");
    vi.mocked(startRouter).mockResolvedValue({ ok: true, alreadyUp: false });
    vi.mocked(waitForRouterHealthy).mockResolvedValue(false);
    const { startRouterAction } = await import("./router-actions");

    const result = await startRouterAction(5, 30);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("9router did not start");
  });

  test("surfaces a startRouter failure without polling waitForRouterHealthy", async () => {
    const { startRouter, waitForRouterHealthy } = await import("@/server/llm/router-control");
    vi.mocked(startRouter).mockResolvedValue({ ok: false, error: "spawn 9router ENOENT" });
    const { startRouterAction } = await import("./router-actions");

    const result = await startRouterAction();

    expect(result).toEqual({ ok: false, error: "spawn 9router ENOENT" });
    expect(waitForRouterHealthy).not.toHaveBeenCalled();
  });
});

describe("stopRouterAction", () => {
  test("ok:true when stopRouter succeeds", async () => {
    const { stopRouterAction } = await import("./router-actions");

    const result = await stopRouterAction();

    expect(result).toEqual({ ok: true });
  });

  test("ok:false when stopRouter throws", async () => {
    const { stopRouter } = await import("@/server/llm/router-control");
    vi.mocked(stopRouter).mockImplementation(() => {
      throw new Error("boom");
    });
    const { stopRouterAction } = await import("./router-actions");

    const result = await stopRouterAction();

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("getRouterStatusAction", () => {
  test("reports pidAlive/reachable/generationOk straight from the underlying probes", async () => {
    const { routerPidAlive, routerReachable } = await import("@/server/llm/router-control");
    const { probeLlmGeneration } = await import("@/server/llm/generation-probe");
    const { getSetting } = await import("@/server/settings");
    vi.mocked(routerPidAlive).mockReturnValue(true);
    vi.mocked(routerReachable).mockResolvedValue(true);
    vi.mocked(probeLlmGeneration).mockResolvedValue({ state: "up", detail: null });
    vi.mocked(getSetting).mockResolvedValue(false);
    const { getRouterStatusAction } = await import("./router-actions");

    const result = await getRouterStatusAction();

    expect(result).toEqual({ pidAlive: true, reachable: true, generationOk: true });
  });

  test("never calls startRouter when routerAutoManage is off, even while unreachable", async () => {
    vi.resetModules();
    const { routerReachable, startRouter, routerPidAlive } = await import("@/server/llm/router-control");
    const { probeLlmGeneration } = await import("@/server/llm/generation-probe");
    const { getSetting } = await import("@/server/settings");
    vi.mocked(routerPidAlive).mockReturnValue(false);
    vi.mocked(routerReachable).mockResolvedValue(false);
    vi.mocked(probeLlmGeneration).mockResolvedValue({ state: "down", detail: null });
    vi.mocked(getSetting).mockResolvedValue(false);
    const { getRouterStatusAction } = await import("./router-actions");

    await getRouterStatusAction();

    expect(startRouter).not.toHaveBeenCalled();
  });

  test("makes one guarded restart attempt when routerAutoManage is on and unreachable, then a cooldown blocks the next status read from spawning again", async () => {
    vi.resetModules();
    const { routerReachable, startRouter, routerPidAlive } = await import("@/server/llm/router-control");
    const { probeLlmGeneration } = await import("@/server/llm/generation-probe");
    const { getSetting } = await import("@/server/settings");
    vi.mocked(routerPidAlive).mockReturnValue(false);
    vi.mocked(routerReachable).mockResolvedValue(false);
    vi.mocked(probeLlmGeneration).mockResolvedValue({ state: "down", detail: null });
    vi.mocked(getSetting).mockResolvedValue(true);
    vi.mocked(startRouter).mockResolvedValue({ ok: true, alreadyUp: false });
    const { getRouterStatusAction } = await import("./router-actions");

    await getRouterStatusAction();
    expect(startRouter).toHaveBeenCalledTimes(1);

    // A second status read immediately after (e.g. Settings left open, polling) must
    // not trigger a second spawn — this is the hot-loop guard the brief requires.
    await getRouterStatusAction();
    expect(startRouter).toHaveBeenCalledTimes(1);
  });

  test("never throws when getSetting rejects — treated as do-not-auto-restart", async () => {
    vi.resetModules();
    const { routerReachable, startRouter, routerPidAlive } = await import("@/server/llm/router-control");
    const { probeLlmGeneration } = await import("@/server/llm/generation-probe");
    const { getSetting } = await import("@/server/settings");
    vi.mocked(routerPidAlive).mockReturnValue(false);
    vi.mocked(routerReachable).mockResolvedValue(false);
    vi.mocked(probeLlmGeneration).mockResolvedValue({ state: "down", detail: null });
    vi.mocked(getSetting).mockRejectedValue(new Error("db is locked"));
    const { getRouterStatusAction } = await import("./router-actions");

    // The whole point of the fix: a DB failure inside maybeAutoRestart must not reject
    // this function's own promise, and must not attempt a restart either.
    await expect(getRouterStatusAction()).resolves.toEqual({ pidAlive: false, reachable: false, generationOk: false });
    expect(startRouter).not.toHaveBeenCalled();
  });

  test("logs once when the guarded auto-restart attempt itself fails", async () => {
    vi.resetModules();
    const { routerReachable, startRouter, routerPidAlive } = await import("@/server/llm/router-control");
    const { probeLlmGeneration } = await import("@/server/llm/generation-probe");
    const { getSetting } = await import("@/server/settings");
    const { log } = await import("@/server/lib/logger");
    vi.mocked(routerPidAlive).mockReturnValue(false);
    vi.mocked(routerReachable).mockResolvedValue(false);
    vi.mocked(probeLlmGeneration).mockResolvedValue({ state: "down", detail: null });
    vi.mocked(getSetting).mockResolvedValue(true);
    vi.mocked(startRouter).mockResolvedValue({ ok: false, error: "spawn 9router ENOENT" });
    const { getRouterStatusAction } = await import("./router-actions");

    await getRouterStatusAction();

    expect(startRouter).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("router.auto_restart.failed", { error: "spawn 9router ENOENT" });
  });
});
