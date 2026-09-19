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

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <PageContainer className="flex flex-col gap-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No channel is marked as yours yet.</EmptyTitle>
          <EmptyDescription>
            My channel reads Instagram Insights, which only exist for the one channel you own, not for a
            channel you&apos;re tracking to study. Pick which tracked channel is you, and this screen switches
            from research to your own numbers.
          </EmptyDescription>
        </EmptyHeader>
        {candidates.length === 0 && (
          <EmptyContent>
            <EmptyDescription>
              There&apos;s nothing tracked yet to mark as yours. Add your Instagram account as a channel first,
              from Channels, then come back here.
            </EmptyDescription>
          </EmptyContent>
        )}
      </Empty>

      {candidates.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead className="w-[120px] text-right">Followers</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="min-w-0">
                  <p className="truncate text-[15px] text-foreground">{c.handle}</p>
                  {c.displayName && <p className="truncate text-xs text-muted-foreground">{c.displayName}</p>}
                </TableCell>
                <TableCell data-num className="text-right font-mono text-sm text-muted-foreground">
                  {c.followerCount === null ? "—" : c.followerCount.toLocaleString("en-US")}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="own-channel-picker-choose"
                    disabled={pendingId === c.id}
                    onClick={() => choose(c.id, c.handle)}
                  >
                    {pendingId === c.id ? "Setting…" : "This is me"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </PageContainer>
  );
}
