"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { gapMessage, phaseLabel } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import { OUTLIERS_30D_MIN_SCORE } from "@/lib/outlier-constants";
import type { ChannelRow, Fleet } from "@/server/queries/channels";
import { MEDIAN_CONFIDENCE_THRESHOLDS, medianConfidence } from "@/server/services/outlier-calc";
import { EditChannelFleetsDialog } from "./edit-channel-fleets-dialog";
import { RemoveChannelDialog } from "./remove-channel-dialog";

/** A run older than this reads as "stale" rather than plain "synced N ago" — v1-scope.md
 *  §2 Channels AC3 names the threshold in days, not hours: 30 days idle before a channel
 *  is called stale. A silently aging channel is worse than one that was never synced,
 *  because it looks current when it isn't — but calling anything past a day "stale"
 *  overstates that on a tool that isn't syncing hourly to begin with. */
const STALE_DAYS = 30;

/** `OUTLIERS_30D_MIN_SCORE` (`@/lib/outlier-constants`) is the same cutoff
 *  `server/queries/channels.ts` filters its `outliers30d` count by — a client-safe
 *  module, so this component imports the real constant instead of re-declaring the
 *  literal (M4/M5, branch review). Surfaced in the "Outliers (30d)" header tooltip
 *  below so the word "outlier" doesn't silently mean 2x here and 5x on the Feed's
 *  default view — docs/qa/2026-08-01-feed-fix-plan.md "Finding 4". */
const OUTLIERS_30D_TOOLTIP = `Posts scoring ${OUTLIERS_30D_MIN_SCORE}x or higher in the last 30 days`;

type HealthTone = "faint" | "muted" | "stale" | "destructive";

function syncHealth(channel: ChannelRow): { label: string; tone: HealthTone } {
  // Never-synced has to win even when a sync attempt already failed once (the profile
  // fetch on add, or a first run that errored before finishing) — `last_synced_at` is
  // still null either way, and "Never synced" is the state v1-scope.md §2 Channels AC1
  // requires to be unmissable. The error itself still reaches the row via the warning
  // icon below, it just doesn't get to overwrite this label.
  if (channel.lastSyncedAt === null) return { label: "Never synced", tone: "faint" };
  if (channel.syncError) return { label: "Sync failed", tone: "destructive" };
  const daysSince = (Date.now() - new Date(channel.lastSyncedAt).getTime()) / 86_400_000;
  if (daysSince > STALE_DAYS) return { label: `Stale · ${relativeTime(channel.lastSyncedAt)}`, tone: "stale" };
  return { label: `Synced ${relativeTime(channel.lastSyncedAt)}`, tone: "muted" };
}

// Sparkline gap (docs/product/review-ui-gap-2026-07-31.md, "Channels" finding): the
// prototype draws an 8-run sync-health sparkline per channel; this table renders text
// instead. That is deliberate, not a shortcut skipped for time.
//
// `sync_jobs.channel_id` CAN attribute a run to one channel (schema.ts: null means a
// whole-library run, set means a single-channel run) — the column supports it. But on
// this machine the whole table has exactly one row, total, across both tracked
// channels. @kallaway's `last_synced_at` is four days older than that one row, which
// belongs to @hormozi — so the job log does not even account for the sync history the
// `channels` table itself implies already happened. There is no backfill and no second
// source (channel_snapshots records values, not run outcomes). Drawing 8 bars per row
// against that would mean rendering 7 (or 8) blank/invented bars as if "no data" were
// itself a health signal, for every channel, every time — the opposite of honest.
//
// It also can't be built from this file alone: `ChannelRow` (server/queries/channels.ts)
// carries no job history today, only `lastSyncedAt` / `syncError` off the `channels`
// row. Reaching `sync_jobs` would mean a new query (group by channel_id, order by
// started_at desc, limit 8) added there — out of scope for a rendering-layer change.
//
// What it would need to ship for real: that query, plus enough real run volume per
// channel that a sparkline reads as history rather than as padding. Until then, the
// improvement made here is textual: `neverSynced && warning` below surfaces a failed
// attempt's reason inline instead of leaving it in a hover-only tooltip, from data this
// component already has.
const HEALTH_CLASS: Record<HealthTone, string> = {
  // Never synced reads as thin, not broken — same restraint the prototype gives a
  // channel with too little data to say anything about yet.
  faint: "text-faint",
  muted: "text-muted-foreground",
  // Aging data is a raised-surface chip, never amber — amber is reserved for the score.
  stale: "bg-popover px-1.5 py-0.5 text-muted-foreground",
  destructive: "text-destructive",
};

export function ChannelTable({
  channels,
  fleets,
  sampleSizeById,
}: {
  channels: ChannelRow[];
  fleets: Fleet[];
  /** channelId -> the sample `getChannelMedianBasis` computed the median from. Drives the
   *  thin-sample note below, via the same `medianConfidence` the detail page reads, so the
   *  two screens can't quietly disagree about what "thin" means. */
  sampleSizeById: Record<string, number>;
}) {
  const router = useRouter();
  // One shared dialog instance for the whole table, rather than one per row — keyed
  // by the currently-selected channel's id (final-review finding B2).
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const editingChannel = channels.find((c) => c.id === editingChannelId) ?? null;
  // Same one-shared-instance shape as the fleets dialog above, keyed by row id.
  const [removingChannelId, setRemovingChannelId] = useState<string | null>(null);
  const removingChannel = channels.find((c) => c.id === removingChannelId) ?? null;

  // ONE hook for the whole table, not one per row. A row-level hook would mean a
  // Server Action call per channel per second while a sync is running — 40 channels is
  // 40 requests a second for one run's worth of information. The live row already names
  // the channel it is on, so a single poll answers every row.
  const { progress, isRunning, error, start } = useSyncProgress();
  // Covers the window between the click and the job row existing, so a double click
  // can't race the DB lock into a confusing "a sync is already running".
  const [startingId, setStartingId] = useState<string | null>(null);

  async function syncNow(channelId: string) {
    setStartingId(channelId);
    try {
      await start([channelId]);
    } finally {
      setStartingId(null);
    }
  }

  // The dropdown is gone by the time an action fails, so this is the one place a toast
  // is the right surface. Deduped: `error` survives across polls by design (reducePoll
  // keeps the last good row rather than blanking), so re-toasting it every second would
  // build a tower of identical messages.
  const toastedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (error === null) {
      toastedErrorRef.current = null;
      return;
    }
    if (toastedErrorRef.current === error) return;
    toastedErrorRef.current = error;
    toast.error(error);
  }, [error]);

  if (channels.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No channels in this fleet yet.</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="border-line-strong hover:bg-transparent">
            <TableHead data-lab className="h-auto pb-3 text-2xs font-normal text-faint">
              Channel
            </TableHead>
            <TableHead data-lab className="h-auto pb-3 text-right text-2xs font-normal text-faint">
              Followers
            </TableHead>
            <TableHead data-lab className="h-auto pb-3 text-right text-2xs font-normal text-faint">
              Median views
            </TableHead>
            <TableHead data-lab className="h-auto pb-3 text-right text-2xs font-normal text-faint">
              <Tooltip>
                <TooltipTrigger
                  render={<span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2" />}
                >
                  Outliers (30d)
                </TooltipTrigger>
                <TooltipContent>{OUTLIERS_30D_TOOLTIP}</TooltipContent>
              </Tooltip>
            </TableHead>
            <TableHead className="h-auto w-10 pb-3" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((channel) => {
            // `channel-header.tsx` answers "is this run mine?" exactly, from the
            // hook's `coverage`. This table cannot: `coverage` requires a per-channel
            // poll, and one hook per row is the N-requests-a-second problem above. So
            // here it stays a handle comparison — exact equality is safe because
            // `currentChannelHandle` is denormalized off the same `channels.handle`
            // column these rows were read from.
            //
            // The weaker signal is affordable here in a way it wasn't in the header:
            // this only drives a live readout and a menu-item label. The double-click
            // race is closed by `startingId` below, and a wrong guess costs a row
            // showing "Never" for a second, not a second concurrent sync.
            const syncing = isRunning && progress !== null && progress.currentChannelHandle === channel.handle;
            const busy = startingId === channel.id || syncing;
            // A gap from the run just finished is fresher and more specific than the
            // `sync_error` persisted on the channel row, so it wins the warning icon.
            const gap = progress?.gaps.find((g) => g.channelId === channel.id);
            const warning = gap !== undefined ? gapMessage(gap) : channel.syncError;
            const health = syncHealth(channel);
            const neverSynced = channel.lastSyncedAt === null;
            // Thin note is a separate fact from "never synced" — a channel with zero
            // sample gets the dedicated never-synced treatment above, not a note claiming
            // "0 posts" (v1-scope.md §2 Channels AC1: never a zero). Only a channel that
            // HAS synced and came back with a small-but-real sample reads as thin.
            const sampleSize = sampleSizeById[channel.id] ?? 0;
            const thin = !neverSynced && sampleSize > 0 && medianConfidence(sampleSize) === "low";

            return (
              <TableRow
                key={channel.id}
                role="link"
                tabIndex={0}
                aria-label={`View ${channel.handle}`}
                onClick={() => router.push(`/channels/${channel.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(`/channels/${channel.id}`);
                }}
                className="cursor-pointer border-border"
                // Never-synced gets a hatched row, not just a different label — v1-scope.md
                // §2 Channels AC1 calls this out as its own visual state, the same hatch
                // pattern the feed already uses for "a well with no data in it"
                // (outlier-card.tsx, video-player.tsx) rather than a one-off style here.
                style={
                  neverSynced
                    ? {
                        backgroundColor: "var(--hatch-1)",
                        backgroundImage:
                          "repeating-linear-gradient(135deg, var(--hatch-2) 0px, var(--hatch-2) 1px, transparent 1px, transparent 10px)",
                      }
                    : undefined
                }
              >
                <TableCell className="py-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
                      <AvatarFallback>
                        {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-base">{channel.handle}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 font-mono text-2xs">
                    {syncing && progress !== null ? (
                      <span data-num className="text-foreground" aria-live="polite">
                        {phaseLabel(progress.phase)} · {progress.itemsSeen} seen
                      </span>
                    ) : (
                      <span className={HEALTH_CLASS[health.tone]}>{health.label}</span>
                    )}
                    {warning && (
                      <Tooltip>
                        <TooltipTrigger render={<AlertTriangle className="size-3.5 text-destructive" aria-hidden />} />
                        <TooltipContent>{warning}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  {thin && (
                    <span className="mt-1.5 block max-w-[42ch] text-2xs text-faint">
                      Only {sampleSize} post{sampleSize === 1 ? "" : "s"} — a median needs about{" "}
                      {MEDIAN_CONFIDENCE_THRESHOLDS.low} before its scores mean anything.
                    </span>
                  )}
                  {/* "Never synced" always wins the label (line 43) even over a failed attempt,
                      so a channel that DID try and failed once looks identical, at a glance, to
                      one nobody has touched yet — the only difference lives in a hover-only
                      tooltip. This line surfaces that same reason without requiring a hover,
                      same as the thin-sample note above does for a different fact. It reads off
                      `channel.syncError` / the live `gap`, both already on the row — no new
                      query, no invented history. */}
                  {neverSynced && warning && (
                    <span className="mt-1.5 block max-w-[42ch] text-2xs text-destructive">
                      Last attempt failed: {warning}
                    </span>
                  )}
                </TableCell>
                <TableCell data-num className="py-4 text-right font-mono text-sm">
                  {formatCompact(channel.followerCount)}
                </TableCell>
                <TableCell data-num className="py-4 text-right font-mono text-sm text-muted-foreground">
                  {formatCompact(channel.medianViews)}
                </TableCell>
                <TableCell data-num className="py-4 text-right font-mono text-sm text-muted-foreground">
                  {/* A channel that has never synced has no answer here, and zero is an
                      answer. Follower count and median already read as dashes for the
                      same reason, so a bare 0 in this column was the one number on the
                      row claiming we had looked. */}
                  {channel.lastSyncedAt === null ? "—" : channel.outliers30d}
                </TableCell>
                <TableCell className="py-4" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Channel actions" />}>
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={busy} onClick={() => void syncNow(channel.id)}>
                        {busy ? "Syncing…" : "Sync now"}
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<Link href={`/channels/${channel.id}`} />}>View</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditingChannelId(channel.id)}>Edit fleets</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setRemovingChannelId(channel.id)}>
                        Remove channel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {editingChannel && (
        <EditChannelFleetsDialog
          channel={editingChannel}
          fleets={fleets}
          open={editingChannel !== null}
          onOpenChange={(open) => {
            if (!open) setEditingChannelId(null);
          }}
        />
      )}

      {removingChannel && (
        <RemoveChannelDialog
          channel={removingChannel}
          open={removingChannel !== null}
          onOpenChange={(open) => {
            if (!open) setRemovingChannelId(null);
          }}
          onRemoved={() => {
            setRemovingChannelId(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
