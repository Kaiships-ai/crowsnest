/**
 * @vitest-environment jsdom
 *
 * The environment is declared per-file, matching use-sync-progress.test.ts: the rest of
 * this suite runs in node, and only files that touch the DOM opt into jsdom.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ClientErrorReporter } from "./client-error-reporter";

afterEach(() => {
  // Explicit, like use-sync-progress.test.ts: this project imports its vitest helpers by
  // name rather than turning on globals, so Testing Library's own afterEach-based
  // auto-cleanup never registers. Without this, a listener mounted by an earlier test
  // stays attached to `window` and fires again on the next test's dispatched event.
  cleanup();
  vi.restoreAllMocks();
});

describe("ClientErrorReporter", () => {
  test("renders nothing", () => {
    // No jest-dom matchers are registered in this project, so assert on the raw DOM
    // rather than reach for `toBeEmptyDOMElement`.
    const { container } = render(<ClientErrorReporter />);
    expect(container.innerHTML).toBe("");
  });

  test("posts a frontend event on an unhandled rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorReporter />);

    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise: Promise.reject(new Error("boom")).catch(() => {}) as Promise<unknown>,
        reason: new Error("boom"),
      }),
    );
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("/api/logs/ingest", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.source).toBe("frontend");
    expect(body.level).toBe("error");
    expect(body.event).toBe("client.unhandledrejection");
  });

  test("posts a frontend event on a window error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorReporter />);

    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 42 }));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith("/api/logs/ingest", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.source).toBe("frontend");
    expect(body.level).toBe("error");
    expect(body.event).toBe("client.error");
    expect(body.fields).toEqual(expect.objectContaining({ message: "boom", source: "app.js", line: 42 }));
  });

  test("cleans up its listeners on unmount", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<ClientErrorReporter />);
    unmount();

    window.dispatchEvent(new ErrorEvent("error", { message: "after unmount" }));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a fetch rejection never throws out of the handler", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    render(<ClientErrorReporter />);

    expect(() => {
      window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    }).not.toThrow();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
  });
});
