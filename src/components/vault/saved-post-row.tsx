"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { OutlierBadge } from "@/components/feed/outlier-badge";
import { platformLabel } from "@/components/feed/platform-chip";
import { VideoThumb } from "@/components/feed/video-thumb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCompact, formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createSavedPostAction, deleteSavedPostAction } from "@/server/actions/saved-post-actions";
import type { SavedPostRow as SavedPostRowData } from "@/server/queries/saved-posts";

// Same hatch treatment as the Feed's OutlierCard (globals.css "hatching for a well
// with no data in it") so an undownloaded thumbnail reads the same way everywhere.
const THUMBNAIL_HATCH: React.CSSProperties = {
  backgroundColor: "var(--hatch-1)",
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--hatch-2) 0px, var(--hatch-2) 1px, transparent 1px, transparent 10px)",
};

/** Column widths shared with the Vault list's header row so THUMB/SAVED POST/SCORE/
 * WHY KEPT/POSTED line up (prototype vault.html line 13). */
export const VAULT_ROW_GRID = "grid grid-cols-[40px_minmax(0,1fr)_76px_112px_104px]";

/**
 * One row of the Vault's flat saved-posts list (v1-scope.md §2 Vault, prototype
 * vault.html). Score, views and the channel median are never passed in pre-computed:
 * they arrive already read live through `getSavedPosts`'s join, so this component only
 * ever renders what the server handed it, never a value frozen in local state.
 */
export function SavedPostRow({ row }: { row: SavedPostRowData }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [open, setOpen] = useState(false);
  const { item } = row;

  const metaParts = [
    item.channel.handle,
    `${formatCompact(item.viewCount)} views`,
    formatDuration(item.durationSec) || null,
    `vs ${formatCompact(row.channelMedian)}`,
  ].filter((part): part is string => Boolean(part));

  // The delete action has no soft-delete path by design (saved-post-actions.ts). Undo
  // is a frontend concern: the toast keeps this row's videoId/note and re-creates the
  // saved_posts row if the user reverses it inside the toast window.
  async function remove(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setRemoving(true);
    const result = await deleteSavedPostAction(row.id);
    setRemoving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    toast.success("Removed from Vault", {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await createSavedPostAction({ videoId: item.videoId, note: row.note ?? undefined });
          if (!restored.ok) {
            toast.error(restored.error);
            return;
          }
          router.refresh();
        },
      },
    });
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={`Open ${item.caption ?? item.channel.handle}`}
        className={cn(
          VAULT_ROW_GRID,
          "group cursor-pointer items-center gap-4 border-b border-border py-4 hover:bg-card"
        )}
      >
        <div className="relative aspect-9/16 w-10 shrink-0 overflow-hidden bg-card grayscale">
          <div aria-hidden className="absolute inset-0 opacity-40" style={THUMBNAIL_HATCH} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Play className="size-3 text-faint" fill="currentColor" aria-hidden />
          </div>
          <VideoThumb assetId={item.thumbnailAssetId} />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[17px] text-foreground">{item.caption ?? "—"}</p>
          <p className="mt-2 truncate font-mono text-2xs text-faint">{metaParts.join(" · ")}</p>
          {row.videoDeleted && (
            <p className="mt-1 font-mono text-2xs text-destructive">
              No longer on {platformLabel(item.channel.platform)}
            </p>
          )}
        </div>

        <div className="text-right">
          <OutlierBadge score={item.outlierScore} size="hero" />
        </div>

        <p
          className="truncate text-right font-mono text-2xs text-muted-foreground"
          title={row.note ?? undefined}
        >
          {row.note ?? "—"}
        </p>

        <div className="text-right">
          <span className="block font-mono text-2xs text-faint">{relativeTime(item.postedAt)}</span>
          <span
            className="mt-2 flex justify-end gap-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            // Enter/Space on "remove" fires a native click that bubbles up as a keydown
            // too (button default behavior). Stopped here so it can't also trigger the
            // row's own onKeyDown-to-open handler above.
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Link
              href={`/feed/${item.videoId}/remix`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-2xs text-muted-foreground hover:text-foreground hover:underline"
            >
              remix
            </Link>
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className="font-mono text-2xs text-muted-foreground hover:text-destructive hover:underline disabled:opacity-50"
            >
              remove
            </button>
          </span>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="line-clamp-2">{item.caption ?? item.channel.handle}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <p className="font-mono text-2xs text-faint">{metaParts.join(" · ")}</p>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Why kept</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{row.note ?? "No note."}</p>
            </div>

            {row.videoDeleted && (
              <p className="font-mono text-2xs text-destructive">
                No longer on {platformLabel(item.channel.platform)}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button render={<Link href={`/feed/${item.videoId}`} />} variant="secondary" size="sm">
              View video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
