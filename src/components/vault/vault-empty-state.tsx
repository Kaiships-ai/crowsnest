import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Vault AC 1: with zero saved posts, both exits must route somewhere real. "Open the
 * top outlier" only gets a real link when a top post actually exists (getTopOutliersToday
 * in the page). With a genuinely empty database it falls back to the Feed link instead
 * of pointing at a video id that doesn't exist.
 */
export function VaultEmptyState({ topOutlierVideoId }: { topOutlierVideoId: string | null }) {
  return (
    <div className="max-w-[52ch] py-16">
      <p className="text-2xl font-medium text-foreground">Nothing saved yet.</p>
      <p className="mt-5 text-[17px] leading-relaxed text-muted-foreground">
        Saving a post keeps its score, its transcript and its analysis together, so a
        remix run can start from it later.
      </p>
      <div className="mt-8 flex flex-wrap gap-5">
        <Link href="/feed" className={cn(buttonVariants({ variant: "default" }))}>
          Open the feed
        </Link>
        <Link
          href={topOutlierVideoId ? `/feed/${topOutlierVideoId}` : "/feed"}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Open the top outlier
        </Link>
      </div>
    </div>
  );
}
