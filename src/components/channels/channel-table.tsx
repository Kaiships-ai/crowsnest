"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { platformLabel } from "@/components/feed/platform-chip";
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
import type { ChannelRow, Fleet } from "@/server/queries/channels";
import { EditChannelFleetsDialog } from "./edit-channel-fleets-dialog";

export function ChannelTable({ channels, fleets }: { channels: ChannelRow[]; fleets: Fleet[] }) {
  const router = useRouter();
  // One shared dialog instance for the whole table, rather than one per row — keyed
  // by the currently-selected channel's id (final-review finding B2).
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const editingChannel = channels.find((c) => c.id === editingChannelId) ?? null;

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
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead className="text-right">Followers</TableHead>
            <TableHead className="text-right">Median views</TableHead>
            <TableHead className="text-right">Outliers (30d)</TableHead>
            <TableHead>Last synced</TableHead>
            <TableHead className="w-10" />
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
                className="cursor-pointer"
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
                      <AvatarFallback>
                        {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{channel.handle}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{platformLabel(channel.platform)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatCompact(channel.followerCount)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{formatCompact(channel.medianViews)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{channel.outliers30d}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    {syncing && progress !== null ? (
                      <span className="tabular-nums text-foreground" aria-live="polite">
                        {phaseLabel(progress.phase)} · {progress.itemsSeen} seen
                      </span>
                    ) : (
                      <span>{channel.lastSyncedAt ? relativeTime(channel.lastSyncedAt) : "Never"}</span>
                    )}
                    {warning && (
                      <Tooltip>
                        <TooltipTrigger render={<AlertTriangle className="size-3.5 text-destructive" aria-hidden />} />
                        <TooltipContent>{warning}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
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
                      {/* Base UI's disabled item styling sets pointer-events:none, which would
                          also block a wrapping Tooltip's hover — so this explains itself via a
                          toast on click instead, rather than a hover affordance that can't fire. */}
                      <DropdownMenuItem
                        className="text-muted-foreground"
                        onClick={() => toast.info("Untrack arrives in a later phase")}
                      >
                        Untrack
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
    </>
  );
}
