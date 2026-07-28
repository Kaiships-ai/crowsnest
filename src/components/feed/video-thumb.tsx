"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

import { assetUrl } from "@/lib/media-url";

/**
 * Real-thumbnail layer for the 9:16 placeholder boxes. Three states, all real:
 *
 *  - `assetId === null`: renders nothing. The hatch + play-glyph placeholder
 *    underneath (rendered by the caller) shows through, meaning "no image
 *    downloaded yet for this post" — an honest, non-error state.
 *  - asset present, image loads: the real `<img>`.
 *  - asset present, image FAILS to load (row references an asset whose file is
 *    missing/corrupt, or `/api/media/[id]` 404s): an explicit "unavailable"
 *    treatment. The old version did `onError → display:none`, which silently
 *    fell back to the exact same placeholder as "nothing downloaded yet" —
 *    indistinguishable from a real absence, and exactly the kind of quiet
 *    failure this rebuild exists to remove. A failed load must look different
 *    from an absent asset, not identical to it.
 *
 * `failedFor` (rather than a plain boolean) tracks *which* assetId errored, so
 * if the caller swaps in a different assetId the failed treatment doesn't
 * incorrectly persist for it.
 *
 * Plain <img>, with the existing eslint-disable: assets are served same-origin
 * by our own route handler, so next/image's remote-host allowlist buys nothing
 * here.
 */
export function VideoThumb({ assetId }: { assetId: string | null }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const src = assetUrl(assetId);

  if (!src) return null;

  if (failedFor === assetId) {
    return (
      <div
        role="img"
        aria-label="Thumbnail unavailable"
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-destructive/10 text-destructive"
      >
        <ImageOff className="size-6" aria-hidden />
        <span className="text-[11px] font-medium">Unavailable</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => setFailedFor(assetId)}
    />
  );
}
