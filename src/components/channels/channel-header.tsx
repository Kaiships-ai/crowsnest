"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { platformLabel } from "@/components/feed/platform-chip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompact } from "@/lib/format";
import type { ChannelRow } from "@/server/queries/channels";
import { bridgeSyncChannel } from "./sync-bridge";

/** No stored profile URL in the schema — channels only carry handle+platform, so the
 * live-profile link is derived the same way seed-data's video URLs are. */
function channelProfileUrl(platform: string, handle: string): string {
  const cleanHandle = handle.replace(/^@/, "");
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${cleanHandle}`;
    case "youtube_shorts":
      return `https://www.youtube.com/@${cleanHandle}`;
    default:
      return `https://www.instagram.com/${cleanHandle}/`;
  }
}

export function ChannelHeader({ channel }: { channel: ChannelRow }) {
  async function syncNow() {
    const result = await bridgeSyncChannel(channel.id);
    if (result.ok) {
      toast.success(`${channel.handle} synced`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {/* Avatar's size variants top out at "lg" (40px) — nearest system tier to
          DESIGN.md's 48px; not worth fighting the component's data-attribute-scoped
          size classes with a className override for an 8px difference. */}
      <Avatar size="lg">
        <AvatarImage src={channel.avatarUrl ?? undefined} alt="" />
        <AvatarFallback>
          {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{channel.handle}</h2>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {platformLabel(channel.platform)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{formatCompact(channel.followerCount)} followers</p>
      </div>

      <a
        href={channelProfileUrl(channel.platform, channel.handle)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${channel.handle} on ${platformLabel(channel.platform)}`}
        className="text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="size-4" />
      </a>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={syncNow}>
          <RefreshCw className="size-3.5" /> Sync now
        </Button>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="sm" disabled focusableWhenDisabled />}>
            Untrack
          </TooltipTrigger>
          <TooltipContent>Untrack arrives in a later phase</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
