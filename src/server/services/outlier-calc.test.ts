import { describe, expect, test } from "vitest";
import {
  median,
  mean,
  trimmedMean,
  computeChannelBaseline,
  scoreVideosAgainstBaseline,
  selectBaselineWindow,
  medianConfidence,
  MEDIAN_CONFIDENCE_THRESHOLDS,
  type VideoForCalc,
} from "./outlier-calc";

const vid = (id: string, views: number | null, daysAgo: number): VideoForCalc => ({
  id, viewCount: views, postedAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
});

describe("median", () => {
  test("odd count", () => expect(median([1, 9, 5])).toBe(5));
  test("even count averages middle pair", () => expect(median([1, 2, 3, 10])).toBe(2.5));
});

describe("mean", () => {
  test("plain average", () => expect(mean([1, 2, 3, 10])).toBe(4));
});

describe("trimmedMean", () => {
  test("drops the top and bottom 10% before averaging", () => {
    // 10 values, 10% each side = 1 value cut from each end: drops 1 and 100.
    const values = [1, 2, 10, 20, 30, 40, 50, 60, 90, 100];
    expect(trimmedMean(values)).toBe(mean([2, 10, 20, 30, 40, 50, 60, 90]));
  });

  test("falls back to a plain mean when the trim would leave nothing", () => {
    expect(trimmedMean([1, 2, 3])).toBe(mean([1, 2, 3]));
  });
});

describe("computeChannelBaseline", () => {
  test("null when fewer than the default minUsable (5) usable videos", () => {
    expect(computeChannelBaseline([vid("a", 100, 1), vid("b", 200, 2), vid("c", 300, 3), vid("d", null, 4)])).toBeNull();
  });

  test("default options: median over the most recent 20 usable posts (the app's pre-settings behaviour)", () => {
    const vids = [vid("n", null, 0), ...Array.from({ length: 25 }, (_, i) => vid(`v${i}`, 101 + i, i + 1))];
    // most recent 20 usable → views 101..120 → median 110.5
    expect(computeChannelBaseline(vids)).toBe(110.5);
  });

  test("null when the statistic is exactly 0", () => {
    expect(computeChannelBaseline(Array.from({ length: 6 }, (_, i) => vid(`z${i}`, 0, i)))).toBeNull();
  });

  test("method: mean", () => {
    const vids = [vid("a", 100, 1), vid("b", 200, 2), vid("c", 300, 3), vid("d", 400, 4), vid("e", 500, 5)];
    expect(computeChannelBaseline(vids, { method: "mean" })).toBe(300);
  });

  test("method: trimmedMean", () => {
    const vids = Array.from({ length: 10 }, (_, i) => vid(`v${i}`, (i + 1) * 10_000, i + 1));
    expect(computeChannelBaseline(vids, { method: "trimmedMean" })).toBe(trimmedMean(vids.map((v) => v.viewCount as number)));
  });

  test("window: posts count controls how far back the baseline looks", () => {
    const vids = Array.from({ length: 8 }, (_, i) => vid(`v${i}`, (i + 1) * 100, i + 1));
    // most recent 5 by age → views 100,200,300,400,500 → median 300
    expect(computeChannelBaseline(vids, { window: { kind: "posts", count: 5 } })).toBe(300);
  });

  test("window: days excludes posts older than the cutoff", () => {
    const now = new Date("2026-07-31T00:00:00.000Z");
    const vids = [
      vid("recent1", 100, 1),
      vid("recent2", 200, 5),
      vid("recent3", 300, 10),
      vid("recent4", 400, 15),
      vid("recent5", 500, 20),
      vid("old1", 999_999, 45), // outside a 30-day window
    ];
    const baseline = computeChannelBaseline(vids, { window: { kind: "days", count: 30 }, now });
    expect(baseline).toBe(300); // median of the 5 posts inside the window; the old spike never counts
  });

  test("window: all keeps every usable post regardless of age", () => {
    const vids = Array.from({ length: 6 }, (_, i) => vid(`v${i}`, (i + 1) * 100, (i + 1) * 400));
    expect(computeChannelBaseline(vids, { window: { kind: "all" } })).toBe(median(vids.map((v) => v.viewCount as number)));
  });

  test("minUsable raises or lowers the usable-post floor", () => {
    const vids = [vid("a", 100, 1), vid("b", 200, 2), vid("c", 300, 3)];
    expect(computeChannelBaseline(vids, { minUsable: 3 })).toBe(200);
    expect(computeChannelBaseline(vids, { minUsable: 4 })).toBeNull();
  });

  test("minViewsFloor drops low-view posts before they can drag the baseline down, and before they count toward minUsable", () => {
    const vids = [
      vid("a", 1, 1),
      vid("b", 2, 2),
      vid("c", 1000, 3),
      vid("d", 1100, 4),
      vid("e", 1200, 5),
      vid("f", 1300, 6),
      vid("g", 1400, 7),
    ];
    expect(computeChannelBaseline(vids)).toBe(1100); // no floor: the two near-zero posts pull the median down from 1200
    expect(computeChannelBaseline(vids, { minViewsFloor: 500 })).toBe(1200); // floor: only the 5 real posts count
    expect(computeChannelBaseline(vids, { minViewsFloor: 500, minUsable: 6 })).toBeNull(); // floor drops it below minUsable
  });
});

describe("selectBaselineWindow", () => {
  test("returns exactly the posts computeChannelBaseline used, newest first", () => {
    const vids = Array.from({ length: 8 }, (_, i) => vid(`v${i}`, (i + 1) * 100, i + 1));
    const window = selectBaselineWindow(vids, { window: { kind: "posts", count: 5 } });

    expect(window.map((v) => v.id)).toEqual(["v0", "v1", "v2", "v3", "v4"]); // newest 5 by age
    expect(computeChannelBaseline(vids, { window: { kind: "posts", count: 5 }, minUsable: 1 })).toBe(
      median(window.map((v) => v.viewCount as number))
    );
  });

  test("drops posts below minViewsFloor and posts with a null viewCount, matching computeChannelBaseline's own filter", () => {
    const vids = [vid("a", null, 1), vid("b", 1, 2), vid("c", 100, 3)];
    // Newest first: "b" (2 days ago) sorts before "c" (3 days ago); "a" has no viewCount.
    expect(selectBaselineWindow(vids).map((v) => v.id)).toEqual(["b", "c"]);
    expect(selectBaselineWindow(vids, { minViewsFloor: 50 }).map((v) => v.id)).toEqual(["c"]);
  });

  test("empty input, or every post filtered out, returns an empty array rather than throwing", () => {
    expect(selectBaselineWindow([])).toEqual([]);
    expect(selectBaselineWindow([vid("a", null, 1), vid("b", null, 2)])).toEqual([]);
  });
});

describe("medianConfidence", () => {
  test("below the low threshold reads low", () => {
    expect(medianConfidence(0)).toBe("low");
    expect(medianConfidence(MEDIAN_CONFIDENCE_THRESHOLDS.low - 1)).toBe("low");
  });

  test("at or above low but below medium reads medium", () => {
    expect(medianConfidence(MEDIAN_CONFIDENCE_THRESHOLDS.low)).toBe("medium");
    expect(medianConfidence(MEDIAN_CONFIDENCE_THRESHOLDS.medium - 1)).toBe("medium");
  });

  test("at or above the medium threshold reads high", () => {
    expect(medianConfidence(MEDIAN_CONFIDENCE_THRESHOLDS.medium)).toBe("high");
    expect(medianConfidence(1000)).toBe("high");
  });
});

describe("scoreVideosAgainstBaseline", () => {
  const base = Array.from({ length: 19 }, (_, i) => vid(`b${i}`, 100_000, i + 2));

  test("scores against the channel baseline, 1-decimal", () => {
    const spike = vid("spike", 1_240_000, 1);
    const scores = scoreVideosAgainstBaseline([spike, ...base]);
    expect(scores.get("spike")).toBe(12.4);
    expect(scores.get("b0")).toBe(1.0);
  });

  test("null score for null views; all null when the baseline is null", () => {
    const scores = scoreVideosAgainstBaseline([vid("n", null, 1), ...base]);
    expect(scores.get("n")).toBeNull();
    const tooFew = scoreVideosAgainstBaseline([vid("a", 100, 1), vid("b", 50, 2)]);
    expect(tooFew.get("a")).toBeNull();
  });
});
