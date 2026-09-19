import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Default loading state for every shell page that has no bespoke one (feed keeps its own).
// Card-shaped blocks in the same gutter the real page bodies use, never a spinner - the
// layout itself communicates while the page's server queries resolve. DESIGN.md §6.
//
// This lives under the `(loaded)` route group ON PURPOSE, not at `(shell)` root: as an
// ancestor Suspense boundary it must NOT wrap `/feed/[videoId]`, or that route's
// notFound() would return HTTP 200 instead of 404 (B-17). `/feed` is deliberately kept
// outside `(loaded)`. Do not move this file up to `(shell)/loading.tsx`.
export default function ShellLoading() {
  return (
    <PageContainer className="flex flex-col gap-10">
      <Skeleton className="h-9 w-56" />

      {/* a panel block */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>

      {/* a stat / tile row */}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
