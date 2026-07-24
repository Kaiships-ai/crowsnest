"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { platformLabel } from "@/components/feed/platform-chip";
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
import type { ChannelRow } from "@/server/queries/channels";
import { bridgeSyncChannel } from "./sync-bridge";

async function syncNow(channelId: string, handle: string) {
  const result = await bridgeSyncChannel(channelId);
  if (result.ok) {
    toast.success(`${handle} synced`);
  } else {
    toast.error(result.error);
  }
}

export function ChannelTable({ channels }: { channels: ChannelRow[] }) {
  const router = useRouter();

  if (channels.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No channels in this fleet yet.</p>;
  }

  return (
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
        {channels.map((channel) => (
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
                  <AvatarImage src={channel.avatarUrl ?? undefined} alt="" />
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
                <span>{channel.lastSyncedAt ? relativeTime(channel.lastSyncedAt) : "Never"}</span>
                {channel.syncError && (
                  <Tooltip>
                    <TooltipTrigger render={<AlertTriangle className="size-3.5 text-destructive" aria-hidden />} />
                    <TooltipContent>{channel.syncError}</TooltipContent>
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
                  <DropdownMenuItem onClick={() => syncNow(channel.id, channel.handle)}>Sync now</DropdownMenuItem>
                  <DropdownMenuItem render={<Link href={`/channels/${channel.id}`} />}>View</DropdownMenuItem>
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
        ))}
      </TableBody>
    </Table>
  );
}
