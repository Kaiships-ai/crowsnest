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

// Minimum opacity that keeps white text at >= 4.5:1 (WCAG AA, normal text) against a
// pure-white frame composited under an opaque black plate: contrast = 1.05 / (L + 0.05),
// so L must be <= 0.183, which the sRGB curve puts at ~50% black. Anything at or above
// that is safe for every thumbnail, not just dark ones.
const MIN_SAFE_OPACITY_PERCENT = 50;

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
