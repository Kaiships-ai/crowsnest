"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { phaseLabel, statusHeadline, syncViewState, type SyncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SyncProgress, SyncStatusValue } from "@/server/services/sync-types";

function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// DESIGN.md Task 7 Step 2 dot colors, verbatim.
const STATUS_DOT: Record<SyncStatusValue, string> = {
  never: "bg-muted-foreground",
  success: "bg-[#34D399]",
  running: "bg-[#E8B23D]",
  partial: "bg-[#E8B23D]",
  failed: "bg-[#F1585C]",
};

/**
 * The live view has three states DESIGN.md never named, and inventing a sixth colour for
 * them would break a palette the rest of the app matches. `cancelling` is still work in
 * flight, so it keeps running's amber. `cancelled` left channels unvisited, which is what
 * partial's amber already means. `stalled` takes failed's red on purpose: the process
 * died holding the lock, and amber would read as "still going" — the precise misreading
 * this whole pass exists to stop.
 */
const VIEW_STATE_DOT: Record<SyncViewState, SyncStatusValue> = {
  idle: "never",
  running: "running",
  cancelling: "running",
  stalled: "failed",
  cancelled: "partial",
  success: "success",
  partial: "partial",
  failed: "failed",
};

function statusLabel(status: SyncStatusValue, finishedAt: string | null): string {
  switch (status) {
    case "never":
      return "Never synced";
    case "running":
      return "Syncing…";
    case "success":
      return finishedAt ? `Synced ${relativeTime(finishedAt)}` : "Synced";
    case "partial":
      return finishedAt ? `Partial sync ${relativeTime(finishedAt)}` : "Partial sync";
    case "failed":
      return finishedAt ? `Sync failed ${relativeTime(finishedAt)}` : "Sync failed";
  }
}

/** Deliberately shorter than `statusHeadline` from sync-progress-view: this line lives in
 *  a narrow rail where "Sync finished — 12 new, 3 updated" truncates to nothing useful.
 *  The full sentence is one click away in the panel. */
function railLabel(state: SyncViewState, progress: SyncProgress | null): string {
  if (progress === null || state === "idle") return statusLabel("never", null);
  switch (state) {
    case "running":
      return progress.currentChannelHandle === null ? "Syncing…" : `Syncing ${progress.currentChannelHandle}`;
    case "cancelling":
      return "Cancelling…";
    case "stalled":
      return "Sync stalled";
    case "cancelled":
      return "Sync cancelled";
    case "success":
    case "partial":
    case "failed":
      return statusLabel(state, progress.finishedAt);
  }
}

/** Channel N of M plus the handle in flight — every value a real `sync_jobs` column. The
 *  channel being worked on is the one after those already done, hence `channelsDone + 1`;
 *  the clamp covers a run whose total was written before a channel was added. */
function railDetail(progress: SyncProgress): string {
  if (progress.channelsTotal === null) return phaseLabel(progress.phase);
  if (progress.currentChannelHandle === null) {
    return `${progress.channelsDone} of ${progress.channelsTotal} channels done`;
  }
  const nth = Math.min(progress.channelsDone + 1, progress.channelsTotal);
  return `Channel ${nth} of ${progress.channelsTotal} · ${progress.currentChannelHandle}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);
  // No `channelId`: this rail speaks for the whole library, and the poll adopts whatever
  // job is latest — so a run started on a channel page or in another tab shows up here.
  // (Not "or by the scheduler": there is no scheduler. Every run starts from a click —
  // see the "Inert settings" note in settings/sync-section.tsx.) The old code fetched
  // status exactly once on mount, which is why anything started elsewhere was invisible
  // until a reload.
  const { progress, isRunning, stalled, error, start, cancel } = useSyncProgress();

  const state = syncViewState(progress, stalled);
  const active = state === "running" || state === "cancelling";

  // Runs are announced once, and only runs this rail actually watched. The poll falls
  // back to the most recent finished job when nothing is running, so without the "did we
  // see it running" gate every page load would toast the result of a sync from hours ago.
  const watchedJobRef = useRef<string | null>(null);
  const announcedJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (progress === null) return;
    if (progress.status === "running") {
      watchedJobRef.current = progress.jobId;
      return;
    }
    if (progress.jobId !== watchedJobRef.current || announcedJobRef.current === progress.jobId) return;
    announcedJobRef.current = progress.jobId;

    const headline = statusHeadline(syncViewState(progress, false), progress);
    if (progress.status === "success") toast.success(headline);
    else if (progress.status === "partial") toast.warning(headline);
    else toast.error(headline);
  }, [progress]);

  const dot = progress === null ? "never" : VIEW_STATE_DOT[state];

  return (
    // `min-w-0` is load-bearing, not tidiness. This aside is the fixed 240px track of the
    // shell's `grid-cols-[240px_1fr]`, and a grid item defaults to `min-width: auto` —
    // meaning it refuses to shrink below its content's min-content width and simply
    // overflows its own track. A live sync put a long handle down there for the first
    // time, and the footer started pushing the rail wider than the column it lives in.
    <aside className="flex h-full min-w-0 flex-col border-r border-border bg-card">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">
          Crowsnest
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const itemActive = isNavItemActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <div key={item.href} className="relative">
              {itemActive && (
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                />
              )}
              <Link
                href={item.href}
                aria-current={itemActive ? "page" : undefined}
                className={cn(
                  "mx-3 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  itemActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <Separator className="mb-3" />
        <div className="flex items-center gap-1 pl-3 text-xs text-muted-foreground">
          {/* Deliberately a bare <button>, not the UI-kit <Button>. Its cva base sets
              `shrink-0` and `whitespace-nowrap`, and `shrink-0` lands in a different
              tailwind-merge group from `flex-1`, so both survive the merge: the control
              ends up flex-shrink:0 and simply refuses to give way. With a real handle in
              it ("Syncing @hormozi") that overflowed the rail and collided with the icon
              button beside it. Nothing here needs the kit's affordances — it is a text
              row that must yield — so it opts out rather than fighting the cascade. */}
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Open sync details"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[dot])} />
            {/* min-w-0 as well as truncate: a flex child's min-width:auto would otherwise
                keep it at its full text width and no ellipsis would ever appear. */}
            <span className="min-w-0 truncate">{railLabel(state, progress)}</span>
          </button>

          {active ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={() => void cancel()}
              disabled={progress?.cancelRequested ?? false}
              aria-label="Cancel sync"
            >
              <X className="size-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={() => void start()}
              // A stalled run holds the lock but is dead; starting a new sync takes the
              // lock back, so the button stays live rather than trapping the user.
              disabled={isRunning && !stalled}
              aria-label="Sync now"
            >
              {/* Driven by the polled `running` row, so it stops when the run really
                  stops. The old spinner lasted exactly as long as one client promise
                  happened to stay open, and a reload silenced it mid-run. */}
              <RefreshCw className={cn("size-3.5", isRunning && !stalled && "animate-spin")} />
            </Button>
          )}
        </div>

        {/* pr-3 matters as much as pl-3: without a right inset the ellipsis renders hard
            against the rail's border, which reads as "clipped" rather than "shortened". */}
        {active && progress !== null && (
          <p className="mt-1 truncate px-3 text-[11px] text-muted-foreground tabular-nums">{railDetail(progress)}</p>
        )}

        {/* Rendered, not toasted: a poll that fails every second would stack a tower of
            identical toasts. The last good progress row stays on screen beside it (see
            reducePoll) rather than blanking. */}
        {error !== null && <p className="mt-1 truncate px-3 text-[11px] text-destructive">{error}</p>}
      </div>

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Sync</DialogTitle>
            <DialogDescription>
              Live state of the run in flight, or the last one that finished. Read straight off <code>sync_jobs</code>.
            </DialogDescription>
          </DialogHeader>
          {/* `onRetry()` with no ids means "start a new sync" in the panel's vocabulary,
              which is exactly `start()` on an unscoped hook. */}
          <SyncProgressPanel
            progress={progress}
            stalled={stalled}
            pollError={error}
            onCancel={() => void cancel()}
            onRetry={(channelIds) => void start(channelIds)}
          />
        </DialogContent>
      </Dialog>
    </aside>
  );
}
