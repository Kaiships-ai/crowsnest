import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { MedianBasis } from "@/server/queries/channels";
import { MedianBaseline, methodLabel, scalePosition, windowLabel } from "./median-baseline";

/**
 * `median-baseline.tsx` is a pure presentational component (no client hooks), so it's
 * exercised through `react-dom/server` the same way `sync-progress-panel.test.tsx`
 * does — no jsdom/testing-library needed for "which state is on screen, and what does
 * it say."
 */

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function basis(overrides: Partial<MedianBasis> = {}): MedianBasis {
  return {
    channelId: "chan-1",
    handle: "@creator",
    median: 10_000,
    method: "median",
    sampleSize: 15,
    minUsable: 5,
    window: { kind: "posts", count: 12 },
    spanFrom: "2026-06-01T00:00:00.000Z",
    spanTo: "2026-06-30T00:00:00.000Z",
    bars: [
      { videoId: "v1", postedAt: "2026-06-01T00:00:00.000Z", viewCount: 5_000, isSelf: false },
      { videoId: "v2", postedAt: "2026-06-15T00:00:00.000Z", viewCount: 40_000, isSelf: true },
      { videoId: "v3", postedAt: "2026-06-30T00:00:00.000Z", viewCount: 10_000, isSelf: false },
    ],
    ...overrides,
  };
}

describe("scalePosition", () => {
  test("1.0x sits at ~39.3% on the 0.2x-12x log scale — matches the prototype's hardcoded tick", () => {
    expect(scalePosition(1)).toBeCloseTo(0.393, 3);
  });

  test("the scale floor and ceiling map to 0 and 1", () => {
    expect(scalePosition(0.2)).toBeCloseTo(0, 5);
    expect(scalePosition(12)).toBeCloseTo(1, 5);
  });

  test("clamps outside the scale rather than overflowing", () => {
    expect(scalePosition(0.01)).toBeCloseTo(0, 5);
    expect(scalePosition(500)).toBeCloseTo(1, 5);
  });
});

describe("methodLabel / windowLabel", () => {
  test("every baseline method has a distinct label", () => {
    expect(methodLabel("median")).toBe("median");
    expect(methodLabel("mean")).toBe("mean");
    expect(methodLabel("trimmedMean")).toBe("trimmed mean");
  });

  test("every window kind has a distinct label", () => {
    expect(windowLabel({ kind: "posts", count: 12 })).toContain("12 posts");
    expect(windowLabel({ kind: "days", count: 30 })).toContain("30 days");
    expect(windowLabel({ kind: "all" })).toContain("all of its history");
  });
});

describe("MedianBaseline", () => {
  test("below minUsable: a real sample size and no fabricated baseline, no bars", () => {
    const html = render(
      <MedianBaseline score={null} handle="@creator" basis={basis({ median: null, sampleSize: 3, minUsable: 5 })} />
    );
    const t = text(html);
    expect(t).toContain("Not enough of @creator’s posts yet");
    expect(t).toContain("3");
    expect(t).toContain("5");
    // No histogram, no bar-scale legend, for a channel with no baseline.
    expect(t).not.toContain("What that median is made of");
    expect(t).not.toContain("0.2×");
  });

  test("normal state: method and window are named, not hardcoded to \"median\"", () => {
    const html = render(
      <MedianBaseline
        score={3.5}
        handle="@creator"
        basis={basis({ method: "trimmedMean", window: { kind: "days", count: 30 } })}
      />
    );
    const t = text(html);
    expect(t).toContain("above @creator’s own trimmed mean");
    expect(t).toContain("the last 30 days");
    expect(t).toContain("What that trimmed mean is made of · @creator");
  });

  test("the sample size printed next to the histogram matches the bar count", () => {
    const b = basis();
    const html = render(<MedianBaseline score={4} handle="@creator" basis={b} />);
    const t = text(html);
    expect(t).toContain(`${b.sampleSize} posts sampled`);
  });

  test("the self post's bar is called out by name", () => {
    const html = render(<MedianBaseline score={4} handle="@creator" basis={basis()} />);
    expect(text(html)).toContain("this post · 40K");
  });

  test("channel row vanished: a dash state, not a crash", () => {
    const html = render(<MedianBaseline score={null} handle="@creator" basis={null} />);
    expect(text(html)).toContain("No channel data to measure this against.");
  });

  test("hero score is amber only at or above 1.0x, matching the feed card's rule", () => {
    // The histogram highlights whichever bar is "this post" in the same amber token
    // regardless of the hero's own state, so the hero span itself (not the whole
    // markup) is what has to flip color at the 1.0x boundary.
    const below = render(<MedianBaseline score={0.8} handle="@creator" basis={basis()} />);
    const atOrAbove = render(<MedianBaseline score={1} handle="@creator" basis={basis()} />);
    expect(below).toContain('text-foreground">0.8×');
    expect(atOrAbove).toContain('text-primary">1.0×');
  });
});
