"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
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
              ? `Đang theo dõi @${seed.handle}. Đang kéo bài top, xem ở Lần chạy.`
              : `Đang theo dõi @${seed.handle}. Dịch vụ Instagram chưa chạy, bài sẽ được kéo khi nó chạy lại.`
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
      toast.error("Không theo dõi được. Thử lại.");
    }
  }

  return (
    <Card size="sm" data-testid="creator-seed-card">
      <Item size="sm" className="px-(--card-spacing) py-0">
        <ItemContent>
          <ItemTitle className="block w-full truncate font-mono">@{seed.handle}</ItemTitle>
          <ItemDescription>{seed.why}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {/* A neutral raised surface, not a signal colour: the niche is a fact about the
              row, not a call to action. `secondary` is the badge variant's neutral
              option, the same chip treatment channel-card.tsx uses on this screen. */}
          <Badge variant="secondary" className="shrink-0 font-mono text-2xs uppercase tracking-wide">
            {seed.niche}
          </Badge>
        </ItemActions>
      </Item>

      <CardFooter>
        <Button
          type="button"
          data-testid="creator-seed-follow"
          disabled={state !== "idle"}
          onClick={() => void onFollow()}
        >
          {state === "tracked" ? "Đang theo dõi" : state === "pending" ? "Đang thêm…" : "Theo dõi"}
        </Button>
      </CardFooter>
    </Card>
  );
}
