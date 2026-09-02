import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// `node:child_process` is only ever touched by router-control.ts in this test, same
// reasoning as sidecar/control.test.ts's own top-level mock.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ pid: 9999, unref: vi.fn(), on: vi.fn() })),
  execFileSync: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let control: typeof import("./router-control");

// `routerReachable` is a plain `fetch` call, not a spawned process — the real
// reachability/generation probes the brief says never to hit for real in tests are
// mocked at this layer (the network boundary), not by spying on this module's own
// exports: internal calls inside `startRouter`/`waitForRouterHealthy` reference the
// module-local `routerReachable` binding directly, which a `vi.spyOn` on the imported
// namespace object does not intercept for same-module calls.
const fetchMock = vi.fn();

beforeAll(async () => {
  // Same staged-mock reasoning as sidecar/control.test.ts: `node:fs` is installed with
  // `vi.doMock` (not a hoisted top-level mock) so it never intercepts anything real
  // this module's own dependencies might read before this point.
  vi.doMock("node:fs", () => ({
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => "9999"),
    existsSync: vi.fn(() => true),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 7),
    closeSync: vi.fn(),
  }));
  vi.stubGlobal("fetch", fetchMock);
  control = await import("./router-control");
});

afterEach(() => {
  vi.clearAllMocks();
});

function reachable() {
  fetchMock.mockResolvedValue({ status: 307 });
}

function unreachable() {
  fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
}

describe("router control", () => {
  test("routerReachable is true when the health URL answers, false when the fetch throws", async () => {
    reachable();
    expect(await control.routerReachable()).toBe(true);

    unreachable();
    expect(await control.routerReachable()).toBe(false);
  });

  test("startRouter is a no-op success when 9router already answers reachable", async () => {
    reachable();
    const { spawn } = await import("node:child_process");

    const result = await control.startRouter();

    expect(result).toEqual({ ok: true, alreadyUp: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("startRouter spawns the tray binary and writes the pid when unreachable", async () => {
    unreachable();
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");

    const result = await control.startRouter();

    expect(result).toEqual({ ok: true, alreadyUp: false });
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/opt/homebrew/bin/9router");
    expect(call[1]).toEqual(["--tray", "--no-browser", "--skip-update"]);
    const opts = call[2] as { detached: boolean; stdio: unknown[] };
    expect(opts.detached).toBe(true);
    expect(opts.stdio[0]).toBe("ignore");
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith("data/9router.pid", "9999");
  });

  test("concurrent startRouter calls collapse onto one spawn and one pid write (in-flight guard)", async () => {
    unreachable();
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");

    // Both calls see `routerReachable()` as false (the race the in-flight guard exists
    // to close): without the guard, each would independently spawn its own child and
    // the second `writeFileSync` would silently overwrite the first child's tracked
    // pid, leaving it running but untracked.
    const [first, second] = await Promise.all([control.startRouter(), control.startRouter()]);

    expect(first).toEqual({ ok: true, alreadyUp: false });
    // Same promise shared, not just two calls that happened to agree — proves the
    // second caller never started its own spawn attempt at all.
    expect(second).toBe(first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  test("a startRouter call after the in-flight one has settled spawns again if still unreachable (guard doesn't wedge)", async () => {
    unreachable();

    const first = await control.startRouter();
    const second = await control.startRouter();

    const { spawn } = await import("node:child_process");
    expect(first).toEqual({ ok: true, alreadyUp: false });
    expect(second).toEqual({ ok: true, alreadyUp: false });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test("startRouter resolves the binary from ROUTER_BIN when set", async () => {
    unreachable();
    const { spawn } = await import("node:child_process");
    process.env.ROUTER_BIN = "/custom/path/9router";

    await control.startRouter();

    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/custom/path/9router");
    delete process.env.ROUTER_BIN;
  });

  test("startRouter resolves the binary from PATH when ROUTER_BIN is unset and `which` finds it", async () => {
    unreachable();
    const { spawn, execFileSync } = await import("node:child_process");
    delete process.env.ROUTER_BIN;
    vi.mocked(execFileSync).mockReturnValue("/Users/kai/.npm-global/bin/9router\n");

    await control.startRouter();

    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/Users/kai/.npm-global/bin/9router");
    expect(execFileSync).toHaveBeenCalledWith("which", ["9router"], { encoding: "utf8" });
  });

  test("startRouter falls back to the hardcoded Homebrew path when neither ROUTER_BIN nor PATH resolve it", async () => {
    unreachable();
    const { spawn, execFileSync } = await import("node:child_process");
    delete process.env.ROUTER_BIN;
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("which: no 9router in PATH");
    });

    await control.startRouter();

    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("/opt/homebrew/bin/9router");
  });

  test("startRouter registers an error handler so an async spawn failure doesn't crash this process", async () => {
    unreachable();
    const { spawn } = await import("node:child_process");
    const { log } = await import("@/server/lib/logger");

    await control.startRouter();

    const spawnMock = spawn as unknown as { mock: { results: { value: { on: ReturnType<typeof vi.fn> } }[] } };
    const child = spawnMock.mock.results[0].value;
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = child.on.mock.calls[0][1] as (err: Error) => void;
    expect(() => handler(new Error("spawn 9router ENOENT"))).not.toThrow();
    expect(log.error).toHaveBeenCalled();
  });

  test("routerPidAlive returns false when no pid file exists", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    expect(control.routerPidAlive()).toBe(false);
  });

  test("routerPidAlive returns true when process.kill(pid, 0) does not throw", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as const);
    expect(control.routerPidAlive()).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(9999, 0);
    killSpy.mockRestore();
  });

  test("stopRouter kills only the tracked pid and removes the pid file", async () => {
    const fs = await import("node:fs");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as const);
    control.stopRouter();
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGTERM");
    expect(fs.rmSync).toHaveBeenCalled();
    killSpy.mockRestore();
  });

  test("stopRouter is a no-op when no pid file exists", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    const killSpy = vi.spyOn(process, "kill");
    control.stopRouter();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  test("waitForRouterHealthy resolves true once the health URL answers within the window", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ status: 307 });

    const result = await control.waitForRouterHealthy(200, 1);

    expect(result).toBe(true);
  });

  test("waitForRouterHealthy resolves false once the window elapses without a reachable answer", async () => {
    unreachable();

    const result = await control.waitForRouterHealthy(20, 5);

    expect(result).toBe(false);
  });
});
