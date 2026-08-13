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
vi.mock("./session", () => ({ createTerminalSession }));

const getPlannedPostTitleById = vi.fn();
vi.mock("./resolve-post", () => ({ getPlannedPostTitleById }));

/** Mocks ws as an EventEmitter with send/close spies, matching the real `ws.WebSocket`
 *  shape closely enough for attachTerminal's `.on("message"|"close"|"error", ...)`
 *  wiring, plus the readyState/OPEN pair the setup catch block reads before closing. */
function fakeWs() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { send: vi.fn(), close: vi.fn(), readyState: 1, OPEN: 1 });
}

describe("attachTerminal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    onDataCb = undefined;
    onExitCb = undefined;
  });

  it("resolves the post's title, computes the sandbox dir, and creates a session there", async () => {
    getPlannedPostTitleById.mockResolvedValueOnce("My Great Post");
    const { attachTerminal } = await import("./ws");
    const ws = fakeWs();
    const req = { url: "/api/terminal/ws?post=abc" };

    await attachTerminal(ws as never, req as never);

    expect(getPlannedPostTitleById).toHaveBeenCalledWith("abc");
    expect(createTerminalSession).toHaveBeenCalledWith({ cwd: sandboxDir(slugify("My Great Post")) });
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
});
