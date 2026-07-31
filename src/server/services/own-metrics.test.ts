import { describe, expect, test } from "vitest";
import { computeOwnMedianReach, indexAgainstOwnMedian, type OwnPostForCalc } from "./own-metrics";

function post(id: string, reach: number | null, daysAgo: number): OwnPostForCalc {
  return { ownPostId: id, reach, postedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString() };
}

describe("computeOwnMedianReach", () => {
  test("null below the default minUsable floor of 5 measured posts", () => {
    const posts = [post("a", 100, 1), post("b", 200, 2), post("c", 300, 3), post("d", null, 4)];
    expect(computeOwnMedianReach(posts)).toBeNull();
  });

  test("a real median once 5 posts have a measured reach", () => {
    const posts = [post("a", 100, 1), post("b", 200, 2), post("c", 300, 3), post("d", 400, 4), post("e", 500, 5)];
    expect(computeOwnMedianReach(posts)).toBe(300);
  });

  test("null when the median itself is zero, never returns 0 as a real value", () => {
    const posts = Array.from({ length: 6 }, (_, i) => post(`z${i}`, 0, i));
    expect(computeOwnMedianReach(posts)).toBeNull();
  });

  test("only the trailing `window` most recent posts count", () => {
    // 5 old posts with a huge reach, well outside a window of 5, plus 5 recent ones
    // with a small reach — the median must come from the recent 5 only.
    const old = Array.from({ length: 5 }, (_, i) => post(`old${i}`, 100_000, 30 + i));
    const recent = [post("r0", 10, 0), post("r1", 20, 1), post("r2", 30, 2), post("r3", 40, 3), post("r4", 50, 4)];
    expect(computeOwnMedianReach([...old, ...recent], { window: 5 })).toBe(30);
  });

  test("a post with no measured reach yet does not count toward the sample", () => {
    const posts = [post("a", 100, 1), post("b", null, 2), post("c", 300, 3), post("d", 400, 4), post("e", 500, 5), post("f", 600, 6)];
    // 5 usable (a,c,d,e,f) clears the default minUsable even though 6 rows exist.
    expect(computeOwnMedianReach(posts)).not.toBeNull();
  });

  // B2 (review-engineering-2026-07-31.md §3): minUsable is now a parameter, not a
  // hardcoded module constant, specifically so it can move when
  // `scoreMinUsablePosts` moves. These two prove the move actually happens, in both
  // directions, against the exact same input.
  describe("minUsable moves with the caller's value, not a hardcoded constant", () => {
    const threePosts = [post("a", 100, 1), post("b", 200, 2), post("c", 300, 3)];

    test("3 measured posts is null at the default minUsable of 5", () => {
      expect(computeOwnMedianReach(threePosts)).toBeNull();
    });

    test("the same 3 measured posts produce a real median once minUsable is lowered to 3", () => {
      expect(computeOwnMedianReach(threePosts, { minUsable: 3 })).toBe(200);
    });

    test("raising minUsable above the default nulls out a sample that used to pass", () => {
      const fivePosts = [post("a", 100, 1), post("b", 200, 2), post("c", 300, 3), post("d", 400, 4), post("e", 500, 5)];
      expect(computeOwnMedianReach(fivePosts)).toBe(300); // passes at the default of 5
      expect(computeOwnMedianReach(fivePosts, { minUsable: 6 })).toBeNull(); // same posts, raised floor
    });
  });
});

describe("indexAgainstOwnMedian", () => {
  test("reach as a multiple of the median, one decimal place", () => {
    expect(indexAgainstOwnMedian(450, 300)).toBe(1.5);
  });

  test("null when reach is null", () => {
    expect(indexAgainstOwnMedian(null, 300)).toBeNull();
  });

  test("null when the median is null", () => {
    expect(indexAgainstOwnMedian(450, null)).toBeNull();
  });

  test("null when the median is zero — no division by zero dressed as a number", () => {
    expect(indexAgainstOwnMedian(450, 0)).toBeNull();
  });
});
