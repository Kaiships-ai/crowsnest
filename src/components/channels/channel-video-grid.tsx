"use client";

import { useRouter } from "next/navigation";
import { Film } from "lucide-react";

import { OutlierCard } from "@/components/feed/outlier-card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { FeedItem } from "@/server/queries/feed";

/**
 * Channel Detail's tab grids reuse the compact OutlierCard, but unlike the Feed page
 * there's no quick-preview Sheet here — clicking a card goes straight to the video's
 * own page, since without a router-backed onOpen the card's thumbnail is inert
 * (Task 3's OutlierCard only wires up click/keyboard handling when onOpen is passed).
 */
export function ChannelVideoGrid({
  items,
  emptyLabel,
  templateCounts,
}: {
  items: FeedItem[];
  emptyLabel: string;
  /** In Vault tab only (Task 4): videoId -> vault-item count, rendered as a
   * "N templates" thumbnail overlay chip (DESIGN.md §2.3 v0.2). */
  templateCounts?: Map<string, number>;
}) {
  const router = useRouter();

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Film />
          </EmptyMedia>
          <EmptyTitle>{emptyLabel}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 pt-4">
      {items.map((item) => {
        const count = templateCounts?.get(item.videoId);
        return (
          <OutlierCard
            key={item.videoId}
            item={item}
            variant="compact"
            onOpen={(id) => router.push(`/feed/${id}`)}
            overlayBadge={count ? `${count} template${count === 1 ? "" : "s"}` : undefined}
          />
        );
      })}
    </div>
  );
}
