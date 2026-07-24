import { describe, expect, test } from "vitest";
import { followerBandOf, heatTier, type HeatTier } from "./heat";

describe("heatTier", () => {
  const cases: [number | null, HeatTier][] = [
    [null, 0],
    [0, 0],
    [1.9, 0],
    [2, 1],
    [4.9, 1],
    [5, 2],
    [9.9, 2],
    [10, 3],
    [19.9, 3],
    [20, 4],
    [100, 4],
  ];
  test.each(cases)("heatTier(%p) -> tier %p", (input, expected) => {
    expect(heatTier(input)).toBe(expected);
  });
});

describe("followerBandOf", () => {
  const cases: [number | null, "nano" | "micro" | "mid" | "macro" | null][] = [
    [null, null],
    [0, "nano"],
    [9_999, "nano"],
    [10_000, "micro"],
    [99_999, "micro"],
    [100_000, "mid"],
    [999_999, "mid"],
    [1_000_000, "macro"],
    [5_000_000, "macro"],
  ];
  test.each(cases)("followerBandOf(%p) -> %p", (input, expected) => {
    expect(followerBandOf(input)).toBe(expected);
  });
});
