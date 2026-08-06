import { describe, expect, test } from "vitest";
import type { LogEventRow } from "@/server/logs/store";
import { firstErrorEvent } from "./run-detail";

function ev(id: number, level: LogEventRow["level"], event: string): LogEventRow {
  return { id, level, event, ts: "2026-08-06T00:00:00.000Z", source: "backend", fields: {} };
}

describe("firstErrorEvent", () => {
  test("returns the earliest error by id, ignoring info and warn", () => {
    const events = [ev(3, "error", "sync.enrich.write_failed"), ev(1, "info", "sync.started"), ev(2, "warn", "sync.retry")];
    expect(firstErrorEvent(events)?.id).toBe(3);
  });
  test("returns null when there is no error", () => {
    expect(firstErrorEvent([ev(1, "info", "sync.started"), ev(2, "warn", "sync.retry")])).toBeNull();
  });
  test("picks the lowest-id error when several exist", () => {
    expect(firstErrorEvent([ev(5, "error", "b"), ev(2, "error", "a")])?.event).toBe("a");
  });
});
