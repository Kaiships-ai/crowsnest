import { describe, expect, test } from "vitest";

import { decideNextAction } from "./next-action-bar";

const NOW = Date.parse("2026-09-08T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

describe("decideNextAction", () => {
  test("never synced: recommends a sync", () => {
    const a = decideNextAction({ lastSyncMs: null, nowMs: NOW, newSinceVisit: 0 });
    expect(a.href).toBe("/channels");
    expect(a.label).toMatch(/sync/i);
  });

  test("stale data (older than the threshold): recommends a sync", () => {
    const a = decideNextAction({ lastSyncMs: NOW - 48 * HOUR, nowMs: NOW, newSinceVisit: 5 });
    expect(a.href).toBe("/channels");
    expect(a.label).toMatch(/sync/i);
    // sync takes precedence over unreviewed outliers: stale data isn't trustworthy yet
    expect(a.reason).toMatch(/2 days old/);
  });

  test("fresh data with new outliers: recommends reviewing them", () => {
    const a = decideNextAction({ lastSyncMs: NOW - 2 * HOUR, nowMs: NOW, newSinceVisit: 3 });
    expect(a.href).toBe("/feed");
    expect(a.label).toContain("3");
  });

  test("fresh data, nothing new: standing browse default", () => {
    const a = decideNextAction({ lastSyncMs: NOW - 2 * HOUR, nowMs: NOW, newSinceVisit: 0 });
    expect(a.href).toBe("/feed");
    expect(a.label).toMatch(/browse/i);
  });

  test("respects a custom staleness threshold", () => {
    // 5 hours old, threshold 3h => stale
    const a = decideNextAction({ lastSyncMs: NOW - 5 * HOUR, nowMs: NOW, newSinceVisit: 0, stalenessHours: 3 });
    expect(a.href).toBe("/channels");
  });
});
