import { describe, expect, test } from "vitest";
import { perViewerRate, selectReel, shapeReelInsights, type OwnReelSnapshot } from "./reel-insights";

const SNAP: OwnReelSnapshot = { capturedAt: "2026-09-29T10:00:00.000Z", views: 120000, reach: 80997, likes: 900, comments: 40, shares: 1112, saved: 300, reposts: 20, followsFromPost: 12, profileVisits: 50, bioLinkTaps: 7, avgWatchTimeMs: 4500, skipRate: 0.42, fetchError: null };

describe("perViewerRate (ACTION-20)", () => {
  test("metric over reach; null when reach is 0 or null or the metric is null", () => {
    expect(perViewerRate(1112, 80997)).toBeCloseTo(0.01373, 4);
    expect(perViewerRate(5, 0)).toBeNull();
    expect(perViewerRate(5, null)).toBeNull();
    expect(perViewerRate(null, 100)).toBeNull();
  });
});

describe("shapeReelInsights (ACTION-21)", () => {
  test("blocks in the Instagram app's order, watch time in seconds, skip rate passed through as estimated", () => {
    const s = shapeReelInsights(SNAP);
    expect(s.summary.map((i) => i.label)).toEqual(["Views", "Viewers", "Average watch time", "Follows"]);
    expect(s.summary[2]).toEqual({ label: "Average watch time", value: 4.5, unit: "seconds" });
    expect(s.interactions.map((i) => i.label)).toEqual(["Likes", "Comments", "Reposts", "Shares", "Saves"]);
    expect(s.impact.map((i) => i.label)).toEqual(["Skip rate", "Share rate", "Like rate", "Save rate", "Repost rate", "Comment rate"]);
    expect(s.impact[0]).toEqual({ label: "Skip rate", value: 0.42, estimated: true });
    expect(s.impact.slice(1).every((i) => !i.estimated)).toBe(true);
    expect(s.actions.map((i) => i.label)).toEqual(["Follows", "Profile visits", "Bio link taps"]);
  });
  test("reach 0 makes every derived rate null but keeps skip rate", () => {
    const s = shapeReelInsights({ ...SNAP, reach: 0 });
    expect(s.impact.slice(1).every((i) => i.value === null)).toBe(true);
    expect(s.impact[0].value).toBe(0.42);
  });
});

describe("selectReel (ACTION-19 fallback)", () => {
  const reels = [{ ownPostId: "newest" }, { ownPostId: "second" }];
  test("the param when it matches, else the newest, else null", () => {
    expect(selectReel(reels, "second")?.ownPostId).toBe("second");
    expect(selectReel(reels, undefined)?.ownPostId).toBe("newest");
    expect(selectReel(reels, "does-not-exist")?.ownPostId).toBe("newest");
    expect(selectReel([], "x")).toBeNull();
  });
});
