"use client";

/* eslint-disable react-hooks/refs -- dnd-kit's useSortable returns setNodeRef, attributes,
   listeners and isDragging to be applied in render. They are dnd-kit values, not React refs,
   so this rule misfires here. */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { formatCompact, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import type { ChannelRow } from "@/server/queries/channels";
import { MEDIAN_CONFIDENCE_THRESHOLDS, medianConfidence } from "@/server/services/outlier-calc";
import { RemoveChannelDialog } from "./remove-channel-dialog";

/** A run older than this reads as "stale" rather than plain "synced N ago" — v1-scope.md
 *  §2 Channels AC3 names the threshold in days, not hours. A silently aging channel is
 *  worse than one that was never synced, because it looks current when it isn't. */
const STALE_DAYS = 30;

type HealthTone = "faint" | "muted" | "stale" | "destructive";

/** Never-synced wins even when an attempt already failed: `lastSyncedAt` is null either
 *  way, and "Never synced" is the state that has to be unmissable. */
function syncLine(c: ChannelRow): { label: string; tone: HealthTone } {
  if (c.lastSyncedAt === null) return { label: "Never synced", tone: "faint" };
  if (c.syncError) return { label: "Sync failed", tone: "destructive" };
  const daysSince = (Date.now() - new Date(c.lastSyncedAt).getTime()) / 86_400_000;
  if (daysSince > STALE_DAYS) return { label: `Stale · ${relativeTime(c.lastSyncedAt)}`, tone: "stale" };
  return { label: `Synced ${relativeTime(c.lastSyncedAt)}`, tone: "muted" };
}

const HEALTH_CLASS: Record<HealthTone, string> = {
  faint: "text-faint",
  muted: "text-muted-foreground",
  // Aging data is a raised-surface chip, never amber — amber is reserved for the score.
  stale: "bg-popover px-1.5 py-0.5 text-muted-foreground",
  destructive: "text-destructive",
};

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

function ChannelCardStats({ channel, sampleSize }: { channel: ChannelRow; sampleSize: number }) {
  const health = syncLine(channel);
  // A channel with zero sample gets the dedicated never-synced treatment above, not a
  // note claiming "0 posts". Only a channel that HAS synced and came back with a
  // small-but-real sample reads as thin.
  const thin = channel.lastSyncedAt !== null && sampleSize > 0 && medianConfidence(sampleSize) === "low";
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

      {/* flex, so the stale chip's padding sits on its own box instead of bleeding over
          the lines above and below it the way an inline span's would. */}
      <div className="mt-3 flex items-center text-2xs">
        <span className={HEALTH_CLASS[health.tone]}>{health.label}</span>
      </div>

      {thin && (
        <span className="mt-1.5 block text-2xs text-faint">
          Only {sampleSize} post{sampleSize === 1 ? "" : "s"}, a median needs about{" "}
          {MEDIAN_CONFIDENCE_THRESHOLDS.low} before its scores mean anything.
        </span>
      )}
    </>
  );
}

/** Static clone rendered in the DragOverlay. No dnd hooks, no menu: this is a second
 * instance of the same channel.id, and useSortable would register a competing droppable
 * for that id and break drop targeting for the live card once the overlay unmounts. */
function ChannelCardOverlay({ channel, sampleSize }: { channel: ChannelRow; sampleSize: number }) {
  return (
    <article className="border border-border bg-card px-4 pt-3 pb-4 select-none">
      <div className="flex items-center gap-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <ChannelCardBody channel={channel} />
        </span>
      </div>
      <ChannelCardStats channel={channel} sampleSize={sampleSize} />
    </article>
  );
}

export function ChannelCard({
  channel,
  overlay = false,
  sampleSize = 0,
}: {
  channel: ChannelRow;
  overlay?: boolean;
  /** Posts the baseline was computed from. 0 suppresses the thin-sample note, which is
   *  the right default for the drag clone: the note would only make the floating card
   *  taller than the one it is standing in for. */
  sampleSize?: number;
}) {
  if (overlay) return <ChannelCardOverlay channel={channel} sampleSize={sampleSize} />;
  return <ChannelCardLive channel={channel} sampleSize={sampleSize} />;
}

function ChannelCardLive({ channel, sampleSize }: { channel: ChannelRow; sampleSize: number }) {
  const router = useRouter();
  const { start } = useSyncProgress();
  const [removing, setRemoving] = useState(false);
  const sortable = useSortable({ id: channel.id });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };
  // Same target the ... menu's "View" item pushes to — the card body below and that
  // menu item now agree on one route instead of the route living in two places.
  const href = `/channels/${channel.id}`;

  return (
    <>
      <article
        ref={sortable.setNodeRef}
        style={style}
        data-testid="channel-card"
        data-id={channel.id}
        data-dragging={sortable.isDragging ? "" : undefined}
        className="border border-border bg-card px-4 pt-3 pb-4 select-none data-[dragging]:opacity-40"
      >
        <div className="flex items-center gap-2.5">
          {/* dnd-kit's drag handle used to be the whole body span below, which meant
              clicking the card to open it fought with dragging it and lost — the ...
              menu's View item was the only way in. The handle is a small dedicated
              grip now (a real button, so dnd-kit's attributes give it proper
              keyboard/aria semantics), and setNodeRef stays on the article so the
              whole card is still the draggable/droppable node; only the listeners
              moved. */}
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Drag to reorder ${channel.handle}`}
            className="shrink-0 cursor-grab p-1 text-faint hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
            <ChannelCardBody channel={channel} />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Channel actions" />}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void start([channel.id])}>Sync now</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(href)}>View</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>Remove channel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Link href={href} className="block">
          <ChannelCardStats channel={channel} sampleSize={sampleSize} />
        </Link>
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
