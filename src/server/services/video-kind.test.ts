import { describe, expect, it } from "vitest";
import { VIDEO_KINDS, DEFAULT_VIDEO_KIND, isVideoKind } from "./video-kind";

describe("video-kind", () => {
  it("has the eight KSA kinds and explainer as default", () => {
    expect(VIDEO_KINDS).toEqual([
      "explainer", "site-tour", "product-promo", "music-video",
      "pr-announcement", "talking-head", "slideshow", "general",
    ]);
    expect(DEFAULT_VIDEO_KIND).toBe("explainer");
  });
  it("accepts a valid kind and rejects anything else", () => {
    expect(isVideoKind("talking-head")).toBe(true);
    expect(isVideoKind("reel")).toBe(false);
    expect(isVideoKind(null)).toBe(false);
    expect(isVideoKind(3)).toBe(false);
  });
});
