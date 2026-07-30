"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Play } from "lucide-react";

import { OutlierBadge } from "@/components/feed/outlier-badge";
import { VideoThumb } from "@/components/feed/video-thumb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { assetUrl } from "@/lib/media-url";
import type { VideoDetail } from "@/server/queries/video";

/**
 * DESIGN.md §2.5: the persistent left context rail (~220px) that stays visible across
 * all 5 stages — a condensed version of Video Detail's left column, plus a "View full
 * transcript" link that opens a Sheet rather than duplicating the transcript inline.
 */
export function ContextRail({ detail }: { detail: VideoDetail }) {
  const { item } = detail;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const tier = heatTier(item.outlierScore);

  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-4">
      <Link
        href={`/feed/${item.videoId}`}
        className="flex w-fit items-center gap-1 font-mono text-2xs tracking-wide text-faint uppercase hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Video Detail
      </Link>

      <span data-lab className="font-mono text-2xs text-faint uppercase">
        Reference
      </span>

      <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-none bg-card grayscale contrast-[1.06]">
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="size-8 text-white/25" fill="currentColor" aria-hidden />
        </div>
        <VideoThumb assetId={item.thumbnailAssetId} />
        <div className="absolute top-2 right-2">
          <OutlierBadge score={item.outlierScore} />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2 border-b border-border py-2 font-mono text-xs">
        <span className="tracking-wide text-faint uppercase">Score</span>
        <span data-num className={tier > 0 ? "text-score" : "text-muted-foreground"}>
          {formatMultiplier(item.outlierScore)}
        </span>
      </div>

      <Link href={`/channels/${item.channel.id}`} className="flex items-center gap-2 hover:underline">
        <Avatar size="sm">
          <AvatarImage src={assetUrl(item.channel.avatarAssetId) ?? undefined} alt="" />
          <AvatarFallback>
            {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-sm font-medium">{item.channel.handle}</span>
      </Link>

      <p className="line-clamp-4 text-sm text-muted-foreground">{item.caption}</p>

      <Button variant="outline" size="sm" onClick={() => setTranscriptOpen(true)} disabled={!detail.transcript}>
        View full transcript
      </Button>

      <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Transcript</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-full px-4 pb-4">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.transcript?.text}</p>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
