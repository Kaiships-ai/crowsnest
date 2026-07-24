"use client";

import Link from "next/link";
import { Bookmark, Copy, ExternalLink, MoreHorizontal, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { OutlierBadge } from "@/components/feed/outlier-badge";
import { PlatformChip, platformLabel } from "@/components/feed/platform-chip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
// Aliased: this component is also named VideoDetail (Task 7's file/export name), so
// the query-layer type needs a different local name to avoid shadowing.
import type { VideoDetail as VideoDetailData } from "@/server/queries/video";
import { MetricChips } from "./metric-chips";

export function VideoDetail({ detail }: { detail: VideoDetailData }) {
  const { item } = detail;

  async function copyLink() {
    await navigator.clipboard.writeText(item.url);
    toast.success("Link copied");
  }

  async function copyTranscript() {
    if (!detail.transcript) return;
    await navigator.clipboard.writeText(detail.transcript.text);
    toast.success("Transcript copied");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-hidden p-6">
        <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto">
          <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-lg bg-[#1E2230]">
            <div className="absolute inset-0 flex items-center justify-center">
              <Play className="size-12 text-white/25" fill="currentColor" aria-hidden />
            </div>
            <div className="absolute top-2 right-2">
              <OutlierBadge score={item.outlierScore} size="lg" />
            </div>
          </div>

          <MetricChips viewCount={item.viewCount} likeCount={detail.likeCount} commentCount={detail.commentCount} />

          <Link href={`/channels/${item.channel.id}`} className="flex items-center gap-2 hover:underline">
            <Avatar size="sm">
              <AvatarImage src={item.channel.avatarUrl ?? undefined} alt="" />
              <AvatarFallback>
                {(item.channel.displayName ?? item.channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{item.channel.handle}</span>
          </Link>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <PlatformChip platform={item.channel.platform} />
            <span>{relativeTime(item.postedAt)}</span>
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            View on {platformLabel(item.channel.platform)} <ExternalLink className="size-3.5" />
          </a>

          <div className="mt-auto flex items-center gap-2 pt-2">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="sm" disabled focusableWhenDisabled />}>
                <Bookmark className="size-3.5" /> Save to Vault
              </TooltipTrigger>
              <TooltipContent>Vault arrives in phase 3</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="sm" disabled focusableWhenDisabled />}>
                <Sparkles className="size-3.5" /> Similar
              </TooltipTrigger>
              <TooltipContent>Similar outliers arrive in phase 3</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={copyLink}>
                  <Copy /> Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyTranscript} disabled={!detail.transcript}>
                  <Copy /> Copy transcript
                </DropdownMenuItem>
                {/* Same pointer-events-none conflict as Task 5/6's disabled items —
                    explains itself on click instead of a hover tooltip that can't fire. */}
                <DropdownMenuItem
                  className="text-muted-foreground"
                  onClick={() => toast.info("Copy as prompt arrives in phase 3")}
                >
                  Copy as prompt
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs defaultValue="transcript" className="flex h-full flex-col">
            <TabsList>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="hook">Hook &amp; Structure</TabsTrigger>
              <TabsTrigger value="why">Why it worked</TabsTrigger>
            </TabsList>

            <TabsContent value="transcript" className="min-h-0 flex-1">
              <ScrollArea className="h-full pr-4">
                {detail.transcript ? (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.transcript.text}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No transcript yet — transcription arrives with the phase-2A sync engine
                  </p>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="hook" className="pt-4">
              <Card>
                <CardContent className="text-sm text-muted-foreground">AI analysis lands in phase 3</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="why" className="pt-4">
              <Card>
                <CardContent className="text-sm text-muted-foreground">AI analysis lands in phase 3</CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/95 p-4 backdrop-blur">
        <Link href={`/feed/${item.videoId}/remix`} className={cn(buttonVariants({ variant: "default" }))}>
          Remix this video →
        </Link>
      </div>
    </div>
  );
}
