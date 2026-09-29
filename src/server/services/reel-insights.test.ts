import { describe, expect, test } from "vitest";
import { hoursSincePosted, perViewerRate, selectReel, shapeReelInsights, typicalViewsCurve, type OwnReelSnapshot } from "./reel-insights";

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
  test("follows and profile visits are marked not reported for reels, never a stored number", () => {
    const s = shapeReelInsights(SNAP);
    expect(s.summary[3]).toEqual({ label: "Follows", value: null, notReported: true });
    expect(s.actions.slice(0, 2)).toEqual([{ label: "Follows", value: null, notReported: true }, { label: "Profile visits", value: null, notReported: true }]);
    expect(s.actions[2]).toEqual({ label: "Bio link taps", value: 7 });
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

  test("B-17: also matches the Graph media id, which auto-publish stores as publishedOwnPostId", () => {
    const withIds = [{ ownPostId: "newest", externalId: "g1" }, { ownPostId: "second", externalId: "g2" }];
    expect(selectReel(withIds, "g2")?.ownPostId).toBe("second");
  });
});

describe("typicalViewsCurve (ACTION-24)", () => {
  const T = Date.parse("2026-09-20T00:00:00.000Z");
  const at = (ms: number) => new Date(T + ms).toISOString();
  const H = 3_600_000;
  const posted = at(0);
  const history = [
    { ownPostId: "A", postedAt: posted, capturedAt: at(H + 10 * 60_000), views: 100 },
    { ownPostId: "A", postedAt: posted, capturedAt: at(2 * H), views: 180 },
    { ownPostId: "A", postedAt: posted, capturedAt: at(5 * H), views: 400 },
    { ownPostId: "B", postedAt: posted, capturedAt: at(H), views: 50 },
    { ownPostId: "B", postedAt: posted, capturedAt: at(2 * H), views: 70 },
    { ownPostId: "C", postedAt: posted, capturedAt: at(H + 30 * 60_000), views: 90 },
    { ownPostId: "C", postedAt: posted, capturedAt: at(2 * H + 59 * 60_000), views: 110 },
  ];
  test("real points only, whole hours, median of the other reels, gap where none measured", () => {
    expect(typicalViewsCurve("A", history)).toEqual([
      { hour: 1, views: 100, typical: 70 },
      { hour: 2, views: 180, typical: 90 },
      { hour: 5, views: 400, typical: null },
    ]);
  });
  test("the latest snapshot in an hour bucket wins; the selected reel never feeds its own line", () => {
    const dup = [...history, { ownPostId: "B", postedAt: posted, capturedAt: at(H + 50 * 60_000), views: 60 }];
    expect(typicalViewsCurve("A", dup)[0]).toEqual({ hour: 1, views: 100, typical: 75 });
    expect(typicalViewsCurve("B", history).every((p) => p.views === null || [50, 70].includes(p.views))).toBe(true);
  });
  test("no snapshots for the selected reel yields no points", () => {
    expect(typicalViewsCurve("Z", history)).toEqual([]);
  });
  test("hours stop at the 168-hour window", () => {
    const long = [
      { ownPostId: "A", postedAt: posted, capturedAt: at(H), views: 1 },
      { ownPostId: "A", postedAt: posted, capturedAt: at(167 * H), views: 2 },
      { ownPostId: "A", postedAt: posted, capturedAt: at(900 * H), views: 3 },
      { ownPostId: "B", postedAt: posted, capturedAt: at(500 * H), views: 4 },
    ];
    expect(typicalViewsCurve("A", long)).toEqual([
      { hour: 1, views: 1, typical: null },
      { hour: 167, views: 2, typical: null },
    ]);
  });
  test("hoursSincePosted floors", () => {
    expect(hoursSincePosted(posted, at(H + 59 * 60_000))).toBe(1);
  });
});
