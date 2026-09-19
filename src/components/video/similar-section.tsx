import { isNextRouterError } from "next/dist/client/components/is-next-router-error";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSimilarOutliers } from "@/server/services/similar";
import { SimilarOutliers, SimilarSectionShell } from "./video-detail";

/**
 * Task 4 (Wave 3): the video detail page's slowest query, isolated behind its own
 * Suspense boundary so it no longer blocks the primary detail from painting (see
 * page.tsx's header comment). An async server component, not a prop — this is what
 * lets Next stream it in independently.
 *
 * Hardened per the board finding "a throw in getSimilarOutliers takes the page down":
 * caught locally so a failure here degrades only this section, never the
 * `(shell)/error.tsx` boundary that a page-level throw would otherwise hit.
 */
export async function SimilarSection({ videoId }: { videoId: string }) {
  // The await (not the JSX below) is what can throw — assigned to a plain variable
  // rather than `return`ing JSX from inside the try, so the try/catch only ever
  // guards the fetch itself (lint: react-hooks/error-boundaries).
  let similar: Awaited<ReturnType<typeof getSimilarOutliers>> | null = null;
  try {
    similar = await getSimilarOutliers(videoId);
  } catch (error) {
    // notFound()/redirect() throw a special error that Next's own machinery is meant
    // to catch further up the tree — swallowing it here as "just an error" would
    // convert real navigation into a dead-end error card. Let it keep propagating.
    if (isNextRouterError(error)) throw error;
    console.error("similar outliers failed:", error);
    similar = null;
  }

  if (similar === null) {
    return (
      <SimilarSectionShell>
        <p className="text-sm text-destructive">Couldn&rsquo;t load similar outliers.</p>
      </SimilarSectionShell>
    );
  }

  return <SimilarOutliers items={similar} />;
}

/** One skeleton card, matching OutlierCard's compact-variant DOM exactly (a `size="sm"`
 *  Card with a full-bleed aspect-[9/16] thumbnail above a CardContent holding two text
 *  lines) so swapping in the real row doesn't reflow the page. */
function SimilarCardSkeleton() {
  return (
    // `pt-0` for the same reason OutlierCard carries it: the thumbnail is full-bleed to
    // the card's top edge, and Card's own has-[>img:first-child]:pt-0 doesn't fire for a
    // Skeleton standing in for one.
    <Card size="sm" className="pt-0">
      <Skeleton className="aspect-[9/16] w-full" />
      <CardContent className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

/** Matches SimilarOutliers' real shape (heading + a row of compact OutlierCards,
 *  aspect-[9/16] thumbnail plus a couple of footer lines) so the layout doesn't jump
 *  when the real section streams in. Neutral throughout (bg-muted via Skeleton) so a
 *  placeholder row can never be mistaken for a loaded one. */
export function SimilarSkeleton() {
  return (
    <SimilarSectionShell>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-40 shrink-0">
            <SimilarCardSkeleton />
          </div>
        ))}
      </div>
    </SimilarSectionShell>
  );
}
