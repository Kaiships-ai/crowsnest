"use client";

/**
 * "No own channel chosen" — a real first state on a fresh install (CONTEXT.md: the
 * Owned channel is a Channel Kai controls, read through the Graph API; nothing on this
 * machine has been marked yet). Every tracked channel is a candidate because there is
 * nothing in `channels` that distinguishes "mine" from "a competitor" until Kai says so
 * — `setOwnChannelAction` is that one hand-driven action (channel-actions.ts).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setOwnChannelAction } from "@/server/actions/channel-actions";

export interface OwnChannelCandidate {
  id: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
}

export function OwnChannelPicker({ candidates }: { candidates: OwnChannelCandidate[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function choose(id: string, handle: string) {
    setPendingId(id);
    const result = await setOwnChannelAction(id);
    setPendingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${handle} is now your own channel`);
    router.refresh();
  }

  // No heading here: this is /mine's empty state, and Topbar already renders that route's
  // h1 ("My channel") — see nav-items/topbar's ROUTE_TITLES. The h1 this printed was both
  // a second h1 on the route and the same two words the topbar shows, so the screen
  // opened with "My channel" twice.
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div className="mt-6 max-w-[62ch]">
        <p className="text-base text-foreground">No channel is marked as yours yet.</p>
        <p className="mt-3 text-sm text-muted-foreground">
          My channel reads Instagram Insights, which only exist for the one channel you own, not for a
          channel you&apos;re tracking to study. Pick which tracked channel is you, and this screen switches
          from research to your own numbers.
        </p>
      </div>

      {candidates.length === 0 ? (
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          There&apos;s nothing tracked yet to mark as yours. Add your Instagram account as a channel first,
          from Channels, then come back here.
        </p>
      ) : (
        <div className="mt-6 flex flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_100px] gap-4 border-b border-line-strong pb-3 font-mono text-2xs text-faint">
            <span data-lab>Channel</span>
            <span data-lab className="text-right">
              Followers
            </span>
            <span />
          </div>
          {candidates.map((c) => (
            <div
              key={c.id}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_120px_100px] items-center gap-4 border-b border-border"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] text-foreground">{c.handle}</p>
                {c.displayName && <p className="truncate text-xs text-muted-foreground">{c.displayName}</p>}
              </div>
              <span data-num className="text-right font-mono text-sm text-muted-foreground">
                {c.followerCount === null ? "—" : c.followerCount.toLocaleString("en-US")}
              </span>
              <div className="text-right">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="own-channel-picker-choose"
                  disabled={pendingId === c.id}
                  onClick={() => choose(c.id, c.handle)}
                >
                  {pendingId === c.id ? "Setting…" : "This is me"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
