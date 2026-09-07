import { describe, expect, test } from "vitest";

import { heroTier } from "./outlier-badge";

// B-18 / FEED-17: the hero score badge rendered the identical class from 4.3x to
// 180.0x. `heroTier` is the pure tier-selection logic behind the fix — a wash below
// 5x, solid amber from 5x, bolder past 20x, quiet (no beat) below the 1.0 baseline.
describe("heroTier", () => {
  test("quiet below the 1.0 baseline, or with no score", () => {
    expect(heroTier(null)).toBe("quiet");
    expect(heroTier(0)).toBe("quiet");
    expect(heroTier(0.9)).toBe("quiet");
  });

  test("wash from 1.0 up to (not including) 5x", () => {
    expect(heroTier(1)).toBe("wash");
    expect(heroTier(4.3)).toBe("wash");
    expect(heroTier(4.999)).toBe("wash");
  });

  test("solid from 5x up to (not including) 20x", () => {
    expect(heroTier(5)).toBe("solid");
    expect(heroTier(12)).toBe("solid");
    expect(heroTier(19.9)).toBe("solid");
  });

  test("bold from 20x up", () => {
    expect(heroTier(20)).toBe("bold");
    expect(heroTier(180)).toBe("bold");
  });
});
