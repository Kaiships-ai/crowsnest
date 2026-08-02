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

function ChannelCardBody({ channel }: { channel: ChannelRow }) {
  return (
    <>
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
    </>
  );
}

function ChannelCardStats({ channel }: { channel: ChannelRow }) {
  const health = syncLine(channel);
  return (
    <>
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
    </>
  );
}

/** Static clone rendered in the DragOverlay. No dnd hooks, no menu: this is a second
 * instance of the same channel.id, and useSortable would register a competing droppable
 * for that id and break drop targeting for the live card once the overlay unmounts. */
function ChannelCardOverlay({ channel }: { channel: ChannelRow }) {
  return (
    <article className="border border-border bg-card px-4 pt-3 pb-4 select-none">
      <div className="flex items-center gap-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <ChannelCardBody channel={channel} />
        </span>
      </div>
      <ChannelCardStats channel={channel} />
    </article>
  );
}

export function ChannelCard({ channel, overlay = false }: { channel: ChannelRow; overlay?: boolean }) {
  if (overlay) return <ChannelCardOverlay channel={channel} />;
  return <ChannelCardLive channel={channel} />;
}

function ChannelCardLive({ channel }: { channel: ChannelRow }) {
  const router = useRouter();
  const { start } = useSyncProgress();
  const [removing, setRemoving] = useState(false);
  const sortable = useSortable({ id: channel.id });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };

  return (
    <>
      <article
        ref={sortable.setNodeRef}
        style={style}
        data-dragging={sortable.isDragging ? "" : undefined}
        className="border border-border bg-card px-4 pt-3 pb-4 select-none data-[dragging]:opacity-40"
      >
        <div className="flex items-center gap-2.5">
          <span
            {...sortable.attributes}
            {...sortable.listeners}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <ChannelCardBody channel={channel} />
          </span>
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
        </div>

        <ChannelCardStats channel={channel} />
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
