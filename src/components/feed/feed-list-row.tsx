"use client";

import Link from "next/link";

import { formatCompact, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { OutlierBadge } from "./outlier-badge";

/** Column widths shared with FeedGrid's header row so SCORE/POST/CHANNEL/VIEWS/POSTED
 * line up between the two (prototype feed.html lines 93 and 95). */
export const FEED_LIST_ROW_GRID = "grid grid-cols-[80px_minmax(200px,1fr)_minmax(0,150px)_minmax(0,120px)_minmax(0,90px)]";

/**
 * Table-like list-view row (DESIGN.md §2.2). The prototype's list view (feed.html
 * line 91-104) carries no thumbnail at all — it's a plain data table — so the whole
 * row is the click target for the quick-preview Sheet, matching its `data-row`
 * pattern, rather than a separate thumbnail button.
 */
export function FeedListRow({ item, onOpen }: { item: FeedItem; onOpen?: (id: string) => void }) {
  const open = () => onOpen?.(item.videoId);

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      aria-label={onOpen ? `Preview ${item.caption ?? item.channel.handle}` : undefined}
      className={cn(
        FEED_LIST_ROW_GRID,
        "min-h-14 items-center gap-4 border-b border-border",
        onOpen && "cursor-pointer hover:bg-card"
      )}
    >
      <div className="text-right">
        <OutlierBadge score={item.outlierScore} size="hero" />
      </div>

      <span className="truncate pl-2 text-sm text-foreground">
        {item.caption ?? "—"}
        {/* Same "gone" marker as the grid card (v1-scope.md Feed AC 10) — a removed post
            stays in the list, it just says so, in the negative color. */}
        {item.deleted && <span className="ml-2 text-2xs text-destructive">removed</span>}
      </span>

      <Link
        href={`/channels/${item.channel.id}`}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 truncate text-xs text-faint hover:text-foreground hover:underline"
      >
        {item.channel.handle}
      </Link>

      <span className="text-right text-sm text-muted-foreground tabular-nums" data-num="1">
        {formatCompact(item.viewCount)}
      </span>
      <span className="text-right text-2xs text-faint" data-num="1">
        {relativeTime(item.postedAt)}
      </span>
    </div>
  );
}
