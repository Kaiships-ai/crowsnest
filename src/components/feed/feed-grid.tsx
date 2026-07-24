"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import type { FeedItem } from "@/server/queries/feed";
import { FeedListRow } from "./feed-list-row";
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
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <FeedListRow key={item.videoId} item={item} onOpen={setPreviewId} />
          ))}
        </div>
      )}

      <QuickPreviewSheet id={previewId} onClose={() => setPreviewId(null)} />
    </>
  );
}
