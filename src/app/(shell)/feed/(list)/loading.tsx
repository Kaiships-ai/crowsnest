import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_COUNT = 8;

// DESIGN.md §6: skeleton grid matching the real card shape exactly — never a spinner
// in place of the grid, so the layout itself communicates while data loads. "Exactly"
// means the same Card, the same size, the same full-bleed media and bordered footer
// OutlierCard renders, so nothing shifts when the real cards arrive.
export default function FeedLoading() {
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <Skeleton className="h-9 w-full rounded-4xl sm:w-64" />
        <Skeleton className="h-8 w-full max-w-4xl" />
        <Skeleton className="h-7 w-72" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageContainer size="full">
          <Skeleton className="mb-3 h-4 w-20" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <Card key={i} size="sm" className="pt-0">
                <div className="relative aspect-[9/16] w-full">
                  <Skeleton className="absolute inset-0 rounded-none" />
                  <Skeleton className="absolute right-2 top-2 h-5 w-12" />
                </div>
                <CardContent className="flex flex-col gap-1.5">
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
                <CardFooter className="justify-between border-t">
                  <Skeleton className="h-6 w-16 rounded-4xl" />
                  <Skeleton className="size-8 rounded-4xl" />
                </CardFooter>
              </Card>
            ))}
          </div>
        </PageContainer>
      </div>
    </div>
  );
}
