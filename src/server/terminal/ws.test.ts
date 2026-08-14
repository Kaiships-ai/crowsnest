import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sandboxDir, slugify } from "@/server/studio/paths";

const write = vi.fn();
const resize = vi.fn();
const kill = vi.fn();
let onDataCb: ((s: string) => void) | undefined;
let onExitCb: ((code: number) => void) | undefined;

const createTerminalSession = vi.fn(() => ({
  pid: 4321,
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

// D1 create-run tracking: ws.ts claims a create_runs row when the cook spawns and
// updates it as the cook progresses. Defaults to a happy-path ok result so every
// existing test (none of which care about the run wiring) still exercises the real
// call site without needing to stub it individually.
const startCreateRunAction = vi.fn(async (input: { postId: string; slug: string }) => {
  void input;
  return { ok: true as const, runId: "run-1" };
});
vi.mock("@/server/actions/create-run-actions", () => ({
  startCreateRunAction: (input: { postId: string; slug: string }) => startCreateRunAction(input),
}));

const updateCreateRun = vi.fn();
const getCreateRun = vi.fn((_id: string) => ({ status: "running" }));
// D1 Task 5: the reattach path reads the latest run for a post to report its status to
// a newly-attached socket. Defaults to null (no prior run) so every existing test
// (none of which reattach) is unaffected; reattach-specific tests override this.
const getLatestCreateRunForPost = vi.fn((_postId: string) => null as { id: string; status: string } | null);
vi.mock("@/server/queries/create-runs", () => ({
  updateCreateRun: (...args: never[]) => updateCreateRun(...args),
  getCreateRun: (id: string) => getCreateRun(id),
  getLatestCreateRunForPost: (postId: string) => getLatestCreateRunForPost(postId),
}));

// D1 Task 5: a real Map-backed fake, not just vi.fn() stubs, so the reattach test can
// exercise genuine put/get roundtrip semantics (a second attach for the same postId
// must see the first attach's entry). Cleared in afterEach so postId "abc" -- reused
// by nearly every test in this file -- never leaks a registered cook from one test
// into the next and accidentally takes the reattach branch instead of spawning fresh.
const cookRegistry = new Map<string, unknown>();
const getCookEntry = vi.fn((postId: string) => cookRegistry.get(postId));
const putCookEntry = vi.fn((postId: string, entry: unknown) => {
  cookRegistry.set(postId, entry);
});
// Identity-checked, mirroring the real implementation (D1 Task 5 fix round 1): only
// deletes when the registry still holds this exact entry, so a stale/aborted-while-
// queued teardown can never clobber a different, newer registration for the same
// postId.
const dropCookEntry = vi.fn((postId: string, entry: unknown) => {
  if (cookRegistry.get(postId) === entry) {
    cookRegistry.delete(postId);
  }
});
const setCookEntryWs = vi.fn((entry: { ws: unknown }, ws: unknown) => {
  entry.ws = ws;
});
vi.mock("./session-registry", () => ({
  getCookEntry: (postId: string) => getCookEntry(postId),
  putCookEntry: (postId: string, entry: unknown) => putCookEntry(postId, entry),
  dropCookEntry: (postId: string, entry: unknown) => dropCookEntry(postId, entry),
  setCookEntryWs: (entry: { ws: unknown }, ws: unknown) => setCookEntryWs(entry, ws),
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
    startCreateRunAction.mockImplementation(async () => ({ ok: true as const, runId: "run-1" }));
    getCreateRun.mockImplementation(() => ({ status: "running" }));
    getLatestCreateRunForPost.mockImplementation(() => null);
    cookRegistry.clear();
  });

  // Flushes the microtask queue so the fire-and-forget `startCreateRunAction(...).then(...)`
  // chain in ws.ts (deliberately not awaited by attachTerminal, so the sync
  // onData/onExit/watchdog wiring is never delayed by it) has settled before assertions run.
  const flush = () => new Promise((r) => setTimeout(r, 0));

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

  it("does NOT kill the session when the ws closes while the cook is still running (D1 Task 5: a tab closing must not kill a running cook)", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("close");

    expect(kill).not.toHaveBeenCalled();
    // The cook stays registered so a later reattach can find it.
    expect(dropCookEntry).not.toHaveBeenCalled();
  });

  it("detaches (nulls the entry's ws) but keeps the registry entry when the ws closes", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("close");

    expect(setCookEntryWs).toHaveBeenCalledWith(expect.anything(), null);
    expect(getCookEntry("abc")).toBeDefined();
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

  it("does NOT kill the session when the ws emits an error (detach only, not a cook kill)", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("error", new Error("ECONNRESET"));

    expect(kill).not.toHaveBeenCalled();
    expect(dropCookEntry).not.toHaveBeenCalled();
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

  it("does NOT stop the render watcher when the ws closes (the cook, and its render watch, keep running headless)", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    ws.emit("close");

    expect(renderWatchStop).not.toHaveBeenCalled();
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

  it("does NOT clear the watchdog timer when the ws closes (the cook is still running and still needs it)", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(vi.getTimerCount()).toBe(1);

    ws.emit("close");

    expect(vi.getTimerCount()).toBe(1);
  });

  it("does NOT clear the watchdog timer when the ws errors", async () => {
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(vi.getTimerCount()).toBe(1);

    ws.emit("error", new Error("ECONNRESET"));

    expect(vi.getTimerCount()).toBe(1);
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
    // The placeholder this attach reserved synchronously (D1 Task 5 fix round 1) must
    // not be left registered once its task confirms it will never spawn.
    expect(getCookEntry("abc")).toBeUndefined();
  });

  // D1 Task 5 fix round 1 (Finding 1, Part B): the dedupe check alone is not enough
  // once spawning can be deferred by the concurrency queue -- two attaches for the
  // same post could both pass `getCookEntry` before either one's task ever runs and
  // both end up spawning. The fix reserves the postId with a placeholder entry
  // SYNCHRONOUSLY, before the task is even handed to the queue, so a second attach
  // that arrives while the first is still queued finds that placeholder and
  // reattaches instead of racing a second spawn.
  it("reserves the postId synchronously so a second attach while the first is still queued reattaches instead of double-spawning", async () => {
    // The queued task's promise deliberately never resolves in this test (nothing
    // makes the cook "end"), which would otherwise leave a live watchdog setTimeout
    // running past this test's lifetime; fake timers keep it inert.
    vi.useFakeTimers();
    getPlannedPostTitleById.mockResolvedValue("My Great Post");
    // Simulate both concurrency slots busy: the queue accepts the task but never
    // invokes it during this test.
    let queuedTask: (() => Promise<unknown>) | undefined;
    runOnCookQueue.mockImplementationOnce((fn: () => Promise<unknown>) => {
      queuedTask = fn;
      return new Promise(() => {
        /* never settles while queued */
      });
    });
    const { attachTerminal } = await import("./ws");
    const wsA = fakeWs();
    const wsB = fakeWs();

    await attachTerminal(wsA as never, { url: "/api/terminal/ws?post=abc" } as never);
    expect(createTerminalSession).not.toHaveBeenCalled();
    // The reservation already exists even though wsA's own task never ran.
    expect(getCookEntry("abc")).toBeDefined();

    await attachTerminal(wsB as never, { url: "/api/terminal/ws?post=abc" } as never);

    // wsB reattached to the reservation instead of queuing a second spawn.
    expect(runOnCookQueue).toHaveBeenCalledTimes(1);
    expect(createTerminalSession).not.toHaveBeenCalled();

    // Once a slot frees and the original queued task actually runs, exactly one
    // session gets created (spawning happens synchronously at the top of the
    // executor, so this is observable without awaiting the returned promise, which
    // deliberately does not resolve until the cook itself ends).
    void queuedTask?.();
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("claims a create_runs row when the cook spawns and sends a running run frame", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();

    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    await flush();

    expect(startCreateRunAction).toHaveBeenCalledWith({ postId: "abc", slug: slugify("My Great Post") });
    expect(updateCreateRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ pid: 4321 }));
    const call = ws.send.mock.calls.find((args: unknown[]) => JSON.parse(args[0] as string).type === "run");
    expect(call).toBeDefined();
    expect(JSON.parse((call as unknown[])[0] as string)).toEqual({ type: "run", runId: "run-1", status: "running" });
  });

  it("marks the run success and sends a run frame when a render is captured", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    await flush();

    capturedOnFound?.("/tmp/x/video.mp4");
    await flush();

    expect(updateCreateRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "success", renderAssetId: "asset-1" }),
    );
    const call = ws.send.mock.calls.find((args: unknown[]) => {
      const frame = JSON.parse(args[0] as string);
      return frame.type === "run" && frame.status === "success";
    });
    expect(call).toBeDefined();
  });

  it("marks the run failed and sends a run frame when the session exits with no render", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    await flush();

    onExitCb?.(1);

    expect(updateCreateRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "failed" }));
    const call = ws.send.mock.calls.find((args: unknown[]) => {
      const frame = JSON.parse(args[0] as string);
      return frame.type === "run" && frame.status === "failed";
    });
    expect(call).toBeDefined();
  });

  it("does not clobber a status Stop already set when the session exits after being killed", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    // Simulates the DB row Stop already moved to `canceled` (stopCreateRunAction runs
    // outside ws.ts, as a separate server action) before the killed process's exit
    // event reaches this handler.
    getCreateRun.mockImplementation(() => ({ status: "canceled" }));
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    await flush();

    onExitCb?.(null as unknown as number);

    expect(updateCreateRun).not.toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "failed" }));
    const call = ws.send.mock.calls.find((args: unknown[]) => {
      const frame = JSON.parse(args[0] as string);
      return frame.type === "run" && frame.status === "failed";
    });
    expect(call).toBeUndefined();
  });

  // D1 Task 5: a cook now lives in the session registry independent of any socket, so
  // a second attach for the same post must bind to the existing cook instead of
  // spawning a duplicate. These tests use the real Map-backed registry mock declared
  // above, not per-call vi.fn() stubs, so "the second attach sees the first attach's
  // entry" is a genuine roundtrip, not an assumption.
  it("reattaches to a live cook instead of spawning a second session, and does not start a second create_run", async () => {
    getPlannedPostTitleById.mockResolvedValue("My Great Post");
    const { attachTerminal } = await import("./ws");
    const wsA = fakeWs();
    const wsB = fakeWs();

    await attachTerminal(wsA as never, { url: "/api/terminal/ws?post=abc" } as never);
    await flush();

    getLatestCreateRunForPost.mockReturnValueOnce({ id: "run-1", status: "running" });
    await attachTerminal(wsB as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(createTerminalSession).toHaveBeenCalledTimes(1);
    expect(startCreateRunAction).toHaveBeenCalledTimes(1);
    expect(wsB.send).toHaveBeenCalledWith(JSON.stringify({ type: "run", runId: "run-1", status: "running" }));
  });

  it("relays input from the reattached socket to the original (only) session", async () => {
    getPlannedPostTitleById.mockResolvedValue("My Great Post");
    const { attachTerminal } = await import("./ws");
    const wsA = fakeWs();
    const wsB = fakeWs();
    await attachTerminal(wsA as never, { url: "/api/terminal/ws?post=abc" } as never);
    await attachTerminal(wsB as never, { url: "/api/terminal/ws?post=abc" } as never);

    wsB.emit("message", JSON.stringify({ type: "input", data: "y" }));

    expect(write).toHaveBeenCalledWith("y");
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("reattaching after a detach (ws close) does not double-spawn a session for the same post", async () => {
    getPlannedPostTitleById.mockResolvedValue("My Great Post");
    const { attachTerminal } = await import("./ws");
    const wsA = fakeWs();
    await attachTerminal(wsA as never, { url: "/api/terminal/ws?post=abc" } as never);
    wsA.emit("close");

    const wsB = fakeWs();
    await attachTerminal(wsB as never, { url: "/api/terminal/ws?post=abc" } as never);

    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("drops the registry entry when the session exits", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    await attachTerminal(ws as never, { url: "/api/terminal/ws?post=abc" } as never);
    expect(getCookEntry("abc")).toBeDefined();

    onExitCb?.(0);

    expect(dropCookEntry).toHaveBeenCalledWith("abc", expect.anything());
    expect(getCookEntry("abc")).toBeUndefined();
  });
});
