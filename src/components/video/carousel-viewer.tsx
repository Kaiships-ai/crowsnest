"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { VideoThumb } from "@/components/feed/video-thumb";
import { Button } from "@/components/ui/button";
import { assetUrl } from "@/lib/media-url";

// "Hatching for a well with no data in it" (globals.css) — the tokened placeholder
// fill for a slide that has nothing to show yet, replacing the old bg-[#1E2230] hex
// that predates the token system. A plain object so it isn't reallocated on render.
const EMPTY_WELL: React.CSSProperties = {
  backgroundColor: "var(--hatch-1)",
  backgroundImage: "repeating-linear-gradient(135deg, var(--hatch-2) 0px, var(--hatch-2) 1px, transparent 1px, transparent 10px)",
};

export interface CarouselChild {
  position: number;
  mediaType: "photo" | "video";
  thumbnailAssetId: string | null;
  videoAssetId: string | null;
}

/**
 * One carousel slide. Unlike the top-level post, a carousel child has no on-demand
 * download action wired up (only `downloadVideoAction(videoId)` exists, scoped to the
 * post's primary video) — so a video child with no `videoAssetId` is a real dead end
 * today. It's labeled honestly rather than given a button that would do nothing.
 */
function CarouselSlide({ child }: { child: CarouselChild }) {
  if (child.mediaType === "video") {
    const videoSrc = assetUrl(child.videoAssetId);
    if (videoSrc) {
      return (
        <video
          controls
          preload="metadata"
          playsInline
          src={videoSrc}
          poster={assetUrl(child.thumbnailAssetId) ?? undefined}
          className="h-full w-full bg-black object-contain"
        >
          Your browser does not support embedded video.
        </video>
      );
    }
    return (
      <div className="relative flex h-full w-full items-center justify-center" style={EMPTY_WELL}>
        <VideoThumb assetId={child.thumbnailAssetId} />
        <p className="relative z-10 bg-black/60 px-2 py-1 text-xs font-medium text-white">
          Video not downloaded yet
        </p>
      </div>
    );
  }

  const photoSrc = assetUrl(child.thumbnailAssetId);
  if (!photoSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-faint" style={EMPTY_WELL}>
        Image not downloaded yet
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- same-origin asset route, see media-url.ts
    <img src={photoSrc} alt="" className="h-full w-full bg-black object-contain" />
  );
}

/**
 * Carousel post viewer (DESIGN.md carousel support): children rendered in `position`
 * order, one visible at a time, with prev/next controls, a "n / total" indicator, and
 * left/right arrow-key navigation. Each child renders as an image or a video purely
 * per its own `mediaType` — a carousel can (and often does) mix both.
 *
 * Prop is named `items` rather than `children` — `react/no-children-prop` (this repo's
 * eslint config) flags passing a `children` attribute to any element, custom
 * components included, since JSX nesting is the idiomatic way to pass real children.
 */
export function CarouselViewer({ items }: { items: CarouselChild[] }) {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const lastIndex = Math.max(ordered.length - 1, 0);
  const [index, setIndex] = useState(0);
  // Clamped rather than reset via effect: if the child list shrinks/reorders on a
  // refresh, this just re-derives a valid index on the next render instead of
  // needing a set-state-in-effect to keep `index` in bounds.
  const current = Math.min(index, lastIndex);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, lastIndex));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lastIndex]);

  if (ordered.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-faint" style={EMPTY_WELL}>
        This carousel has no items.
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <CarouselSlide child={ordered[current]} />
      </div>

      {current > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label="Previous item"
          className="absolute left-2 top-1/2 -translate-y-1/2"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
        >
          <ChevronLeft className="size-4" />
        </Button>
      )}
      {current < lastIndex && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label="Next item"
          className="absolute right-2 top-1/2 -translate-y-1/2"
          onClick={() => setIndex((i) => Math.min(i + 1, lastIndex))}
        >
          <ChevronRight className="size-4" />
        </Button>
      )}

      <span data-num className="absolute right-2 bottom-2 bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {current + 1} / {ordered.length}
      </span>
    </div>
  );
}
