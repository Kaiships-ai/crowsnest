"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cancelSyncAction, startSyncAction } from "@/server/actions/sync-actions";
import { evaluateSla } from "@/server/runs/sla";
import { SYNC_STALL_SECONDS } from "@/server/services/sync-types";
import type { RunStatus, RunSummary } from "@/server/queries/runs";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRunStream } from "./use-run-stream";

/**
 * Runs list (Runs and observability, spec 2026-08-02, screen 1). Seeded from the
 * server's first-paint `listRuns()` read, then kept live by `useRunStream` — the same
 * split every other live view in this shell uses (sidebar's `useSyncProgress` for the
 * poll, this hook's SSE tick for the push).
 *
 * Dot colors are copied from sidebar.tsx's own `STATUS_DOT` map, not reinvented: amber
 * stays reserved for the score, "running" gets noticed by brightness plus motion, and
 * only success/failed get a live hue.
 */
const STATUS_DOT: Record<RunStatus, string> = {
  running: "bg-foreground animate-pulse",
  waiting: "bg-foreground animate-pulse",
  success: "bg-[var(--pos)]",
  partial: "bg-muted-foreground",
  failed: "bg-destructive",
  canceled: "bg-muted-foreground",
};

/** The staleness threshold the sidebar's own "stalled" read already uses
 *  (sync-types.ts's `isSyncStalled`) — not the reaper's much longer lock-steal
 *  threshold, which lives inside sync-engine.ts and is Task 12's alone to touch. A run
 *  can sit "running" with a stale heartbeat for a while before the reaper ever reaps it,
 *  and that gap is exactly the window this list means to flag as "Stuck". */
const STALE_MS = SYNC_STALL_SECONDS * 1000;

function budgetMsFor(type: RunSummary["type"], syncSlaMinutes: number, remixSlaMinutes: number): number {
  return (type === "remix" ? remixSlaMinutes : syncSlaMinutes) * 60_000;
}

export interface RunsListProps {
  seedRuns: RunSummary[];
  syncSlaMinutes: number;
  remixSlaMinutes: number;
}

export function RunsList({ seedRuns, syncSlaMinutes, remixSlaMinutes }: RunsListProps) {
  const router = useRouter();
  const { runs, connected } = useRunStream(undefined, seedRuns);
  // Guards one row's buttons at a time; a run's own SSE-driven status change is what
  // actually clears it a tick later; this only stops a double click on the same row
  // before that tick arrives.
  const [pendingId, setPendingId] = useState<string | null>(null);

  // `Date.now()` is impure, so it cannot be called straight in the render body (same
  // rule failure-strip.tsx already works around). A ticking clock in state is the fix:
  // the SLA verdict and "over by" duration re-derive off this every second, matching
  // the live countdown pattern that component already established.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleCancel(runId: string) {
    setPendingId(runId);
    try {
      const result = await cancelSyncAction(runId);
      if (!result.ok) toast.error(result.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel the run.");
    } finally {
      setPendingId(null);
    }
  }

  // No per-channel scoping: RunSummary is Task 3's unified read and carries no channel
  // id, only a display title, so "retry this run" is the same call the sidebar's own
  // unscoped "Sync now" makes — start the next library sync — rather than a new action.
  async function handleRetry(runId: string) {
    setPendingId(runId);
    try {
      const result = await startSyncAction();
      if (!result.ok) toast.error(result.error);
      else toast.success("Sync started");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the sync.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 font-mono text-2xs text-faint">
        <span aria-hidden className={cn("size-1.5 rounded-full", connected ? "bg-foreground animate-pulse" : "bg-dim")} />
        <span>{connected ? "Live" : "Reconnecting…"}</span>
      </div>

      <div className="border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead></TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No runs yet.
                </TableCell>
              </TableRow>
            )}
            {runs.map((run) => {
              const verdict = evaluateSla({
                status: run.status,
                startedAt: run.startedAt,
                heartbeatAt: run.heartbeatAt,
                budgetMs: budgetMsFor(run.type, syncSlaMinutes, remixSlaMinutes),
                staleMs: STALE_MS,
                now,
              });
              const overMs = Math.max(0, now - new Date(run.startedAt).getTime() - budgetMsFor(run.type, syncSlaMinutes, remixSlaMinutes));
              const showProgress = run.status === "running" && run.channelsTotal !== null && run.channelsDone !== null;
              const progressPct = showProgress ? Math.min(100, Math.round(((run.channelsDone ?? 0) / (run.channelsTotal ?? 1)) * 100)) : 0;
              const isPending = pendingId === run.runId;

              return (
                <TableRow
                  key={run.runId}
                  className="cursor-pointer"
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/runs/${run.runId}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/runs/${run.runId}`);
                    }
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[run.status])} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{run.title}</div>
                        <div className="truncate text-2xs text-muted-foreground">{run.sub}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-2xs text-faint">{run.type}</span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{relativeTime(run.startedAt)}</TableCell>
                  <TableCell className="font-mono">{formatDuration(Math.floor(run.durationMs / 1000))}</TableCell>
                  <TableCell>
                    {showProgress && (
                      <div className="h-[5px] w-28 overflow-hidden bg-muted">
                        <div className="h-full bg-muted-foreground" style={{ width: `${progressPct}%` }} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {run.status === "running" && verdict.stuck && (
                      <span className="inline-flex items-center gap-1 border border-destructive/45 px-2 py-0.5 font-mono text-2xs text-destructive">
                        Stuck
                      </span>
                    )}
                    {run.status === "running" && !verdict.stuck && verdict.overBudget && (
                      <span className="inline-flex items-center gap-1 border border-destructive/45 bg-[var(--destructive-wash)] px-2 py-0.5 font-mono text-2xs text-destructive">
                        SLA over by {formatDuration(Math.floor(overMs / 1000))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {run.status === "running" && run.type === "sync" && (
                        <Button variant="destructive" size="sm" disabled={isPending} onClick={() => void handleCancel(run.runId)}>
                          Cancel
                        </Button>
                      )}
                      {(run.status === "failed" || run.status === "partial") && run.type === "sync" && (
                        <Button variant="outline" size="sm" disabled={isPending} onClick={() => void handleRetry(run.runId)}>
                          Retry
                        </Button>
                      )}
                      {!(run.status === "running" && run.type === "sync") &&
                        !((run.status === "failed" || run.status === "partial") && run.type === "sync") && (
                          <Button variant="outline" size="sm" onClick={() => router.push(`/runs/${run.runId}`)}>
                            View
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
