/**
 * @vitest-environment jsdom
 *
 * Declared per-file, same convention as failure-strip.test.tsx: this repo's vitest
 * config defaults to the node environment and only the components that actually touch
 * the DOM (via @testing-library/react, or a hook that does) opt into jsdom.
 *
 * `@testing-library/jest-dom` isn't a dependency here either (see failure-strip.test.tsx's
 * note), so `toBeTruthy()` stands in for `toBeInTheDocument()` — `getByText` already
 * throws if nothing matches, so a plain truthy check on its result is enough.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(cleanup);

// LogsView's filter row reads/writes the URL via next/navigation (the same
// useRouter/usePathname/useSearchParams pattern feed's filter-bar.tsx uses) — real
// implementations throw "invariant expected app router to be mounted" outside an actual
// App Router tree, so a bare render() needs this stand-in, the same way failure-strip.test.tsx
// mocks the server actions it isn't the one under test here.
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/logs",
  useSearchParams: () => new URLSearchParams(),
}));

import { LogsView } from "./logs-view";
import type { LogEventRow } from "@/server/logs/store";

const rows: LogEventRow[] = [
  { id: 2, ts: "2026-07-31T10:00:00.000Z", level: "error", source: "sidecar", event: "session.invalidated", fields: { handle: "@kai" } },
  { id: 1, ts: "2026-07-31T09:00:00.000Z", level: "warn", source: "backend", event: "ratelimit.backoff", fields: {} },
];

describe("LogsView", () => {
  test("renders one row per event with its source", () => {
    render(<LogsView rows={rows} filter={{ levels: ["warn", "error"] }} />);
    expect(screen.getByText("session.invalidated")).toBeTruthy();
    expect(screen.getByText("ratelimit.backoff")).toBeTruthy();
    expect(screen.getByText("sidecar")).toBeTruthy();
  });

  test("shows an empty state when there are no rows", () => {
    render(<LogsView rows={[]} filter={{ levels: ["warn", "error"] }} />);
    expect(screen.getByText(/no log events/i)).toBeTruthy();
  });

  test("show everything writes all three levels to the URL", () => {
    replace.mockClear();
    render(<LogsView rows={rows} filter={{ levels: ["warn", "error"] }} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(replace).toHaveBeenCalledWith("/logs?levels=info%2Cwarn%2Cerror", { scroll: false });
  });

  test("checking info writes it to the URL", () => {
    replace.mockClear();
    render(<LogsView rows={rows} filter={{ levels: ["warn", "error"] }} />);
    fireEvent.click(document.getElementById("logs-level-info")!);
    expect(replace).toHaveBeenCalledWith("/logs?levels=warn%2Cerror%2Cinfo", { scroll: false });
  });
});
