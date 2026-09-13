/**
 * @vitest-environment jsdom
 *
 * OBS-1: the caption headline used to sit on a gradient scrim
 * (`linear-gradient(rgba(11,11,12,.6) 0%, rgba(11,11,12,0) 42%, rgba(11,11,12,.7) 100%)`)
 * that faded to transparent under the text, so a bright thumbnail put white text on
 * near-white and made it unreadable. The fix is a solid, opaque plate behind the text
 * instead of a gradient tuned to one thumbnail. This is a pure-CSS contrast fix with no
 * branching logic to unit test meaningfully, so the assertion locks in the
 * contrast-guaranteeing shape instead: an opaque `bg-black/NN` class (no gradient
 * `backgroundImage`, no partial fade) sized comfortably past the WCAG 4.5:1 floor even
 * against a pure-white frame.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { FeedItem } from "@/server/queries/feed";
import { OutlierCard } from "./outlier-card";

afterEach(cleanup);

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    videoId: "v1",
    url: "https://instagram.com/p/v1",
    caption: "a very bright screen recording caption",
    mediaType: "video",
    thumbnailAssetId: null,
    videoAssetId: null,
    postedAt: "2026-09-01T00:00:00.000Z",
    durationSec: 10,
    viewCount: 1000,
    outlierScore: 3.2,
    engagementRate: 0.02,
    deleted: false,
    channel: {
      id: "c1",
      handle: "@creator",
      displayName: null,
      avatarAssetId: null,
      followerCount: 500,
      platform: "instagram",
    },
    ...overrides,
  };
}

// Minimum black-plate opacity that keeps white text at >= 4.5:1 (WCAG AA, normal text)
// over a pure-white frame, i.e. the worst case (brightest possible thumbnail).
//
// Compositing opaque black at alpha over white leaves a gray background of sRGB value
// bg = 1 - alpha. Relative luminance uses the sRGB-to-linear curve:
//   L(c) = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
// White text has L = 1, so contrast = (1 + 0.05) / (L(bg) + 0.05) >= 4.5
//   => L(bg) <= 1.05 / 4.5 - 0.05 = 0.18333
//   => bg <= 1.055 * 0.18333 ** (1 / 2.4) - 0.055 ≈ 0.4653
//   => alpha >= 1 - 0.4653 ≈ 0.5347, i.e. ~53.5% black minimum.
// 50% black (a prior draft's floor) only reaches ~3.98:1 and FAILS AA; 54% is the first
// whole percent that clears it (~4.59:1), so that is the floor asserted here.
const MIN_SAFE_OPACITY_PERCENT = 54;

describe("OutlierCard caption overlay", () => {
  test("renders the caption on an opaque plate, not a gradient scrim", () => {
    render(<OutlierCard item={item()} variant="full" />);
    const caption = screen.getByText("a very bright screen recording caption");

    const opacityMatch = caption.className.match(/bg-black\/(\d+)/);
    expect(opacityMatch, `expected an opaque bg-black/NN class, got "${caption.className}"`).not.toBeNull();
    expect(Number(opacityMatch![1])).toBeGreaterThanOrEqual(MIN_SAFE_OPACITY_PERCENT);

    // No inline gradient backing (the OBS-1 regression) — the fix must not reintroduce
    // a `style` that fades under the text.
    expect(caption.getAttribute("style") ?? "").not.toMatch(/gradient/i);
  });

  test("compact variant renders no caption overlay at all", () => {
    render(<OutlierCard item={item()} variant="compact" />);
    expect(screen.queryByText("a very bright screen recording caption")).toBeNull();
  });
});
