import { describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "./session";
import {
  dropCookEntry,
  flushCookInput,
  getCookEntry,
  MAX_QUEUED_INPUT,
  putCookEntry,
  setCookEntryWs,
  writeCookInput,
  type CookEntry,
} from "./session-registry";

function fakeSession(): TerminalSession {
  return {
    onData: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onExit: vi.fn(),
    kill: vi.fn(),
    pid: 123,
  };
}

function fakeEntry(overrides: Partial<CookEntry> = {}): CookEntry {
  return {
    session: fakeSession(),
    watchdog: null,
    renderWatch: null,
    runId: null,
    renderCaptured: false,
    ac: new AbortController(),
    ws: null,
    lastOutputAt: 0,
    waiting: false,
    waitingCheck: null,
    inputQueue: [],
    inputReady: false,
    inputFlush: null,
    ...overrides,
  };
}

describe("session-registry", () => {
  it("returns undefined for a postId that was never put", () => {
    expect(getCookEntry("no-such-post")).toBeUndefined();
  });

  it("put then get returns the same entry", () => {
    const entry = fakeEntry();

    putCookEntry("post-1", entry);

    expect(getCookEntry("post-1")).toBe(entry);
  });

  it("drop removes the entry so a later get returns undefined", () => {
    const entry = fakeEntry();
    putCookEntry("post-2", entry);
    expect(getCookEntry("post-2")).toBe(entry);

    dropCookEntry("post-2", entry);

    expect(getCookEntry("post-2")).toBeUndefined();
  });

  it("drop is a no-op (does not throw) for a postId that was never registered", () => {
    expect(() => dropCookEntry("never-registered", fakeEntry())).not.toThrow();
  });

  // D1 Task 5 fix round 1: a stale teardown (a placeholder that lost the reattach
  // race, or any other delayed cleanup) must never delete a *different* entry that
  // has since taken over the same postId slot -- only the exact entry it was handed.
  it("drop is identity-checked: does not remove a different entry now registered at the same postId", () => {
    const original = fakeEntry();
    putCookEntry("post-4", original);
    const replacement = fakeEntry();
    putCookEntry("post-4", replacement);

    dropCookEntry("post-4", original);

    expect(getCookEntry("post-4")).toBe(replacement);
  });

  it("drop removes the entry when it is still the one currently registered, even after other churn", () => {
    const entry = fakeEntry();
    putCookEntry("post-5", entry);

    dropCookEntry("post-5", entry);

    expect(getCookEntry("post-5")).toBeUndefined();
  });

  it("put overwrites any existing entry for the same postId", () => {
    const first = fakeEntry();
    const second = fakeEntry();
    putCookEntry("post-3", first);

    putCookEntry("post-3", second);

    expect(getCookEntry("post-3")).toBe(second);
    expect(getCookEntry("post-3")).not.toBe(first);
  });

  it("entries for different postIds are independent", () => {
    const a = fakeEntry();
    const b = fakeEntry();

    putCookEntry("post-a", a);
    putCookEntry("post-b", b);
    dropCookEntry("post-a", a);

    expect(getCookEntry("post-a")).toBeUndefined();
    expect(getCookEntry("post-b")).toBe(b);
  });

  it("setCookEntryWs swaps the entry's attached socket in place", () => {
    const entry = fakeEntry();
    const wsA = { id: "a" } as unknown as CookEntry["ws"];
    const wsB = { id: "b" } as unknown as CookEntry["ws"];

    setCookEntryWs(entry, wsA);
    expect(entry.ws).toBe(wsA);

    setCookEntryWs(entry, wsB);
    expect(entry.ws).toBe(wsB);

    setCookEntryWs(entry, null);
    expect(entry.ws).toBeNull();
  });
});

/**
 * The Cook button injects `/ksa:cooking\r` on click, and the two windows where that used
 * to be thrown away are "the pty has not spawned yet" and "the pty exists but the REPL
 * has not printed a prompt". Both are the same fix: hold the bytes, write them once the
 * cook proves it is listening.
 */
describe("writeCookInput", () => {
  it("queues input while the cook has not spawned, instead of dropping it", () => {
    const entry = fakeEntry({ session: null });

    writeCookInput(entry, "/ksa:cooking\r");

    expect(entry.inputQueue).toEqual(["/ksa:cooking\r"]);
  });

  it("queues input while the session exists but has not produced output yet", () => {
    const entry = fakeEntry();

    writeCookInput(entry, "/ksa:cooking\r");

    // A pty that exists is not a REPL that is listening.
    expect(entry.session!.write).not.toHaveBeenCalled();
    expect(entry.inputQueue).toEqual(["/ksa:cooking\r"]);
  });

  it("writes straight through once the cook is ready", () => {
    const entry = fakeEntry({ inputReady: true });

    writeCookInput(entry, "hello");

    expect(entry.session!.write).toHaveBeenCalledWith("hello");
    expect(entry.inputQueue).toEqual([]);
  });

  it("stops queueing at the ceiling rather than holding unbounded client input", () => {
    const entry = fakeEntry({ session: null });

    for (let i = 0; i < MAX_QUEUED_INPUT + 10; i++) writeCookInput(entry, `k${i}`);

    expect(entry.inputQueue).toHaveLength(MAX_QUEUED_INPUT);
    expect(entry.inputQueue[0]).toBe("k0"); // the oldest frames are the ones kept
  });
});

describe("flushCookInput", () => {
  it("drains the queue into the pty in arrival order", () => {
    const entry = fakeEntry();
    writeCookInput(entry, "first");
    writeCookInput(entry, "second");
    writeCookInput(entry, "third");

    flushCookInput(entry);

    expect((entry.session!.write as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ["first"],
      ["second"],
      ["third"],
    ]);
    expect(entry.inputQueue).toEqual([]);
  });

  it("leaves the cook writing directly afterwards", () => {
    const entry = fakeEntry();
    writeCookInput(entry, "queued");

    flushCookInput(entry);
    writeCookInput(entry, "typed later");

    expect((entry.session!.write as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ["queued"],
      ["typed later"],
    ]);
    expect(entry.inputQueue).toEqual([]);
  });

  it("clears the fallback timer it may have raced", () => {
    const timer = setTimeout(() => {}, 60_000);
    const entry = fakeEntry({ inputFlush: timer });

    flushCookInput(entry);

    expect(entry.inputFlush).toBeNull();
    clearTimeout(timer);
  });

  it("is idempotent: a second flush writes nothing more", () => {
    const entry = fakeEntry();
    writeCookInput(entry, "once");

    flushCookInput(entry);
    flushCookInput(entry);

    expect(entry.session!.write).toHaveBeenCalledTimes(1);
  });

  it("does not mark a session-less entry ready, which would make the write path drop input", () => {
    const entry = fakeEntry({ session: null });
    writeCookInput(entry, "still waiting");

    flushCookInput(entry);

    expect(entry.inputReady).toBe(false);
    expect(entry.inputQueue).toEqual(["still waiting"]);
  });
});
