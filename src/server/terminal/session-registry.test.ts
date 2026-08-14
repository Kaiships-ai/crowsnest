import { describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "./session";
import { dropCookEntry, getCookEntry, putCookEntry, setCookEntryWs, type CookEntry } from "./session-registry";

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
