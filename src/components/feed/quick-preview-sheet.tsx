"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Heart, MessageCircle, Play, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoThumb } from "./video-thumb";
import { formatCompact, relativeTime } from "@/lib/format";
import { getVideoPreviewAction } from "@/server/queries/preview-action";
import type { VideoDetail } from "@/server/queries/video";
import { OutlierBadge } from "./outlier-badge";
import { platformLabel } from "./platform-chip";

// Keyed by the id it was fetched for, so `loading`/`notFound` are derived from
// comparing `result.id` to the current `id` rather than tracked as separate state —
// react-hooks/set-state-in-effect flags a bare `setLoading(true)` called synchronously
// in the effect body, and a derived value is the more correct fix anyway (one fewer
// state variable that could drift out of sync with `id`).
// `detail: null` with `error: false` is a resolved not-found (the row is gone);
// `error: true` is a failed/rejected read. Both resolve `loading` so the sheet
// leaves its skeletons; the render branches on `error` to tell them apart.
type FetchResult = { id: string; detail: VideoDetail | null; error: boolean };

// "Hatching for a well with no data in it" (globals.css) — same treatment as
// outlier-card.tsx and carousel-viewer.tsx, so the feed grid and the detail screen
// agree on what an empty media slot looks like. A plain object so it isn't
// reallocated on every render.
const EMPTY_WELL_HATCH: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--muted-foreground) 5%, transparent)",
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted-foreground) 16%, transparent) 0px, color-mix(in srgb, var(--muted-foreground) 16%, transparent) 1px, transparent 1px, transparent 10px)",
};

export function QuickPreviewSheet({
  id,
  onClose,
  hrefSuffix = "",
}: {
  id: string | null;
  onClose: () => void;
  /** The feed's active filter, as a `?...` query-string suffix (or `""`), appended to
   * both links below — `feed-grid.tsx` is the only caller today, and it forwards its
   * own `filterQuerySuffix(...)`. The "Open full page" link is where this matters: it
   * lands on the same filtered, ordered set the sheet was opened from
   * (multipage-fix-plan.md finding 1). The "Remix" link carries it too, but that's
   * forward-compat only for now — `/feed/[id]/remix`'s page only reads
   * `?hook=`/`?style=` and ignores filter params, so the suffix rides along inert
   * there until a remix feature actually wants it. */
  hrefSuffix?: string;
}) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const loading = id !== null && result?.id !== id;
  const detail = result?.id === id ? result.detail : null;
  const errored = result?.id === id && result.error;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getVideoPreviewAction(id)
      .then((fetchedDetail) => {
        if (!cancelled) setResult({ id, detail: fetchedDetail, error: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ id, detail: null, error: true });
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
          ) : errored ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TriangleAlert />
                </EmptyMedia>
                <EmptyTitle>This post couldn&rsquo;t be loaded. Please try again.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : !detail ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyTitle>This post couldn&rsquo;t be found.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="relative aspect-[9/16] w-full shrink-0 overflow-hidden bg-card">
                <div aria-hidden className="absolute inset-0 opacity-40" style={EMPTY_WELL_HATCH} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play className="size-10 text-muted-foreground" fill="currentColor" aria-hidden />
                </div>
                <VideoThumb assetId={detail.item.thumbnailAssetId} />
                {/* No platform chip. V1 is Instagram only, so a chip naming the platform
                    tells the reader something they already know, and this sheet opens
                    straight off a feed card where the same rule applies. */}
                <div className="absolute right-2 top-2">
                  <OutlierBadge score={detail.item.outlierScore} size="lg" />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">{detail.item.channel.handle}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{detail.item.caption}</p>
                {/* B-16: the card and the detail page both mark a soft-removed post; this
                    sheet didn't. Same marker markup as outlier-card.tsx, driven off the
                    same derived `FeedItem.deleted` flag. */}
                {detail.item.deleted && (
                  <span className="text-2xs text-destructive" data-num="1">
                    No longer on {platformLabel(detail.item.channel.platform)}
                  </span>
                )}
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
                  <p className="text-sm text-muted-foreground">No transcript yet — open the full page to transcribe</p>
                )}
              </div>

              {/* No footer here: the two actions live in the sheet's own SheetFooter
                  below, so they stay put while a long transcript scrolls under them. */}
            </>
          )}
        </div>

        {detail && (
          <SheetFooter className="flex-row gap-2 px-4 pt-0">
            {/* `nativeButton={false}` on both: these render <a>, and Base UI's Button
                assumes a real <button> otherwise and strips the anchor's semantics. */}
            <Button
              render={<Link href={`/feed/${detail.item.videoId}${hrefSuffix}`} />}
              nativeButton={false}
              data-testid="preview-open-full-page"
              variant="outline"
              className="flex-1"
            >
              Open full page
            </Button>
            <Button
              render={<Link href={`/feed/${detail.item.videoId}/remix${hrefSuffix}`} />}
              nativeButton={false}
              className="flex-1"
            >
              Remix
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
