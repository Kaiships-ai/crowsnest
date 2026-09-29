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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
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

/** `stale` is the one tone that renders as a chip rather than tinted text, so it lives
 *  in the render as a `Badge` and never gets a class here: aging data has to read as a
 *  raised marker, because a channel that looks current but isn't is the worst of the
 *  four states. */
const HEALTH_CLASS: Record<Exclude<HealthTone, "stale">, string> = {
  faint: "text-muted-foreground",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
};

function ChannelCardBody({ channel }: { channel: ChannelRow }) {
  return (
    <>
      <ItemMedia>
        <Avatar size="sm">
          <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
          <AvatarFallback>
            {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle className="block w-full truncate">{channel.handle}</ItemTitle>
        {channel.isOwn && (
          <ItemDescription className="font-mono text-2xs uppercase tracking-wide">My channel</ItemDescription>
        )}
      </ItemContent>
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
      <div className="flex gap-6">
        <span className="flex flex-col gap-0.5">
          <span data-num className="text-xs text-foreground">{formatCompact(channel.followerCount)}</span>
          <span className="text-2xs text-muted-foreground">followers</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span data-num className="text-xs text-foreground">{channel.lastSyncedAt === null ? "—" : channel.outliers30d}</span>
          <span className="text-2xs text-muted-foreground">outliers 30d</span>
        </span>
      </div>

      {/* flex, so the stale chip's padding sits on its own box instead of bleeding over
          the lines above and below it the way an inline span's would. */}
      <div className="mt-3 flex items-center text-2xs">
        {health.tone === "stale" ? (
          <Badge variant="secondary">{health.label}</Badge>
        ) : (
          <span className={HEALTH_CLASS[health.tone]}>{health.label}</span>
        )}
      </div>

      {thin && (
        <span className="mt-1.5 block text-2xs text-muted-foreground">
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
    <Card size="sm" className="select-none">
      <Item size="sm" className="gap-2.5 px-(--card-spacing) py-0">
        <ChannelCardBody channel={channel} />
      </Item>
      <CardContent>
        <ChannelCardStats channel={channel} sampleSize={sampleSize} />
      </CardContent>
    </Card>
  );
}

export function ChannelCard({
  channel,
  overlay = false,
  sampleSize = 0,
  selected = false,
  onToggleSelect,
}: {
  channel: ChannelRow;
  overlay?: boolean;
  /** Posts the baseline was computed from. 0 suppresses the thin-sample note, which is
   *  the right default for the drag clone: the note would only make the floating card
   *  taller than the one it is standing in for. */
  sampleSize?: number;
  /** Whether this card is ticked for a bulk sync. */
  selected?: boolean;
  /** Toggle this card's selection. Absent means the board is not in selection mode, so
   *  no checkbox renders — the same reason the overlay clone never carries one. */
  onToggleSelect?: (id: string) => void;
}) {
  if (overlay) return <ChannelCardOverlay channel={channel} sampleSize={sampleSize} />;
  return (
    <ChannelCardLive
      channel={channel}
      sampleSize={sampleSize}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

function ChannelCardLive({
  channel,
  sampleSize,
  selected,
  onToggleSelect,
}: {
  channel: ChannelRow;
  sampleSize: number;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
}) {
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
      <Card
        size="sm"
        ref={sortable.setNodeRef}
        style={style}
        data-testid="channel-card"
        data-id={channel.id}
        data-dragging={sortable.isDragging ? "" : undefined}
        className="select-none data-[dragging]:opacity-40"
      >
        <Item size="sm" className="gap-2.5 px-(--card-spacing) py-0">
          {/* The selection checkbox is a fourth distinct target on the card, before the
              grip. dnd-kit's listeners live on the grip alone, so ticking never starts a
              drag, and it sits outside the body Link so it never opens the channel. */}
          {onToggleSelect && (
            <Checkbox
              data-testid="channel-select"
              checked={selected}
              onCheckedChange={() => onToggleSelect(channel.id)}
              aria-label={`Select ${channel.handle}`}
              className="shrink-0"
            />
          )}
          {/* dnd-kit's drag handle used to be the whole body span below, which meant
              clicking the card to open it fought with dragging it and lost — the ...
              menu's View item was the only way in. The handle is a small dedicated
              grip now (a real button, so dnd-kit's attributes give it proper
              keyboard/aria semantics), and setNodeRef stays on the card so the
              whole card is still the draggable/droppable node; only the listeners
              moved. */}
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            aria-label={`Drag to reorder ${channel.handle}`}
            className="shrink-0 cursor-grab p-1 text-muted-foreground hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
            <ChannelCardBody channel={channel} />
          </Link>
          <ItemActions>
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
          </ItemActions>
        </Item>

        <CardContent>
          <Link href={href} className="block">
            <ChannelCardStats channel={channel} sampleSize={sampleSize} />
          </Link>
        </CardContent>
      </Card>

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
