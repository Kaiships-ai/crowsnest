import { Skeleton } from "@/components/ui/skeleton";

// Default loading state for every shell page that has no bespoke one (feed keeps its own).
// Square blocks on the card token, never a spinner and never amber — the layout itself
// communicates while the page's server queries resolve. DESIGN.md §6.
//
// This lives under the `(loaded)` route group ON PURPOSE, not at `(shell)` root: as an
// ancestor Suspense boundary it must NOT wrap `/feed/[videoId]`, or that route's
// notFound() would return HTTP 200 instead of 404 (B-17). `/feed` is deliberately kept
// outside `(loaded)`. Do not move this file up to `(shell)/loading.tsx`.
export default function ShellLoading() {
  return (
    <div className="flex h-full flex-col gap-10 px-8 py-8">
      <Skeleton className="h-9 w-56 rounded-none" />

      {/* a panel block */}
      <Skeleton className="h-40 w-full max-w-4xl rounded-none" />

      {/* a stat / tile row */}
      <div className="grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 border border-border bg-card p-5">
            <Skeleton className="h-4 w-24 rounded-none" />
            <Skeleton className="h-7 w-12 rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
