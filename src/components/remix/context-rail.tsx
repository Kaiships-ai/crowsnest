"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Play } from "lucide-react";

import { OutlierBadge } from "@/components/feed/outlier-badge";
import { VideoThumb } from "@/components/feed/video-thumb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMultiplier } from "@/lib/format";
import { heatTier } from "@/lib/heat";
import { assetUrl } from "@/lib/media-url";
import { cn } from "@/lib/utils";
import type { VideoDetail } from "@/server/queries/video";

/**
 * DESIGN.md §2.5: the persistent left context rail (~220px) that stays visible across
 * all 5 stages — a condensed version of Video Detail's left column, plus a "View full
 * transcript" link that opens a Sheet rather than duplicating the transcript inline.
 *
 * Below `lg` the studio stacks, so the rail becomes a full-width band above the stage
 * and its reference card lays its media out beside the facts instead of above them —
 * a 9:16 thumbnail at phone width would otherwise take the whole first screen.
 */
export function ContextRail({ detail }: { detail: VideoDetail }) {
  const { item } = detail;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const tier = heatTier(item.outlierScore);

  return (
    <div className="flex w-full shrink-0 flex-col gap-3 border-b border-border p-4 lg:w-[220px] lg:overflow-y-auto lg:border-r lg:border-b-0">
      <Link
        href={`/feed/${item.videoId}`}
        className="flex w-fit items-center gap-1 font-mono text-2xs tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> Post detail
      </Link>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Reference</CardTitle>
        </CardHeader>

        <CardContent className="flex gap-3 lg:flex-col">
          <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-lg bg-muted grayscale contrast-[1.06] lg:w-full">
            <div className="absolute inset-0 flex items-center justify-center">
              <Play className="size-8 text-white/25" fill="currentColor" aria-hidden />
            </div>
            <VideoThumb assetId={item.thumbnailAssetId} />
            <div className="absolute top-2 right-2">
              <OutlierBadge score={item.outlierScore} />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ItemGroup>
              <Item size="xs">
                <ItemContent>
                  <ItemTitle>Score</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <span data-num className={cn("font-mono", tier > 0 ? "text-primary" : "text-muted-foreground")}>
                    {formatMultiplier(item.outlierScore)}
                  </span>
                </ItemActions>
              </Item>

              <Item size="xs" render={<Link href={`/channels/${item.channel.id}`} />}>
                <ItemMedia>
                  <Avatar size="sm">
                    <AvatarImage src={assetUrl(item.channel.avatarAssetId) ?? undefined} alt="" />
                    <AvatarFallback>
                      {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="block truncate">{item.channel.handle}</ItemTitle>
                </ItemContent>
              </Item>
            </ItemGroup>

            <p className="line-clamp-4 text-sm text-muted-foreground">{item.caption}</p>
          </div>
        </CardContent>

        <CardFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTranscriptOpen(true)}
            disabled={!detail.transcript}
            className="w-full"
          >
            View full transcript
          </Button>
        </CardFooter>
      </Card>

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
