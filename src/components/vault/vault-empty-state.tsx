import Link from "next/link";
import { Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * Vault AC 1: with zero saved posts, both exits must route somewhere real. "Open the
 * top outlier" only gets a real link when a top post actually exists (getTopOutlierAllTime
 * in the page). With a genuinely empty database, or one with no scored video, it falls
 * back to the Feed link instead of pointing at a video id that doesn't exist or isn't
 * a real outlier.
 */
export function VaultEmptyState({ topOutlierVideoId }: { topOutlierVideoId: string | null }) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Archive />
        </EmptyMedia>
        <EmptyTitle>Nothing saved yet.</EmptyTitle>
        <EmptyDescription>
          Saving a post keeps its score, its transcript and its analysis together, so a remix run can start from it later.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button render={<Link href="/feed" />}>Open the feed</Button>
        <Button variant="outline" render={<Link href={topOutlierVideoId ? `/feed/${topOutlierVideoId}` : "/feed"} />}>
          Open the top outlier
        </Button>
      </EmptyContent>
    </Empty>
  );
}
