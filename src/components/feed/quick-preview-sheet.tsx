"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Heart, MessageCircle, Play } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoThumb } from "./video-thumb";
import { formatCompact, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVideoPreviewAction } from "@/server/queries/preview-action";
import type { VideoDetail } from "@/server/queries/video";
import { OutlierBadge } from "./outlier-badge";
import { PlatformChip } from "./platform-chip";

// Keyed by the id it was fetched for, so `loading`/`notFound` are derived from
// comparing `result.id` to the current `id` rather than tracked as separate state —
// react-hooks/set-state-in-effect flags a bare `setLoading(true)` called synchronously
// in the effect body, and a derived value is the more correct fix anyway (one fewer
// state variable that could drift out of sync with `id`).
type FetchResult = { id: string; detail: VideoDetail | null };

export function QuickPreviewSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const loading = id !== null && result?.id !== id;
  const detail = result?.id === id ? result.detail : null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getVideoPreviewAction(id).then((fetchedDetail) => {
      if (!cancelled) setResult({ id, detail: fetchedDetail });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>Quick preview</SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {loading ? (
            <>
              <Skeleton className="aspect-[9/16] w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">This video couldn&rsquo;t be found.</p>
          ) : (
            <>
              <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden rounded-lg bg-[#1E2230]">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="size-10 text-white/25" fill="currentColor" aria-hidden />
                </div>
                <VideoThumb src={detail.item.thumbnailUrl} />
                <div className="absolute left-2 top-2">
                  <PlatformChip platform={detail.item.channel.platform} />
                </div>
                <div className="absolute right-2 top-2">
                  <OutlierBadge score={detail.item.outlierScore} size="lg" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{detail.item.channel.handle}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{detail.item.caption}</p>
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="size-3.5" aria-hidden /> {formatCompact(detail.item.viewCount)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Heart className="size-3.5" aria-hidden /> {formatCompact(detail.likeCount)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="size-3.5" aria-hidden /> {formatCompact(detail.commentCount)}
                </span>
                <span>{relativeTime(detail.item.postedAt)}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-semibold">Transcript</h3>
                {detail.transcript ? (
                  <p className="line-clamp-4 text-sm text-muted-foreground">{detail.transcript.text}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No transcript yet — transcription arrives with the phase-2A sync engine
                  </p>
                )}
              </div>

              <div className="mt-auto flex gap-2 pt-2">
                <Link
                  href={`/feed/${detail.item.videoId}`}
                  className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
                >
                  Open full page
                </Link>
                <Link
                  href={`/feed/${detail.item.videoId}/remix`}
                  className={cn(buttonVariants({ variant: "default" }), "flex-1")}
                >
                  Remix
                </Link>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
