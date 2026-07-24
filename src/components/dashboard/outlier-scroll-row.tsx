"use client";

import { useRouter } from "next/navigation";

import { OutlierCard } from "@/components/feed/outlier-card";
import type { FeedItem } from "@/server/queries/feed";

/**
 * Horizontal row of compact OutlierCards (DESIGN.md §2.1's "Today's top outliers" and
 * "Recently viewed" sections) — a plain `overflow-x-auto` flex row rather than the
 * `ScrollArea` primitive: mirrors Video Detail's `SimilarOutliers` precedent, since
 * this app's `ScrollArea` wrapper only exposes a single hardcoded vertical scrollbar
 * slot (see components/ui/scroll-area.tsx), not one swappable to horizontal from the
 * outside.
 */
export function OutlierScrollRow({ items }: { items: FeedItem[] }) {
  const router = useRouter();

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {items.map((item) => (
        <div key={item.videoId} className="w-40 shrink-0">
          <OutlierCard item={item} variant="compact" onOpen={(id) => router.push(`/feed/${id}`)} />
        </div>
      ))}
    </div>
  );
}
