"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { filterQuerySuffix, searchParamsFromEntries } from "@/lib/feed-filters";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { FEED_LIST_ROW_GRID, FeedListRow } from "./feed-list-row";
import { OutlierCard } from "./outlier-card";
import { QuickPreviewSheet } from "./quick-preview-sheet";

export function FeedGrid({ items }: { items: FeedItem[] }) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "list" ? "list" : "grid";
  // Same read as FilterBar's `density` (default "comfortable" when the param is
  // absent) — kept independent rather than threaded down as a prop since both this
  // component and FilterBar read the URL directly for their own concerns already.
  const compact = searchParams.get("density") === "compact";
  // The feed's active filter (and sort), forwarded into the detail/remix hrefs below
  // so the detail page's prev/next and index label resolve against this same
  // filtered, ordered set instead of the full library (multipage-fix-plan.md finding
  // 1). `filterQuerySuffix` is the same builder feed/[videoId]/resolve-feed-nav.ts
  // uses server-side, so a link built here and a suffix rebuilt there never drift.
  // `searchParamsFromEntries` (not `Object.fromEntries`) keeps the FIRST value of a
  // repeated key, matching the server's `first()` semantics (finding M4).
  const hrefSuffix = filterQuerySuffix(searchParamsFromEntries(searchParams.entries()));
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <>
      {view === "grid" ? (
        <div
          className={cn(
            "grid",
            // Comfortable keeps the brief's 240px floor; compact packs a smaller,
            // 160px floor so noticeably more cards fit per row when scanning a large
            // feed (UI-BRIEF.md open question: "worth a compact mode for scanning 200
            // posts?") — same column-packing mechanism, just a smaller minimum.
            compact
              ? "grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
              : "grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5"
          )}
        >
          {items.map((item) => (
            <OutlierCard
              key={item.videoId}
              item={item}
              variant={compact ? "compact" : "full"}
              onOpen={setPreviewId}
              hrefSuffix={hrefSuffix}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          <div
            data-lab="1"
            className={`${FEED_LIST_ROW_GRID} gap-4 border-b border-border pb-3 text-2xs text-muted-foreground`}
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

      <QuickPreviewSheet id={previewId} onClose={() => setPreviewId(null)} hrefSuffix={hrefSuffix} />
    </>
  );
}
