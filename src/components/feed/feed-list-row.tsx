"use client";

import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatCompact, relativeTime } from "@/lib/format";
import type { FeedItem } from "@/server/queries/feed";
import { OutlierBadge } from "./outlier-badge";

/** Table-like list-view row (DESIGN.md §2.2): 40px thumbnail, badge, caption, channel, views, date. */
export function FeedListRow({ item, onOpen }: { item: FeedItem; onOpen?: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onOpen?.(item.videoId)}
        aria-label={`Preview ${item.caption ?? item.channel.handle}`}
        className="h-10 w-10 shrink-0 rounded-md bg-[#1E2230]"
      />

      <div className="w-16 shrink-0">
        <OutlierBadge score={item.outlierScore} />
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(item.videoId)}
        className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
      >
        {item.caption ?? "—"}
      </button>

      <Link href={`/channels/${item.channel.id}`} className="flex w-40 shrink-0 items-center gap-2 hover:underline">
        <Avatar size="sm">
          <AvatarImage src={item.channel.avatarUrl ?? undefined} alt="" />
          <AvatarFallback>
            {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sm">{item.channel.handle}</span>
      </Link>

      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {formatCompact(item.viewCount)}
      </span>
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{relativeTime(item.postedAt)}</span>
    </div>
  );
}
