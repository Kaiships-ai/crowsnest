import { describe, expect, test } from "vitest";
import { applyMove, commitDiff, currentFleet, groupByFleet, isDirty } from "./kanban-moves";

describe("applyMove", () => {
  test("records a pending target when moving away from baseline", () => {
    expect(applyMove({}, "a", "f1", "f2")).toEqual({ a: "f2" });
  });

  test("clears the entry when moved back to baseline", () => {
    expect(applyMove({ a: "f2" }, "a", "f1", "f1")).toEqual({});
  });

  test("moving to Unassigned (null) records null; back to a null baseline clears it", () => {
    expect(applyMove({}, "a", "f1", null)).toEqual({ a: null });
    expect(applyMove({ a: "f1" }, "a", null, null)).toEqual({});
  });

  test("overwrites an existing pending move", () => {
    expect(applyMove({ a: "f2" }, "a", "f1", "f3")).toEqual({ a: "f3" });
  });
});

describe("currentFleet", () => {
  test("returns the overlay target when present, else the baseline", () => {
    expect(currentFleet("f1", { a: "f2" }, "a")).toBe("f2");
    expect(currentFleet("f1", {}, "a")).toBe("f1");
  });
});

describe("isDirty / commitDiff", () => {
  test("isDirty is false for an empty overlay, true otherwise", () => {
    expect(isDirty({})).toBe(false);
    expect(isDirty({ a: "f2" })).toBe(true);
  });

  test("commitDiff turns the overlay into a Move array", () => {
    expect(commitDiff({ a: "f2", b: null })).toEqual([
      { channelId: "a", fleetId: "f2" },
      { channelId: "b", fleetId: null },
    ]);
  });
});

describe("groupByFleet", () => {
  test("groups channels into buckets by current fleet, preserving input order", () => {
    const channels = [
      { id: "a", fleetId: null },
      { id: "b", fleetId: "f1" },
      { id: "c", fleetId: "f1" },
    ];
    const groups = groupByFleet(channels, { c: null }, [null, "f1"]);
    expect(groups.get(null)).toEqual(["a", "c"]);
    expect(groups.get("f1")).toEqual(["b"]);
  });

  test("every fleet in fleetOrder gets a bucket, empty ones included", () => {
    const groups = groupByFleet([], {}, [null, "f1", "f2"]);
    expect([...groups.keys()]).toEqual([null, "f1", "f2"]);
    expect(groups.get("f2")).toEqual([]);
  });
});
