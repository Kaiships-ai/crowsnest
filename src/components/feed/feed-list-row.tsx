"use client";

import Link from "next/link";

import { TableCell, TableRow } from "@/components/ui/table";
import { formatCompact, relativeTime } from "@/lib/format";
import type { FeedItem } from "@/server/queries/feed";
import { OutlierBadge } from "./outlier-badge";

/**
 * One row of the list view's table (DESIGN.md §2.2). The prototype's list view
 * (feed.html line 91-104) carries no thumbnail at all, it is a plain data table, so
 * the whole row is the click target for the quick-preview Sheet rather than a separate
 * thumbnail button. Column widths live on FeedGrid's `TableHead`s, the one place they
 * need stating now that the header and the rows share a real `<table>`.
 */
export function FeedListRow({ item, onOpen }: { item: FeedItem; onOpen?: (id: string) => void }) {
  return (
    <TableRow
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(item.videoId)}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(item.videoId);
        }
      }}
      aria-label={onOpen ? `Preview ${item.caption ?? item.channel.handle}` : undefined}
      className={onOpen ? "cursor-pointer" : undefined}
    >
      <TableCell className="text-right">
        <OutlierBadge score={item.outlierScore} size="hero" />
      </TableCell>

      <TableCell className="max-w-0 truncate text-foreground">
        {item.caption ?? "—"}
        {/* Same "gone" marker as the grid card (v1-scope.md Feed AC 10) — a removed post
            stays in the list, it just says so, in the negative color. */}
        {item.deleted && <span className="ml-2 text-2xs text-destructive">removed</span>}
      </TableCell>

      <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
        <Link
          href={`/channels/${item.channel.id}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-foreground hover:underline"
        >
          {item.channel.handle}
        </Link>
      </TableCell>

      <TableCell className="text-right text-muted-foreground tabular-nums" data-num="1">
        {formatCompact(item.viewCount)}
      </TableCell>
      <TableCell className="text-right text-2xs text-muted-foreground" data-num="1">
        {relativeTime(item.postedAt)}
      </TableCell>
    </TableRow>
  );
}
