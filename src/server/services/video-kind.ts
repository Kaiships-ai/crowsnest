/**
 * The KSA video-kind allow-list (content machine v1, task 1). A planned post can
 * optionally carry one of these eight kinds so `/ksa:cooking` and friends know which
 * video branch to route through at creation time. Nothing here is Instagram-specific —
 * it is purely a closed vocabulary the write action validates against and the read side
 * passes through unchanged.
 */
export const VIDEO_KINDS = [
  "explainer", "site-tour", "product-promo", "music-video",
  "pr-announcement", "talking-head", "slideshow", "general",
] as const;

export type VideoKind = (typeof VIDEO_KINDS)[number];

export const DEFAULT_VIDEO_KIND: VideoKind = "explainer";

export function isVideoKind(v: unknown): v is VideoKind {
  return typeof v === "string" && (VIDEO_KINDS as readonly string[]).includes(v);
}
