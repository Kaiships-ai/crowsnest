import { describe, expect, test } from "vitest";
import { median, computeChannelMedian, scoreVideos, type VideoForCalc } from "./outlier-calc";

const vid = (id: string, views: number | null, daysAgo: number): VideoForCalc => ({
  id, viewCount: views, postedAt: new Date(Date.now() - daysAgo * 864e5).toISOString(),
});

describe("median", () => {
  test("odd count", () => expect(median([1, 9, 5])).toBe(5));
  test("even count averages middle pair", () => expect(median([1, 2, 3, 10])).toBe(2.5));
});

describe("computeChannelMedian", () => {
  test("null when fewer than 5 usable videos", () => {
    expect(computeChannelMedian([vid("a", 100, 1), vid("b", 200, 2), vid("c", 300, 3), vid("d", null, 4)])).toBeNull();
  });
  test("ignores null-view videos, uses most recent window", () => {
    const vids = [vid("n", null, 0), ...Array.from({ length: 25 }, (_, i) => vid(`v${i}`, 101 + i, i + 1))];
    // window 20 → most recent 20 usable: views 101..120 → median 110.5
    expect(computeChannelMedian(vids)).toBe(110.5);
  });
  test("null when median is 0", () => {
    expect(computeChannelMedian(Array.from({ length: 6 }, (_, i) => vid(`z${i}`, 0, i)))).toBeNull();
  });
});

describe("scoreVideos", () => {
  const base = Array.from({ length: 19 }, (_, i) => vid(`b${i}`, 100_000, i + 2));
  test("scores against channel median, 1-decimal", () => {
    const spike = vid("spike", 1_240_000, 1);
    const scores = scoreVideos([spike, ...base]);
    expect(scores.get("spike")).toBe(12.4);
    expect(scores.get("b0")).toBe(1.0);
  });
  test("null score for null views; all null when median null", () => {
    const scores = scoreVideos([vid("n", null, 1), ...base]);
    expect(scores.get("n")).toBeNull();
    const tooFew = scoreVideos([vid("a", 100, 1), vid("b", 50, 2)]);
    expect(tooFew.get("a")).toBeNull();
  });
});
