import { Skeleton } from "@/components/ui/skeleton";
import { getSimilarOutliers } from "@/server/services/similar";
import { SimilarOutliers } from "./video-detail";

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
  } catch {
    similar = null;
  }

  if (similar === null) {
    return (
      <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
        <h2 className="text-base font-semibold">Similar outliers</h2>
        <p className="text-sm text-destructive">Couldn&rsquo;t load similar outliers.</p>
      </div>
    );
  }

  return <SimilarOutliers items={similar} />;
}

/** Matches SimilarOutliers' real shape (heading + a row of compact OutlierCards,
 *  aspect-[9/16] thumbnail plus a couple of footer lines) so the layout doesn't jump
 *  when the real section streams in. Neutral (bg-muted via Skeleton), no amber. */
export function SimilarSkeleton() {
  return (
    <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
      <h2 className="text-base font-semibold">Similar outliers</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex w-40 shrink-0 flex-col gap-2 border border-border bg-card p-2">
            <Skeleton className="aspect-[9/16] w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
