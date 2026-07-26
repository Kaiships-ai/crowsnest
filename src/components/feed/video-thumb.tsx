"use client";

/**
 * Real-thumbnail layer for the 9:16 placeholder boxes. Renders nothing when no
 * URL exists (seed rows), and hides itself if the remote image fails to load
 * (provider CDN URLs expire between syncs) — either way the hatch + play-glyph
 * placeholder underneath stays visible. Plain <img>: provider thumbnails live on
 * arbitrary remote CDNs, which next/image would require per-host config for.
 */
export function VideoThumb({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
