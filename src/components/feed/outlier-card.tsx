"use client";

import Link from "next/link";
import { Copy, ExternalLink, MoreHorizontal, Play } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCompact, formatDuration, formatEngagementRate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { OutlierBadge } from "./outlier-badge";
import { platformLabel } from "./platform-chip";
import { VideoThumb } from "./video-thumb";

// "Hatching for a well with no data in it" (globals.css). Same treatment as
// carousel-viewer.tsx's EMPTY_WELL so the feed and the detail screen agree on what an
// empty media slot looks like. A plain object so it isn't reallocated on every render.
const THUMBNAIL_HATCH: React.CSSProperties = {
  backgroundColor: "var(--hatch-1)",
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--hatch-2) 0px, var(--hatch-2) 1px, transparent 1px, transparent 10px)",
};

// Thumbnail sits desaturated at rest and only picks up color on hover/focus (prototype
// feed.html's article:hover rule: grayscale(1) contrast(1.2) brightness(1.06)) — the
// grid reads as scannable data first, photo wall second.
const THUMB_FILTER =
  "grayscale contrast-[1.06] transition-[filter] duration-150 group-hover:contrast-[1.2] group-hover:brightness-[1.06] group-focus-visible:contrast-[1.2] group-focus-visible:brightness-[1.06]";

export function OutlierCard({
  item,
  variant = "full",
  onOpen,
  overlayBadge,
  hrefSuffix = "",
}: {
  item: FeedItem;
  variant?: "full" | "compact";
  onOpen?: (id: string) => void;
  /** Optional bottom-left thumbnail overlay (e.g. Channel Detail's Vaulted tab
   * "2 templates" chip, DESIGN.md §2.3 v0.2) — mirrors the duration stamp's styling. */
  overlayBadge?: string;
  /** The feed's active filter, as a `?...` query-string suffix (or `""`). This card's
   * own Remix link is the one place it's appended — today that's forward-compat only,
   * since `/feed/[id]/remix`'s page only reads `?hook=`/`?style=` and ignores filter
   * params, so the suffix currently rides along inert. It's threaded through anyway so
   * a later remix feature that wants "the filtered set this card came from" doesn't
   * need a second prop-drilling pass. Only `feed-grid.tsx` has a real feed filter to
   * forward; other callers (similar-outliers on the detail page, the dashboard scroll
   * row, a channel's video grid) leave this at its default, unfiltered. */
  hrefSuffix?: string;
}) {
  const open = () => onOpen?.(item.videoId);
  const duration = formatDuration(item.durationSec);
  const isFull = variant === "full";

  // Clipboard writes can reject (denied permission, insecure context, etc.) — caught
  // explicitly so a failure surfaces as a toast instead of a silent unhandled
  // rejection with no user feedback (backlog item, matching the pattern already used
  // for Copy-as-Prompt handlers elsewhere in this app).
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(item.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy to clipboard — check browser permissions.");
    }
  }

  return (
    <div className="flex flex-col border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg">
      {/* Thumbnail — the primary, keyboard-accessible trigger for onOpen. */}
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
          "group relative aspect-[9/16] w-full shrink-0 overflow-hidden bg-card",
          onOpen && "cursor-pointer"
        )}
      >
        <div aria-hidden className="absolute inset-0 opacity-40" style={THUMBNAIL_HATCH} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="size-10 text-faint" fill="currentColor" aria-hidden />
        </div>
        <VideoThumb assetId={item.thumbnailAssetId} className={THUMB_FILTER} />
        {/* Hook headline overlay (prototype feed.html line 76) — the grid card's own
            caption read, full variant only so compact rows (dashboard scroll, channel
            tabs) stay uncluttered. The headline gets its own opaque backing rather than
            a page-length gradient: a gradient tuned to fade out where the text usually
            sits reads fine against a dark thumbnail and unreadable against a bright one
            (observed-bugs.md — a bright screen recording put white text on near-white).
            A solid plate behind the text is correct for every thumbnail, not just the
            one it was tuned against. */}
        {isFull && item.caption && (
          <p className="pointer-events-none absolute top-[14%] right-2 left-2 line-clamp-3 bg-black/70 px-1.5 py-1 text-sm leading-snug font-semibold text-pretty text-white backdrop-blur-sm">
            {item.caption}
          </p>
        )}
        {duration && (
          <span className="absolute right-2 bottom-2 bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white tabular-nums backdrop-blur-sm">
            {duration}
          </span>
        )}
        {overlayBadge && (
          <span className="absolute bottom-2 left-2 bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white backdrop-blur-sm">
            {overlayBadge}
          </span>
        )}
      </div>

      {/* Score is the hero: biggest, plainest read on the card, first thing under the
          thumbnail (prototype feed.html line 80). */}
      <div className={cn("flex flex-1 flex-col gap-1.5", isFull ? "p-3" : "p-2")}>
        <OutlierBadge score={item.outlierScore} size="hero" />

        {/* Supplementary mouse click-target (same action as the thumbnail above) — not
            given its own tab stop, so keyboard users reach `onOpen` via the thumbnail only. */}
        <div onClick={open} className={cn("flex flex-1 flex-col gap-1", onOpen && "cursor-pointer")}>
          <span className="text-2xs text-muted-foreground" data-num="1">
            {formatCompact(item.viewCount)} views · {formatEngagementRate(item.engagementRate)} eng
          </span>
          <span className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-2xs text-faint">
            <Link
              href={`/channels/${item.channel.id}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate hover:text-foreground hover:underline"
            >
              {item.channel.handle}
            </Link>
            <span aria-hidden>·</span>
            <span data-num="1">{formatCompact(item.channel.followerCount)} followers</span>
            <span aria-hidden>·</span>
            <span data-num="1">{relativeTime(item.postedAt)}</span>
          </span>
          {/* Instagram no longer showing this post is real history, not a reason to hide
              the card (v1-scope.md Feed AC 10) — same "no longer on <platform>" vocabulary
              as the detail page's banner, in the negative color so it reads as a warning
              rather than one more metadata line. */}
          {item.deleted && (
            <span className="text-2xs text-destructive" data-num="1">
              No longer on {platformLabel(item.channel.platform)}
            </span>
          )}
        </div>
      </div>

      {isFull && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          {/* There is no save-from-feed path — saving to Vault requires an analysis,
              which only exists on the video detail page. The old bookmark button here
              was a "Save to Vault" tooltip on a link that saved nothing (truth pass,
              v1-gap-inventory.md). The thumbnail is already a link to that page, so
              removing this doesn't remove a way to get there. */}
          <Link
            href={`/feed/${item.videoId}/remix${hrefSuffix}`}
            className={cn(buttonVariants({ variant: "secondary", size: "xs" }))}
          >
            Remix
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyLink}>
                <Copy /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}>
                <ExternalLink /> View on {platformLabel(item.channel.platform)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
