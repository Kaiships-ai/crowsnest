"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, ExternalLink, RefreshCw, Trash2, X } from "lucide-react";

import { platformLabel } from "@/components/feed/platform-chip";
import { gapMessage, gapRetryLabel, phaseLabel, syncViewState } from "@/components/sync/sync-progress-view";
import { useSyncProgress } from "@/components/sync/use-sync-progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatCompact, relativeTime } from "@/lib/format";
import { assetUrl } from "@/lib/media-url";
import { cn } from "@/lib/utils";
import type { ChannelRow } from "@/server/queries/channels";
import { RemoveChannelDialog } from "./remove-channel-dialog";

/** No stored profile URL in the schema — channels only carry handle+platform, so the
 * live-profile link is derived from the stored handle. Instagram only in V1
 * (V1-BRIEF.md) — the TikTok and YouTube branches this used to have built links for
 * platforms sync can never write, which is dead code that only risked a broken link
 * if a row was ever miscategorised. */
function channelProfileUrl(handle: string): string {
  const cleanHandle = handle.replace(/^@/, "");
  return `https://www.instagram.com/${cleanHandle}/`;
}

export function ChannelHeader({ channel, postCount }: { channel: ChannelRow; postCount?: number }) {
  // Scoped to this channel: `start()` with no arguments syncs only this one, and the poll
  // answers "is a run covering THIS channel" from the `channel_id` column. `coverage`
  // replaced a comparison of `progress.currentChannelHandle` against this row's handle —
  // a guess that was wrong for the sub-second at the start of every run, before the
  // engine has named a channel. A run scoped to a different channel is now correctly
  // invisible here rather than something to be filtered out after the fact.
  const { progress, coverage, stalled, error, start, cancel } = useSyncProgress({ channelId: channel.id });
  const router = useRouter();
  // `start()` resolves once the job row exists; this covers the gap before it does, so a
  // second click can't race the DB lock and come back as "a sync is already running".
  // It is a pending state for the request, not a claim about the run's progress.
  const [starting, setStarting] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const state = syncViewState(progress, stalled);
  const live = state === "running" || state === "cancelling";
  // Disabled whenever a live run covers this channel, in either sense — and the two
  // senses are worded apart below, because "this channel is syncing" and "a library sync
  // is running" are different facts to a reader.
  //
  // Both genuinely block a sync here: `conflictingRun` in sync-engine.ts (called by
  // `acquireLock` inside an IMMEDIATE transaction) treats a library run as overlapping
  // every channel, so starting this channel's sync during one loses the lock and comes
  // back as SYNC_ALREADY_RUNNING. Two runs on DIFFERENT channels stay concurrent, which
  // is why a different channel's run must not — and now cannot — disable this button:
  // `coverage` is null for it, and the run isn't even reported here.
  //
  // A stalled run is the exception: `syncViewState` reports `stalled` rather than
  // `running`, so `live` is false and the button stays clickable to take the dead
  // process's lock back.
  const covered = live && coverage !== null;
  const busy = starting || covered;

  async function syncNow() {
    setStarting(true);
    try {
      await start();
    } finally {
      setStarting(false);
    }
  }

  // Only this channel's failures. A library-wide run that gapped on someone else is
  // reported by the sidebar, and repeating it under this header would be noise.
  const ownGap = live ? undefined : progress?.gaps.find((gap) => gap.channelId === channel.id);
  const runFailed = !live && progress?.status === "failed";
  const failureText = ownGap ? gapMessage(ownGap) : runFailed ? (progress.errorMessage ?? "The sync failed and recorded no reason.") : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {/* Avatar's size variants top out at "lg" (40px) — nearest system tier to
            DESIGN.md's 48px; not worth fighting the component's data-attribute-scoped
            size classes with a className override for an 8px difference. */}
        <Avatar size="lg">
          <AvatarImage src={assetUrl(channel.avatarAssetId) ?? undefined} alt="" />
          <AvatarFallback>
            {(channel.displayName ?? channel.handle).replace("@", "").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">{channel.handle}</h2>
          {/* One mono meta line (mine.html's header), not a badge chip plus a caption —
              platform, sync recency, followers and post count read as one fact together. */}
          <p className="font-mono text-2xs tracking-[0.06em] text-muted-foreground">
            {platformLabel(channel.platform)} · {channel.lastSyncedAt ? `synced ${relativeTime(channel.lastSyncedAt)}` : "never synced"} ·{" "}
            <span data-num>{formatCompact(channel.followerCount)}</span> followers
            {postCount !== undefined && (
              <>
                {" "}
                · <span data-num>{postCount}</span> post{postCount === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>

        <a
          href={channelProfileUrl(channel.handle)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${channel.handle} on ${platformLabel(channel.platform)}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-4" />
        </a>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {covered && progress !== null && (
            <span className="max-w-[22rem] truncate text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {/* Worded off `coverage`, not off which handle the run happens to be naming
                  this second: a library run that has not reached this channel yet is
                  still the reason the button is disabled, and saying so is the honest
                  answer to "why can't I sync?". */}
              {coverage === "library"
                ? `Library sync running · ${progress.currentChannelHandle ?? phaseLabel(progress.phase)}`
                : `${phaseLabel(progress.phase)} · ${progress.itemsSeen} posts seen`}
            </span>
          )}
          {stalled && <span className="text-xs text-destructive">Last sync stopped reporting</span>}

          <Button variant="outline" size="sm" onClick={syncNow} disabled={busy}>
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
            {busy ? "Syncing…" : "Sync now"}
          </Button>

          {/* Only this channel's own run is cancellable from here. Cancelling a
              library-wide run is a much larger action than this button appears to be, so
              it stays where its scope is obvious — the sidebar and the Settings panel. */}
          {live && coverage === "channel" && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void cancel()}
              disabled={progress?.cancelRequested ?? false}
              aria-label="Cancel sync"
            >
              <X className="size-4" />
            </Button>
          )}

          {/* Kept separate from "Sync now" rather than folded into a menu: this is the
              only other action on the page, and the "one primary action per screen" rule
              is about competing calls to action, not about hiding every secondary one.
              Ghost + destructive-on-hover keeps it from reading as a second primary
              button next to Sync now. */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRemoveOpen(true)}
            aria-label={`Remove ${channel.handle}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* The old code showed `toast.error(result.error)` and nothing else — a message
          that vanished in four seconds and never said what to do about it. gapMessage
          turns the engine's IgErrorCode into the actual next step. */}
      {(failureText !== null || error !== null) && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription className="flex flex-col gap-2">
            {error !== null && <span>{error}</span>}
            {failureText !== null && <span>{failureText}</span>}
            {ownGap !== undefined && (
              <span>
                <Button variant="outline" size="xs" onClick={syncNow} disabled={busy}>
                  {gapRetryLabel(ownGap.code)}
                </Button>
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <RemoveChannelDialog
        channel={channel}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        // The table just refreshes the row in place; this page's route (/channels/[id])
        // stops resolving the instant the channel is gone (getChannelDetail filters
        // deletedAt), so staying here would be a page about to 404. Leaving for the list
        // it just left is the only honest landing spot.
        onRemoved={() => router.push("/channels")}
      />
    </div>
  );
}
