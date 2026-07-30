import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_COUNT = 8;

// DESIGN.md §6: skeleton grid matching the real card shape exactly — never a spinner
// in place of the grid, so the layout itself communicates while data loads.
export default function FeedLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <Skeleton className="h-8 max-w-md" />
        <Skeleton className="h-8 w-full max-w-4xl" />
        <Skeleton className="h-7 w-72" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="flex flex-col overflow-hidden border border-border bg-card">
              <div className="relative aspect-[9/16] w-full">
                <Skeleton className="absolute inset-0 rounded-none" />
                <Skeleton className="absolute right-2 top-2 h-6 w-12 rounded-full" />
              </div>
              <div className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
