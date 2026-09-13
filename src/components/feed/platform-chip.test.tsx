/**
 * @vitest-environment jsdom
 *
 * OBS-3: platform chips must never promise a platform sync cannot ingest. ig-sync
 * only ever writes `platform: "instagram"` (sync-engine.ts), so TikTok and YouTube
 * Shorts must not be offered a real label or icon anywhere this chip renders —
 * carrying one would tell the viewer that platform is tracked when it is not.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { platformLabel, PlatformChip } from "./platform-chip";

afterEach(cleanup);

describe("platformLabel", () => {
  test("labels the one platform sync actually ingests", () => {
    expect(platformLabel("instagram")).toBe("Instagram");
  });

  test("never promises TikTok or YouTube Shorts a real label", () => {
    // Falling back to the raw string (not "TikTok" / "YouTube Shorts") is the signal
    // that no metadata backs these platforms — sync cannot write either one.
    expect(platformLabel("tiktok")).toBe("tiktok");
    expect(platformLabel("youtube_shorts")).toBe("youtube_shorts");
  });
});

describe("PlatformChip", () => {
  test("does not render TikTok or YouTube Shorts branding for any input", () => {
    render(
      <>
        <PlatformChip platform="instagram" />
        <PlatformChip platform="tiktok" />
        <PlatformChip platform="youtube_shorts" />
      </>
    );
    // Exact, case-sensitive: the honest fallback for an unmapped platform is its raw
    // value ("tiktok"), which must never be confused with the branded label a real
    // integration would carry ("TikTok").
    expect(screen.queryByText("TikTok")).toBeNull();
    expect(screen.queryByText("YouTube Shorts")).toBeNull();
    expect(screen.getByText("Instagram")).toBeTruthy();
  });
});
