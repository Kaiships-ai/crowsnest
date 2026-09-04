"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { followCreatorAction } from "@/server/actions/discover-actions";
import type { CreatorSeedRow } from "@/server/queries/discover";

type FollowState = "idle" | "pending" | "tracked";

export function CreatorSeedCard({
  seed,
  onFollowed,
}: {
  seed: CreatorSeedRow;
  /** Called after a successful follow so a parent that stays mounted across
   *  filter changes (DiscoverBoard) can remember it — this card's own local
   *  state is destroyed if a niche filter unmounts it. */
  onFollowed?: (handle: string) => void;
}) {
  const [state, setState] = useState<FollowState>(seed.tracked ? "tracked" : "idle");

  async function onFollow() {
    setState("pending");
    try {
      const result = await followCreatorAction(seed.handle);
      if (result.ok) {
        setState("tracked");
        onFollowed?.(seed.handle);
        // Close the loop: a bare "Tracked" leaves a first-timer unsure anything
        // happened. Say where the posts go, and whether a sync started now or waits.
        if (!result.alreadyTracked) {
          toast.success(
            result.syncQueued
              ? `Following @${seed.handle}. Pulling top posts now — watch Runs.`
              : `Following @${seed.handle}. Posts sync on the next run.`
          );
        }
      } else {
        setState("idle");
        toast.error(result.error);
      }
    } catch {
      // A rejected server action (transport/serialization) would otherwise leave
      // the button stuck disabled on "Queuing…" forever with no way to retry.
      setState("idle");
      toast.error("Could not follow. Try again.");
    }
  }

  return (
    <article data-testid="creator-seed-card" className="flex flex-col gap-3 border border-border bg-card px-4 pt-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm text-foreground">@{seed.handle}</span>
        {/* Neutral raised surface — the niche badge is never amber. `secondary` is the
            badge variant's neutral option (bg-secondary), same as the stale chip pattern
            channel-card.tsx uses elsewhere on this screen. */}
        <Badge variant="secondary" className="shrink-0 font-mono text-2xs uppercase tracking-wide">
          {seed.niche}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{seed.why}</p>

      <Button
        type="button"
        data-testid="creator-seed-follow"
        disabled={state !== "idle"}
        onClick={() => void onFollow()}
        className="self-start"
      >
        {state === "tracked" ? "Tracked" : state === "pending" ? "Queuing…" : "Follow"}
      </Button>
    </article>
  );
}
