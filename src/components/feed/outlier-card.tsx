"use client";

import Link from "next/link";
import { Bookmark, Copy, Eye, ExternalLink, MoreHorizontal, Play } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact, formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { OutlierBadge } from "./outlier-badge";
import { PlatformChip, platformLabel } from "./platform-chip";

// Faint diagonal hatch on the placeholder thumbnail (DESIGN.md §5) — a plain object so
// it isn't reallocated on every render.
const THUMBNAIL_HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 10px)",
};

export function OutlierCard({
  item,
  variant = "full",
  onOpen,
  overlayBadge,
}: {
  item: FeedItem;
  variant?: "full" | "compact";
  onOpen?: (id: string) => void;
  /** Optional bottom-left thumbnail overlay (e.g. Channel Detail's Vaulted tab
   * "2 templates" chip, DESIGN.md §2.3 v0.2) — mirrors the duration stamp's styling. */
  overlayBadge?: string;
}) {
  const open = () => onOpen?.(item.videoId);
  const duration = formatDuration(item.durationSec);

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
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-input hover:shadow-lg">
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
          "relative aspect-[9/16] w-full shrink-0 overflow-hidden bg-[#1E2230]",
          onOpen && "cursor-pointer"
        )}
      >
        <div aria-hidden className="absolute inset-0 opacity-40" style={THUMBNAIL_HATCH} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="size-10 text-white/25" fill="currentColor" aria-hidden />
        </div>
        <div className="absolute left-2 top-2">
          <PlatformChip platform={item.channel.platform} />
        </div>
        <div className="absolute right-2 top-2">
          <OutlierBadge score={item.outlierScore} />
        </div>
        {duration && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
            {duration}
          </span>
        )}
        {overlayBadge && (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {overlayBadge}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link
          href={`/channels/${item.channel.id}`}
          className="flex items-center gap-2 hover:underline"
        >
          <Avatar size="sm">
            <AvatarImage src={item.channel.avatarUrl ?? undefined} alt="" />
            <AvatarFallback>
              {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">{item.channel.handle}</span>
            {item.channel.followerCount !== null && (
              <span className="text-[11px] font-medium text-muted-foreground">
                {formatCompact(item.channel.followerCount)} followers
              </span>
            )}
          </span>
        </Link>

        {/* Supplementary mouse click-target (same action as the thumbnail above) — not
            given its own tab stop, so keyboard users reach `onOpen` via the thumbnail only. */}
        <div onClick={open} className={cn("flex flex-1 flex-col gap-2", onOpen && "cursor-pointer")}>
          {variant === "full" && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.caption ?? ""}</p>
          )}
          <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="size-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">{formatCompact(item.viewCount)}</span>
            <span aria-hidden>·</span>
            <span>{relativeTime(item.postedAt)}</span>
          </div>
        </div>
      </div>

      {variant === "full" && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" disabled focusableWhenDisabled aria-label="Save to Vault">
                  <Bookmark className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Vault arrives in phase 3</TooltipContent>
          </Tooltip>

          <Link
            href={`/feed/${item.videoId}/remix`}
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
