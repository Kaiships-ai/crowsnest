import { describe, expect, test } from "vitest";
import { applyMove, commitDiff, currentFleet, groupByFleet, isDirty, pruneOverlay } from "./kanban-moves";

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

describe("pruneOverlay", () => {
  test("drops a move aimed at a fleet that was deleted", () => {
    const overlay = { a: "gone", b: "f1" };
    expect(pruneOverlay(overlay, { a: null, b: null }, ["f1"])).toEqual({ b: "f1" });
  });

  test("drops a move for a channel that is no longer on the board", () => {
    expect(pruneOverlay({ a: "f1" }, { b: null }, ["f1"])).toEqual({});
  });

  test("drops a move the server already applied", () => {
    expect(pruneOverlay({ a: "f1" }, { a: "f1" }, ["f1"])).toEqual({});
  });

  test("keeps a move to Unassigned even though null is not a fleet id", () => {
    expect(pruneOverlay({ a: null }, { a: "f1" }, ["f1"])).toEqual({ a: null });
  });

  test("never mutates the overlay it was given", () => {
    const overlay = { a: "gone" };
    pruneOverlay(overlay, { a: null }, []);
    expect(overlay).toEqual({ a: "gone" });
  });
});
