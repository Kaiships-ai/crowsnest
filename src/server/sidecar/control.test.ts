import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// `node:child_process` is only ever touched by control.ts, so a plain hoisted mock is
// safe. `node:fs` is NOT mocked here at the top level: drizzle-orm's migrator (used
// below to build the in-memory schema before any test runs) imports `node:fs` too, and
// a hoisted mock would intercept its real file reads along with control.ts's pid-file
// calls. Instead the fs mock is installed with `vi.doMock` after migration has already
// run, so it only ever affects the later, fresh import of `./control`.
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => ({ pid: 4242, unref: vi.fn(), on: vi.fn() })), execFile: vi.fn() }));

// Keeps the "spawn failed asynchronously" test from actually printing a log line, and
// gives a spy to assert against.
vi.mock("@/server/lib/logger", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let control: typeof import("./control");

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token-0000000000000000";
  const { migrate } = await import("@/server/db/test-migrate");
  migrate();

  vi.doMock("node:fs", () => ({
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => "4242"),
    existsSync: vi.fn(() => true),
    rmSync: vi.fn(),
  }));
  control = await import("./control");
});

afterEach(() => vi.clearAllMocks());

describe("sidecar control", () => {
  test("startSidecar spawns with injected env and writes the pid", async () => {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    control.startSidecar();
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call[0]).toBe("uv");
    expect(call[1]).toEqual(["run", "python", "-m", "crowsnest_ig"]);
    const opts = call[2] as { cwd: string; env: Record<string, string>; detached: boolean; stdio: string };
    expect(opts.cwd).toMatch(/services\/ig$/);
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe("ignore");
    expect(opts.env.IG_SERVICE_TOKEN).toBeTruthy();
    expect(opts.env).toHaveProperty("CROWSNEST_INGEST_URL");
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeArgs = (fs.writeFileSync as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(writeArgs[0]).toBe("data/sidecar.pid");
    expect(writeArgs[1]).toBe("4242");
  });

  test("startSidecar clears a stale pid file before it spawns, so a failed spawn leaves no old pid to poll or kill", async () => {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const order: string[] = [];
    vi.mocked(fs.rmSync).mockImplementationOnce(() => void order.push("rm data/sidecar.pid"));
    vi.mocked(spawn).mockImplementationOnce(((() => {
      order.push("spawn");
      return { pid: undefined, unref: vi.fn(), on: vi.fn() };
    }) as unknown) as typeof spawn);
    control.startSidecar();
    expect(order).toEqual(["rm data/sidecar.pid", "spawn"]);
    expect(vi.mocked(fs.rmSync).mock.calls[0][0]).toBe("data/sidecar.pid");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test("startSidecar registers an error handler, so an async spawn failure (e.g. ENOENT for a missing `uv`) is observed instead of crashing this process", async () => {
    const { spawn } = await import("node:child_process");
    const { log } = await import("@/server/lib/logger");
    control.startSidecar();
    const spawnMock = spawn as unknown as { mock: { results: { value: { on: ReturnType<typeof vi.fn> } }[] } };
    const child = spawnMock.mock.results[0].value;
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = child.on.mock.calls[0][1] as (err: Error) => void;
    expect(() => handler(new Error("spawn uv ENOENT"))).not.toThrow();
    expect(log.error).toHaveBeenCalled();
  });

  test("stopSidecar kills the tracked pid's whole process group, so uv's python child is not orphaned, and removes the file", async () => {
    const fs = await import("node:fs");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as const);
    control.stopSidecar();
    expect(killSpy.mock.calls).toEqual([[-4242, "SIGTERM"]]);
    expect(fs.rmSync).toHaveBeenCalled();
    killSpy.mockRestore();
  });

  test("sidecarPidAlive returns false when no pid file exists", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.existsSync).mockReturnValueOnce(false);
    expect(control.sidecarPidAlive()).toBe(false);
  });

  test("sidecarPidAlive returns true when process.kill(pid, 0) does not throw", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as const);
    expect(control.sidecarPidAlive()).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(4242, 0);
    killSpy.mockRestore();
  });
});
