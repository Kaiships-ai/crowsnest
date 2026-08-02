"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { formatCompact, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import type { ChannelRow } from "@/server/queries/channels";
import { RemoveChannelDialog } from "./remove-channel-dialog";

function syncLine(c: ChannelRow): { label: string; tone: "faint" | "muted" | "destructive" } {
  if (c.lastSyncedAt === null) return { label: "Never synced", tone: "faint" };
  if (c.syncError) return { label: "Sync failed", tone: "destructive" };
  return { label: `Synced ${relativeTime(c.lastSyncedAt)}`, tone: "muted" };
}

export function ChannelCard({ channel, overlay = false }: { channel: ChannelRow; overlay?: boolean }) {
  const router = useRouter();
  const { start } = useSyncProgress();
  const [removing, setRemoving] = useState(false);
  const sortable = useSortable({ id: channel.id, disabled: overlay });
  const health = syncLine(channel);

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };

  return (
    <>
      <article
        ref={overlay ? undefined : sortable.setNodeRef}
        style={style}
        data-dragging={sortable.isDragging ? "" : undefined}
        className="border border-border bg-card px-4 pt-3 pb-4 select-none data-[dragging]:opacity-40"
      >
        <div className="flex items-center gap-2.5">
          {/* The card body is the drag handle; the menu button stops propagation. */}
          <span
            {...(overlay ? {} : { ...sortable.attributes, ...sortable.listeners })}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Avatar size="sm">
              <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
              <AvatarFallback>
                {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{channel.handle}</span>
              {channel.isOwn && <span className="font-mono text-2xs uppercase tracking-wide text-faint">My channel</span>}
            </span>
          </span>
          {!overlay && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Channel actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void start([channel.id])}>Sync now</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/channels/${channel.id}`)}>View</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>Remove channel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-3 flex gap-6">
          <span className="flex flex-col gap-0.5">
            <span data-num className="text-xs text-foreground">{formatCompact(channel.followerCount)}</span>
            <span className="text-2xs text-faint">followers</span>
          </span>
          <span className="flex flex-col gap-0.5">
            <span data-num className="text-xs text-foreground">{channel.lastSyncedAt === null ? "—" : channel.outliers30d}</span>
            <span className="text-2xs text-faint">outliers 30d</span>
          </span>
        </div>

        <div className={`mt-3 text-2xs ${health.tone === "destructive" ? "text-destructive" : health.tone === "faint" ? "text-faint" : "text-muted-foreground"}`}>
          {health.label}
        </div>
      </article>

      {removing && (
        <RemoveChannelDialog
          channel={channel}
          open={removing}
          onOpenChange={(o) => !o && setRemoving(false)}
          onRemoved={() => { setRemoving(false); router.refresh(); }}
        />
      )}
    </>
  );
}
