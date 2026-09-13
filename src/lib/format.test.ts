import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { formatCompact, formatDuration, formatMultiplier, relativeTime, formatEngagementRate, plural } from "./format";

describe("formatCompact", () => {
  const cases: [number | null, string][] = [
    [null, "—"],
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [45300, "45.3K"],
    [1_050_000, "1.1M"],
    [2_400_000, "2.4M"],
  ];
  test.each(cases)("formatCompact(%p) -> %p", (input, expected) => {
    expect(formatCompact(input)).toBe(expected);
  });
});

describe("formatMultiplier", () => {
  // DESIGN.md §2.2's grid mock shows "38.0×" (trailing zero kept) and §4.2 puts the
  // badge numeral in tabular-nums specifically so magnitudes align down a card grid —
  // dropping the trailing zero would break that alignment, unlike formatCompact.
  const cases: [number | null, string][] = [
    [null, "—"],
    [12.4, "12.4×"],
    [38, "38.0×"],
    [2, "2.0×"],
  ];
  test.each(cases)("formatMultiplier(%p) -> %p", (input, expected) => {
    expect(formatMultiplier(input)).toBe(expected);
  });
});

describe("formatDuration", () => {
  const cases: [number | null, string][] = [
    [null, ""],
    [34, "0:34"],
    [95, "1:35"],
    [0, "0:00"],
    [3599, "59:59"],
  ];
  test.each(cases)("formatDuration(%p) -> %p", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("relativeTime", () => {
  const NOW = new Date("2026-07-24T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const isoAgo = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  test("just now for sub-minute deltas", () => {
    expect(relativeTime(isoAgo(10_000))).toBe("just now");
    expect(relativeTime(isoAgo(0))).toBe("just now");
  });

  test("minutes ago under an hour", () => {
    expect(relativeTime(isoAgo(5 * 60_000))).toBe("5m ago");
    expect(relativeTime(isoAgo(59 * 60_000))).toBe("59m ago");
  });

  test("hours ago under a day", () => {
    expect(relativeTime(isoAgo(2 * 3_600_000))).toBe("2h ago");
    expect(relativeTime(isoAgo(23 * 3_600_000))).toBe("23h ago");
  });

  test("days ago", () => {
    expect(relativeTime(isoAgo(3 * 86_400_000))).toBe("3d ago");
    expect(relativeTime(isoAgo(45 * 86_400_000))).toBe("45d ago");
  });
});

describe("plural", () => {
  // OBS-2: the feed result count must not always say "results" — singular count
  // gets the bare word, everything else gets the "s" suffix.
  test("1 -> singular, no suffix", () => {
    expect(plural("result", 1)).toBe("result");
  });

  test("2 -> plural, suffixed", () => {
    expect(plural("result", 2)).toBe("results");
  });

  test("0 -> plural, suffixed", () => {
    expect(plural("result", 0)).toBe("results");
  });
});

describe("formatEngagementRate", () => {
  test("a missing rate is a dash, never zero percent", () => {
    expect(formatEngagementRate(null)).toBe("—");
  });

  test("below one percent keeps two decimals, because one would double it", () => {
    // @kallaway's top post: 1200 likes plus 37 comments over 2,272,877 views.
    expect(formatEngagementRate(0.000544)).toBe("0.05%");
    expect(formatEngagementRate(0.0099)).toBe("0.99%");
  });

  test("at or above one percent a tenth is enough", () => {
    expect(formatEngagementRate(0.05)).toBe("5.0%");
    expect(formatEngagementRate(0.1234)).toBe("12.3%");
  });

  test("a real zero prints as zero, not as two decimals of nothing", () => {
    expect(formatEngagementRate(0)).toBe("0.0%");
  });
});
