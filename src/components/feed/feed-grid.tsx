"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterQuerySuffix, searchParamsFromEntries } from "@/lib/feed-filters";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { FeedListRow } from "./feed-list-row";
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
            // Comfortable is the batch's standard card ladder. Compact runs one column
            // denser at every breakpoint so noticeably more cards fit per row when
            // scanning a large feed (UI-BRIEF.md open question: "worth a compact mode
            // for scanning 200 posts?"), and OutlierCard's own compact variant drops
            // the caption overlay to match.
            compact
              ? "grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
              : "grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
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
        // Table ships its own horizontal scroller, so the min-width here is what keeps
        // five columns from crushing into each other on a phone instead of scrolling.
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20 text-right">Score</TableHead>
              <TableHead>Post</TableHead>
              <TableHead className="w-[150px]">Channel</TableHead>
              <TableHead className="w-[120px] text-right">Views</TableHead>
              <TableHead className="w-[90px] text-right">Posted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <FeedListRow key={item.videoId} item={item} onOpen={setPreviewId} />
            ))}
          </TableBody>
        </Table>
      )}

      <QuickPreviewSheet id={previewId} onClose={() => setPreviewId(null)} hrefSuffix={hrefSuffix} />
    </>
  );
}
