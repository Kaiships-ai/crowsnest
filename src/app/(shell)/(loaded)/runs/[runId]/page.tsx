import Link from "next/link";
import { ChevronLeft, FileQuestion } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { RunDetail } from "@/components/runs/run-detail";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getRun } from "@/server/queries/runs";
import { getSetting } from "@/server/settings";

// Same reasoning as every other data-backed page in this shell (runs/page.tsx,
// logs/page.tsx): first paint has to read sync_jobs/remix_runs/log_events at request
// time, not a build-time snapshot. Live updates past first paint come from RunDetail's
// own SSE subscription (useRunStream), not from this route re-rendering.
export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);

  // Read once per request, same as runs/page.tsx: RunDetail needs both budgets client
  // side to evaluate its SLA chip on every stream tick, since evaluateSla is a pure
  // function with no settings access of its own.
  const [syncSlaMinutes, remixSlaMinutes] = await Promise.all([
    getSetting("syncSlaMinutes"),
    getSetting("remixSlaMinutes"),
  ]);

  return (
    <PageContainer>
      <Link href="/runs" className="flex w-fit items-center gap-1 text-2xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to runs
      </Link>

      {run === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestion />
            </EmptyMedia>
            <EmptyTitle>Run not found.</EmptyTitle>
            <EmptyDescription>It may be older than the retention window, or the id is wrong.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-3">
          <RunDetail run={run} syncSlaMinutes={syncSlaMinutes} remixSlaMinutes={remixSlaMinutes} />
        </div>
      )}
    </PageContainer>
  );
}
