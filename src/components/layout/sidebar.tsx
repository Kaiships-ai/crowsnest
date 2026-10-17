"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { GetStartedChecklist, type GetStartedItem } from "@/components/layout/get-started-checklist";
import { NAV_GROUPS } from "@/components/layout/nav-items";
import { useNavigationBlocker } from "@/components/layout/navigation-blocker";
import { SyncProgressPanel } from "@/components/sync/sync-progress-panel";
import { phaseLabel, statusHeadline, syncViewState, type SyncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SyncProgress, SyncStatusValue } from "@/server/services/sync-types";

/** `current` is the pathname plus `?tab=` when the landing route carries one, so Tuần này
 *  ("/") and the Dashboard ("/?tab=...") light separately. */
function isNavItemActive(current: string, href: string) {
  if (href === "/") return current === "/";
  if (href.startsWith("/?tab=")) return current.startsWith("/?tab=");
  const pathname = current;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// On-system dot colors, ordered so all five read apart on the rail at a glance. `running`
// gets noticed by brightness plus motion — full `foreground` with a pulse, the one state
// worth catching mid-glance. `never` sits at the opposite end, dim, since nothing has
// happened yet. `partial` (and the `cancelled` view state, which reuses it below) lands in
// between at `muted-foreground`: resolved, but incomplete, so it reads quieter than an
// active run and louder than never-synced. Only the two states with an actual verdict get
// a live hue: success reads --success, failed destructive.
const STATUS_DOT: Record<SyncStatusValue, string> = {
  never: "bg-muted-foreground",
  success: "bg-[var(--success)]",
  running: "bg-foreground animate-pulse",
  partial: "bg-muted-foreground",
  failed: "bg-destructive",
};

/**
 * The live view has three states the five sync statuses never named, and inventing a
 * sixth colour for them would break a palette the rest of the app matches. `cancelling`
 * is still work in flight, so it keeps running's treatment. `cancelled` left channels
 * unvisited, which is what partial already means. `stalled` takes failed's red on
 * purpose: the process died holding the lock, and anything softer would read as "still
 * going", the precise misreading this mapping exists to stop.
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

export interface SidebarProps {
  getStartedItems: GetStartedItem[];
  /** `countInboxIdeas()`, read once per full navigation by `(shell)/layout.tsx` — same
   *  flow `getStartedItems` already uses to get real per-user data into this otherwise
   *  static rail (see nav-items.ts's module doc for why the count isn't a NAV_ITEMS
   *  field). Rendered only on the Ideas item, and only as a plain count — the Ideas inbox
   *  is a mundane tally, not the product's core signal, so it stays neutral. */
  ideasInboxCount: number;
  /** Outliers new since the creator last opened Feed (`getNewFeedOutliers()`, threaded
   *  from `(shell)/layout.tsx` exactly like `ideasInboxCount`). This is the rail's single
   *  emphasized signal — the product's whole promise ("here is what beat the median, go
   *  make it") surfaced where the eye lands. Rendered only on the Feed item, only when
   *  > 0, and it is the one rail count allowed `primary`; every other one is neutral. */
  feedOutlierCount: number;
}

export function Sidebar({ getStartedItems, ideasInboxCount, feedOutlierCount }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Optimistic active item. A shell route is `force-dynamic`, so a nav click waits on a
  // server render (fast, but not free) before `pathname` moves and the active marker
  // follows — long enough to read as "nothing happened yet". Instead, on click we light
  // the target immediately and reconcile when the route commits: `displayHref` is the
  // pending target while a navigation is in flight, then falls back to the real pathname.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // React's "adjust state during render" reset pattern, not an effect: the moment the
  // pathname changes (the click's route committed, or the user went elsewhere by any
  // means) the optimistic target is stale, so drop it in the same render rather than one
  // commit later. Tracking the last pathname in state is what lets this run in render
  // without an effect and without a cascading re-render.
  // `/` and `/?tab=overview` share a pathname, so the tab is part of the location key.
  const tab = useSearchParams().get("tab");
  const location = tab ? `${pathname}?tab=${tab}` : pathname;
  const [lastLocation, setLastLocation] = useState(location);
  if (location !== lastLocation) {
    setLastLocation(location);
    setPendingHref(null);
  }
  const displayHref = pendingHref ?? (pathname === "/" && tab ? `/?tab=${tab}` : pathname);
  const [panelOpen, setPanelOpen] = useState(false);
  // No `channelId`: this rail speaks for the whole library, and the poll adopts whatever
  // job is latest — so a run started on a channel page, in another tab, or by the
  // in-process sync scheduler (sync-scheduler.ts, which starts a library sweep on the
  // syncCadenceMinutes cadence) shows up here.
  const { progress, isRunning, stalled, error, start, cancel } = useSyncProgress();
  // Set by whichever page currently holds state a navigation would drop (the channels
  // board's unsaved drag moves, so far) — see navigation-blocker.tsx. A confirm() rather
  // than a custom dialog: it is native, blocks synchronously so `onNavigate`'s
  // preventDefault lands before Next starts the transition, and this is the one place in
  // the app that asks "leave anyway?" at all.
  const { isBlocked } = useNavigationBlocker();

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

    // The shell's failure strip (topbar.tsx) is fed by `getFailureStrip()` in a server
    // component and only re-reads `sync_jobs` on navigation — it has no poll of its own,
    // on purpose, so there's exactly one place in the shell that owns "is a sync running
    // right now". A run this rail just watched finish is the one moment that snapshot is
    // guaranteed stale, so it's refreshed here rather than teaching the strip to poll too.
    router.refresh();
  }, [progress, router]);

  const dot = progress === null ? "never" : VIEW_STATE_DOT[state];
  const railStatusLabel = railLabel(state, progress);

  // The rail's one earned moment. This rail lives in the shell layout and stays mounted
  // across navigations — `router.refresh()` repaints it with a fresh `feedOutlierCount`
  // rather than remounting it — so a count that GREW means new outliers genuinely arrived
  // since the last render, the one moment worth a flicker. Bumping the key remounts just
  // the Feed badge, replaying its settle animation then and only then; an ordinary
  // navigation that left the count unchanged reuses the element and stays still, so the
  // signal never turns into per-navigation noise.
  const prevFeedOutliers = useRef(feedOutlierCount);
  const [outlierSettleKey, setOutlierSettleKey] = useState(0);
  useEffect(() => {
    if (feedOutlierCount > prevFeedOutliers.current) setOutlierSettleKey((k) => k + 1);
    prevFeedOutliers.current = feedOutlierCount;
  }, [feedOutlierCount]);

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader>
        <span className="truncate px-3 py-1 text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
          Crowsnest
        </span>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map(({ group, items }) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel data-lab className="font-mono text-2xs">
              {group}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const itemActive = isNavItemActive(displayHref, item.href);
                  const Icon = item.icon;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={itemActive}
                        tooltip={item.label}
                        render={
                          <Link
                            href={item.href}
                            aria-current={itemActive ? "page" : undefined}
                            // Survives the trip through SidebarMenuButton's `render` and
                            // the TooltipTrigger it wraps this Link in: Base UI's
                            // `useRender` merges onto the given element rather than
                            // replacing it, so Next's own props reach the anchor intact.
                            onNavigate={(e) => {
                              if (isBlocked && !window.confirm("You have unsaved changes. Leave anyway?")) {
                                e.preventDefault();
                                return;
                              }
                              // Light the target now, not after the server render commits.
                              // Skipped when it is already the active route: a re-click
                              // navigates nowhere, so there is nothing to reconcile and no
                              // pending state to strand.
                              if (!itemActive) setPendingHref(item.href);
                            }}
                          >
                            {/* Stroke tuned finer than Lucide's default 2 so the glyphs read
                                as precise instrument marks against the mono type, and the
                                active item's icon thickens to 2 in lockstep with its bolded
                                label. */}
                            <Icon strokeWidth={itemActive ? 2 : 1.75} />
                            <span>{item.label}</span>
                            {/* The collapsed rail has no room for a count, but "there is
                                something on Feed worth making" must not vanish just because
                                the labels did — SidebarMenuBadge hides itself at that width,
                                so the signal survives as a bare dot. */}
                            {item.href === "/feed" && feedOutlierCount > 0 && (
                              <span
                                aria-hidden
                                className="absolute top-1.5 right-1.5 hidden size-1.5 rounded-full bg-primary group-data-[collapsible=icon]:block"
                              />
                            )}
                          </Link>
                        }
                      />
                      {/* Ideas is a mundane tally, so its count stays neutral. Hidden at
                          zero: an empty inbox needs no badge to say so. */}
                      {item.href === "/ideas" && ideasInboxCount > 0 && (
                        <SidebarMenuBadge className="font-mono">{ideasInboxCount}</SidebarMenuBadge>
                      )}
                      {/* The rail's ONE emphasized signal: outliers new since the last Feed
                          visit. Same hidden-at-zero rule, and the only rail count that gets
                          `primary` rather than the muted sidebar foreground. */}
                      {item.href === "/feed" && feedOutlierCount > 0 && (
                        <SidebarMenuBadge
                          key={outlierSettleKey}
                          className="rail-signal-settle bg-primary/10 font-mono text-primary"
                        >
                          {feedOutlierCount}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <GetStartedChecklist items={getStartedItems} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              onClick={() => setPanelOpen(true)}
              aria-label={`Open sync details — ${railStatusLabel}`}
              tooltip={railStatusLabel}
            >
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[dot])} />
              <span className="min-w-0 truncate">{railStatusLabel}</span>
            </SidebarMenuButton>

            {active ? (
              <SidebarMenuAction
                onClick={() => void cancel()}
                disabled={progress?.cancelRequested ?? false}
                aria-label="Cancel sync"
              >
                <X />
              </SidebarMenuAction>
            ) : (
              <SidebarMenuAction
                onClick={() => void start()}
                // A stalled run holds the lock but is dead; starting a new sync takes the
                // lock back, so the button stays live rather than trapping the user.
                disabled={isRunning && !stalled}
                aria-label="Sync now"
              >
                {/* Driven by the polled `running` row, so it stops when the run really
                    stops. A spinner tied to one client promise would stop when that promise
                    settled and go silent across a reload mid-run. */}
                <RefreshCw className={cn(isRunning && !stalled && "animate-spin")} />
              </SidebarMenuAction>
            )}
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="group-data-[collapsible=icon]:hidden">
          {active && progress !== null && (
            <p className="truncate px-3 text-2xs tabular-nums text-muted-foreground">{railDetail(progress)}</p>
          )}

          {/* Rendered, not toasted: a poll that fails every second would stack a tower of
              identical toasts. The last good progress row stays on screen beside it (see
              reducePoll) rather than blanking. */}
          {error !== null && <p className="truncate px-3 text-2xs text-destructive">{error}</p>}
        </div>
      </SidebarFooter>

      <SidebarRail />

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
    </SidebarRoot>
  );
}

