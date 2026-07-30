"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import type { FeedItem } from "@/server/queries/feed";
import { FEED_LIST_ROW_GRID, FeedListRow } from "./feed-list-row";
import { OutlierCard } from "./outlier-card";
import { QuickPreviewSheet } from "./quick-preview-sheet";

export function FeedGrid({ items }: { items: FeedItem[] }) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "list" ? "list" : "grid";
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <>
      {view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {items.map((item) => (
            <OutlierCard key={item.videoId} item={item} variant="full" onOpen={setPreviewId} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          <div
            data-lab="1"
            className={`${FEED_LIST_ROW_GRID} gap-4 border-b border-border pb-3 text-2xs text-faint`}
          >
            <span className="text-right">Score</span>
            <span className="pl-2">Post</span>
            <span>Channel</span>
            <span className="text-right">Views</span>
            <span className="text-right">Posted</span>
          </div>
          {items.map((item) => (
            <FeedListRow key={item.videoId} item={item} onOpen={setPreviewId} />
          ))}
        </div>
      )}

      <QuickPreviewSheet id={previewId} onClose={() => setPreviewId(null)} />
    </>
  );
}
