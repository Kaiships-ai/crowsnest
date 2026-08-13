import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sandboxDir, slugify } from "@/server/studio/paths";

const write = vi.fn();
const resize = vi.fn();
const kill = vi.fn();
let onDataCb: ((s: string) => void) | undefined;
let onExitCb: ((code: number) => void) | undefined;

const createTerminalSession = vi.fn(() => ({
  onData: (cb: (s: string) => void) => {
    onDataCb = cb;
  },
  write,
  resize,
  onExit: (cb: (code: number) => void) => {
    onExitCb = cb;
  },
  kill,
}));
// buildCookProfile (called by attachTerminal via harness-profile.ts) imports
// scrubbedTerminalEnv from this same module, so the mock must keep exporting it too.
vi.mock("./session", () => ({ createTerminalSession, scrubbedTerminalEnv: vi.fn(() => ({})) }));

const getPlannedPostTitleById = vi.fn();
vi.mock("./resolve-post", () => ({ getPlannedPostTitleById }));

const renderWatchStop = vi.fn();
let capturedOnFound: ((p: string) => void) | undefined;
const watchForRender = vi.fn((opts: { slug: string; onFound: (p: string) => void }) => {
  capturedOnFound = opts.onFound;
  return { stop: renderWatchStop };
});
const pruneOldRenders = vi.fn();
const rendersRoot = vi.fn(() => "/fake/vault/Studio/workspace/renders");
vi.mock("./render-watch", () => ({
  watchForRender: (opts: never) => watchForRender(opts),
  pruneOldRenders: (...args: never[]) => pruneOldRenders(...args),
  rendersRoot: () => rendersRoot(),
}));

// Passthrough queue mock: calls fn() immediately (synchronously, since attachTerminal's
// executor never awaits before wiring session/watchdog/renderWatch) so every existing
// test's "await attachTerminal(...)" still observes the session already created,
// without pulling in the real p-queue concurrency behavior (that lives in
// cook-queue.test.ts).
const runOnCookQueue = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock("./cook-queue", () => ({ runOnCookQueue: (fn: () => Promise<unknown>) => runOnCookQueue(fn) }));

const assetStorePut = vi.fn(async () => "asset-1");
const assetStorePublicUrl = vi.fn((id: string) => `/api/media/${id}`);
vi.mock("@/server/media/asset-store", () => ({
  getAssetStore: () => ({ put: assetStorePut, publicUrl: assetStorePublicUrl }),
}));

// Existing tests never care about the vault-missing guard, so existsSync defaults to
// true here; the one test that needs it false overrides this mock per-test.
const existsSync = vi.fn((_path: string) => true);
vi.mock("node:fs", () => ({ existsSync: (path: string) => existsSync(path), mkdirSync: vi.fn() }));

vi.mock("@/server/config", () => ({ config: { VAULT_PATH: "/fake/vault", COOK_WATCHDOG_MS: 1000 } }));

/** Mocks ws as an EventEmitter with send/close spies, matching the real `ws.WebSocket`
 *  shape closely enough for attachTerminal's `.on("message"|"close"|"error", ...)`
 *  wiring, plus the readyState/OPEN pair the setup catch block reads before closing. */
function fakeWs() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { send: vi.fn(), close: vi.fn(), readyState: 1, OPEN: 1 });
}

describe("attachTerminal", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    onDataCb = undefined;
    onExitCb = undefined;
    capturedOnFound = undefined;
  });

  it("resolves the post's title, computes the sandbox dir, and creates a session there", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    const req = { url: "/api/terminal/ws?post=abc" };

    await attachTerminal(ws as never, req as never);

    expect(getPlannedPostTitleById).toHaveBeenCalledWith("abc");
    expect(createTerminalSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: sandboxDir(slugify("My Great Post")) }),
    );
  });

  it("relays an input message to session.write", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("message", JSON.stringify({ type: "input", data: "x" }));

    expect(write).toHaveBeenCalledWith("x");
  });

  it("closes the ws with 1008 on a non-JSON message instead of throwing", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(() => ws.emit("message", "not json")).not.toThrow();

    expect(ws.close).toHaveBeenCalledWith(1008, "bad frame");
    expect(write).not.toHaveBeenCalled();
  });

  it("relays a resize message to session.resize", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("message", JSON.stringify({ type: "resize", cols: 80, rows: 24 }));

    expect(resize).toHaveBeenCalledWith(80, 24);
  });

  it("sends an output frame when the pty emits data", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    onDataCb?.("hello");

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "output", data: "hello" }));
  });

  it("sends an exit frame and closes the socket when the pty exits", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    onExitCb?.(0);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "exit", code: 0 }));
    expect(ws.close).toHaveBeenCalled();
  });

  it("kills the session when the ws closes", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("close");

    expect(kill).toHaveBeenCalled();
  });

  it("closes the ws with 1008 when the post is unknown", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce(null);
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=missing" } as never);

    expect(ws.close).toHaveBeenCalledWith(1008, "unknown post");
    expect(createTerminalSession).not.toHaveBeenCalled();
  });

  it("closes the ws with 1008 when no post param is given", async () => {
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws" } as never);

    expect(ws.close).toHaveBeenCalledWith(1008, "missing post");
    expect(getPlannedPostTitleById).not.toHaveBeenCalled();
  });

  it("kills the session when the ws emits an error", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("error", new Error("ECONNRESET"));

    expect(kill).toHaveBeenCalled();
  });

  it("closes the ws with 1011 and does not throw when setup fails", async () => {
    getPlannedPostTitleById.mockRejectedValueOnce(new Error("database is locked"));
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await expect(attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never)).resolves.toBeUndefined();

    expect(ws.close).toHaveBeenCalledWith(1011, "terminal setup failed");
    expect(createTerminalSession).not.toHaveBeenCalled();
  });

  it("kills a partially-created session and closes with 1011 when session creation throws", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    createTerminalSession.mockImplementationOnce(() => {
      throw new Error("spawn ENOENT");
    });
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await expect(attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never)).resolves.toBeUndefined();

    expect(ws.close).toHaveBeenCalledWith(1011, "terminal setup failed");
  });

  it("closes the ws with 1008 when the title slugifies to an empty string", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("!!!");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(ws.close).toHaveBeenCalledWith(1008, "unusable post title");
    expect(createTerminalSession).not.toHaveBeenCalled();
  });

  it("closes the ws with 1011 when the vault directory is missing", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    existsSync.mockReturnValue(false);
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(ws.close).toHaveBeenCalledWith(1011, "vault missing");
    expect(createTerminalSession).not.toHaveBeenCalled();
  });

  it("captures a finished render and sends it as a render frame", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(watchForRender).toHaveBeenCalledWith(expect.objectContaining({ slug: slugify("My Great Post") }));

    capturedOnFound?.("/tmp/x/video.mp4");
    await new Promise((r) => setTimeout(r, 0));

    expect(assetStorePut).toHaveBeenCalledWith({ path: "/tmp/x/video.mp4" }, "video", "video/mp4");
    const call = ws.send.mock.calls.find((args: unknown[]) => JSON.parse(args[0] as string).type === "render");
    expect(call).toBeDefined();
    const frame = JSON.parse((call as unknown[])[0] as string);
    expect(frame).toEqual({ type: "render", assetId: "asset-1", url: "/api/media/asset-1" });
  });

  it("stops the render watcher when the ws closes", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("close");

    expect(renderWatchStop).toHaveBeenCalled();
  });

  it("prunes old renders once at attach time", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(pruneOldRenders).toHaveBeenCalledTimes(1);
    expect(pruneOldRenders).toHaveBeenCalledWith("/fake/vault/Studio/workspace/renders", expect.any(Number));
  });

  it("clears the watchdog timer and stops the render watch when the session exits", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    // Only the watchdog is a real timer here: watchForRender is mocked, so no interval
    // is actually scheduled by this test.
    expect(vi.getTimerCount()).toBe(1);

    onExitCb?.(0);

    expect(vi.getTimerCount()).toBe(0);
    expect(renderWatchStop).toHaveBeenCalled();
  });

  it("clears the watchdog timer when the ws closes", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(vi.getTimerCount()).toBe(1);

    ws.emit("close");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the watchdog timer when the ws errors", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(vi.getTimerCount()).toBe(1);

    ws.emit("error", new Error("ECONNRESET"));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills the session and closes the ws with 1011 when the watchdog elapses", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    await vi.advanceTimersByTimeAsync(1000);

    expect(kill).toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1011, "cook watchdog");
  });

  it("runs the cook spawn through the concurrency queue", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(runOnCookQueue).toHaveBeenCalledTimes(1);
    // The queue held the session creation itself, not just a wrapper around an
    // already-spawned session: this only holds if createTerminalSession happened
    // inside the function passed to runOnCookQueue.
    expect(createTerminalSession).toHaveBeenCalled();
  });

  it("never spawns a session, and frees the queue slot, when the ws closes before the queued task runs", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    // Simulate the cook still waiting for a concurrency slot: the queue accepts the
    // task but does not invoke it yet.
    let queuedTask: (() => Promise<unknown>) | undefined;
    runOnCookQueue.mockImplementationOnce((fn: () => Promise<unknown>) => {
      queuedTask = fn;
      return new Promise(() => {
        /* never settles while queued, matching a real PQueue task waiting for a slot */
      });
    });
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    expect(createTerminalSession).not.toHaveBeenCalled();

    // The socket goes away while still queued.
    ws.emit("close");

    // The queue now runs the task (as a real queue would once a slot frees up, or as
    // this test does directly to exercise the aborted-before-spawn branch).
    const settled = queuedTask?.();
    await expect(settled).resolves.toBeUndefined();
    expect(createTerminalSession).not.toHaveBeenCalled();
  });
});
