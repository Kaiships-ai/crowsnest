"use client";

import { useRouter } from "next/navigation";

import { OutlierCard } from "@/components/feed/outlier-card";
import type { FeedItem } from "@/server/queries/feed";

/**
 * Channel Detail's tab grids reuse the compact OutlierCard, but unlike the Feed page
 * there's no quick-preview Sheet here — clicking a card goes straight to the video's
 * own page, since without a router-backed onOpen the card's thumbnail is inert
 * (Task 3's OutlierCard only wires up click/keyboard handling when onOpen is passed).
 */
export function ChannelVideoGrid({ items, emptyLabel }: { items: FeedItem[]; emptyLabel: string }) {
  const router = useRouter();

  if (items.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 pt-4">
      {items.map((item) => (
        <OutlierCard key={item.videoId} item={item} variant="compact" onOpen={(id) => router.push(`/feed/${id}`)} />
      ))}
    </div>
  );
}
